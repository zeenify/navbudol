import { Injectable, Injector, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Router } from '@angular/router';
import { CharacterService } from '../services/character.service';
import { CommunityPlacesService } from '../services/community-places.service';
import { GeminiService } from '../services/gemini.service';
import { LocationService } from '../services/location.service';
import { NavigationService } from '../services/navigation.service';
import { SettingsService } from '../services/settings.service';
import { GENERAL_TINIO_SERVICE_RADIUS_M } from '../service-area';
import { ChatMessage, GeminiFunctionCall } from '../models';
import { buildPilotSystemPrompt } from '../constants/prompts';
import { buildElementSnapshot, ElementSnapshot } from './snapshot';
import { executeBatch, ExecuteContext, PilotCommand, PilotCommandResult } from './executor';
import * as overlay from './overlay';
import { auditAppend } from './audit';
import { installNetWatch } from './net-watch';

/**
 * NavBudol Pilot — run state machine.
 *
 * One run: user message → think (River brain, Gemini fallback) → ONE tool
 * call per turn → consent gate (acting) → execute on the real UI → re-snapshot
 * → feed results + snapshot + trail back → … → end. Loops, dangling claims
 * and dead ends end with honest visible notes instead of spinning.
 *
 * The consent gate is structural, not prompt-hoped: acting commands are held
 * in code until "Take the wheel" is pressed. The executor independently
 * refuses destructive controls and any goto (navigation is click-only).
 */

interface OpenAiToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface BrainResponse {
  text: string | null;
  tool_calls: OpenAiToolCall[] | null;
  brain: 'river' | 'gemini';
}

interface HeldBatch {
  explain: string;
  commands: PilotCommand[];
  resolve: (verdict: 'go' | 'declined' | 'stopped') => void;
}

// Actions that move or change the page — the "take the wheel" set. goto is
// NOT here anymore: the pilot has no jump command at all (the executor
// refuses it), so navigation happens only through real clicks. point/
// snapshot/scroll stay free reads.
const ACTING_ACTIONS = new Set(['click', 'input', 'select']);
// Batches made ONLY of these are invisible reads — they run without the
// takeover UI; a "Read page" row still lands in the thread.
const SILENT_ACTIONS = new Set(['snapshot', 'point']);

// Click-only navigation burns more honest turns than a goto shortcut did.
const MAX_TOOL_TURNS = 40;
const RUN_FLAG_KEY = 'navbudol.chat.running';

// A follow-up continues the run (consent, trail, caches survive); anything
// else starts a NEW goal and resets them — consent is per run.
const FOLLOWUP_RE =
  /^(?:yes|yeah|yep|yup|ok(?:ay)?\b|kk|nope|no\b|sure|fine|please|go(?:\s+ahead)?|do\s+it|continue|keep\s+going|next|and\b|also|then\b|now\s|that\b|there\b|this\b|it\b|again|more|stop|thanks|thank\s+you|why\b|what\s+about|how\s+about|instead|wait)\b/i;

// The model sometimes narrates an action ("I'm opening settings…") and stops
// without sending any tool call. Claim-based detection, not a verb whitelist;
// a trailing question must not launder a false claim made mid-message.
const ACTION_CLAIM_RE =
  /\b(?:i'?ll|i\s+will|i'?m|i\s+am|let'?s|let\s+me|we'?ll|we\s+are\s+going\s+to|going\s+to)\s+(?:go|head|open|take|bring|show|pull|navigate|jump|click|check|set\s+up|create|delete|remove|start|run|find|get|type|fill|turn|switch|point|search|plot|explain|describe)\b/i;
const CLAIM_CONDITIONAL_RE =
  /\b(?:if|when|once|want\s+me\s+to|shall\s+i|would\s+you\s+like|say\s+(?:the\s+word|so|go)|just\s+(?:say|name|tell|give|pick)|give\s+me|name\s+(?:the|a|which|one)|pick\s+(?:one|a)|let\s+me\s+know|tell\s+me\s+(?:which|who|what)|ready\s+when)\b/i;

function hasDanglingClaim(narration: string): boolean {
  const fragments = String(narration || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Bullet options and numbered walkthrough steps are the USER's choices,
  // never the pilot's own claims.
  const own = fragments.filter((s) => !/^[-*•]\s/.test(s) && !/^\d+[.)]\s/.test(s));
  return own.slice(-2).some((s) => ACTION_CLAIM_RE.test(s) && !CLAIM_CONDITIONAL_RE.test(s));
}

function jsonClip(value: unknown, limit: number): string {
  const s = JSON.stringify(value) ?? '{}';
  return s.length > limit ? `${s.slice(0, limit)}…` : s;
}

@Injectable({ providedIn: 'root' })
export class PilotRunService {
  /** consent card contents while the run waits for "Take the wheel" */
  readonly consent$ = new BehaviorSubject<{ explain: string; commands: string[] } | null>(null);
  /** a run is busy (composer locked via gemini.thinking$) */
  readonly active$ = new BehaviorSubject(false);
  /** a driving batch is on the page right now */
  readonly driving$ = new BehaviorSubject(false);

  /** Pilot mode on/off — when on, chat runs through the pilot loop. */
  readonly enabled$ = new BehaviorSubject<boolean>(localStorage.getItem('navbudol.pilot.enabled') !== '0');

  private gemini: GeminiService | null = null;
  private snapshot: ElementSnapshot = { text: '', entries: [], byRef: new Map() };

  // per-run state
  private task = '';
  private consentGranted = false;
  private toolTurns = 0;
  private trail: string[] = [];
  private lookupCache = new Map<string, Record<string, unknown>>();
  private failedLookupStreak = 0;
  private aborted = false;
  private stopNoticeShown = false;
  private nudgeUsed = false;
  private lastBatchKey: string | null = null;
  private lastBatchAllFailed = false;
  private identicalStreakKey: string | null = null;
  private identicalStreak = 0;
  private prevBatchKey: string | null = null;
  private twoAgoKey: string | null = null;
  private oscillation = 0;
  private droppedTools: string[] | null = null;
  private heldBatch: HeldBatch | null = null;
  private lastBatchResults: PilotCommandResult[] = [];
  private droveThisRun = false;
  private hasRunBefore = false;

  constructor(
    private injector: Injector,
    private zone: NgZone,
    private router: Router,
    private location: LocationService,
    private nav: NavigationService,
    private community: CommunityPlacesService,
    private characters: CharacterService,
    private settings: SettingsService
  ) {
    installNetWatch(); // the settle-wait needs the fetch/XHR counter
    overlay.setStopHandler(() => this.stop());
  }

  /** Lazy: GeminiService injects THIS service, so it's resolved on first use. */
  private get gem(): GeminiService {
    if (!this.gemini) this.gemini = this.injector.get(GeminiService);
    return this.gemini;
  }

  setEnabled(v: boolean): void {
    this.enabled$.next(v);
    localStorage.setItem('navbudol.pilot.enabled', v ? '1' : '0');
  }

  // --- entry -----------------------------------------------------------------

  /** Main entry (from GeminiService.chat when pilot mode is on). The user
   *  message is already on the thread; returns the final spoken line (or ''
   *  after a stop). */
  async chat(userText: string): Promise<string> {
    const text = userText.trim();
    if (!text) return '';

    // A follow-up continues the run (consent, trail, caches survive); anything
    // else starts a NEW goal and resets them — consent is per run.
    const isFollowUp = this.hasRunBefore && FOLLOWUP_RE.test(text);
    if (!isFollowUp) this.resetRunState();
    this.task = text;
    this.hasRunBefore = true;
    this.aborted = false;
    this.stopNoticeShown = false;
    localStorage.setItem(RUN_FLAG_KEY, '1'); // mid-run kill detector
    this.zone.run(() => this.active$.next(true));

    try {
      return await this.runTurn('start', {});
    } finally {
      localStorage.removeItem(RUN_FLAG_KEY);
      overlay.setPageLock(false);
      this.zone.run(() => {
        this.active$.next(false);
        this.driving$.next(false);
        this.consent$.next(null);
      });
      overlay.updateDriveBar({ visible: false });
      overlay.hideCursor();
      overlay.hideHighlight();
    }
  }

  approve(): void {
    const held = this.heldBatch;
    if (!held) return;
    // Stop beats a late approve — never execute a batch the user tried to
    // cancel while the card was up.
    if (this.aborted) {
      this.heldBatch = null;
      this.zone.run(() => this.consent$.next(null));
      held.resolve('stopped');
      return;
    }
    this.heldBatch = null;
    this.zone.run(() => this.consent$.next(null));
    this.consentGranted = true;
    held.resolve('go');
  }

  decline(): void {
    const held = this.heldBatch;
    if (!held) return;
    this.heldBatch = null;
    this.zone.run(() => this.consent$.next(null));
    held.resolve('declined');
  }

  /** Stop kills everything: the pending consent wait, the batch at the NEXT
   *  command boundary, and any in-flight brain response (discarded on
   *  arrival — CapacitorHttp can't abort a native request). */
  stop(): void {
    if (this.heldBatch) {
      const held = this.heldBatch;
      this.heldBatch = null;
      this.zone.run(() => this.consent$.next(null));
      held.resolve('stopped');
    }
    if (!this.active$.value) return;
    this.aborted = true;
  }

  /** Describe a command in user words for the consent card + thread rows. */
  describeCommand(c: PilotCommand): string {
    const label = c.ref != null ? this.snapshot.byRef.get(Number(c.ref))?.name : undefined;
    switch (c.action) {
      case 'goto':
        return 'Jump to a screen (refused — navigation is click-only)';
      case 'click':
        return `Tap ${label ? `“${label}”` : `element ${c.ref}`}`;
      case 'input':
        return `Type “${c.value ?? ''}”${label ? ` into “${label}”` : ''}`;
      case 'select':
        return `Choose “${c.value ?? ''}”${label ? ` in “${label}”` : ''}`;
      case 'scroll':
        return `Scroll ${c.direction === 'up' ? 'up' : 'down'}`;
      case 'point':
        return `Point at ${label ? `“${label}”` : `element ${c.ref}`}`;
      default:
        return 'Read page';
    }
  }

  private resetRunState(): void {
    this.consentGranted = false;
    this.toolTurns = 0;
    this.trail = [];
    this.lookupCache = new Map();
    this.failedLookupStreak = 0;
    this.nudgeUsed = false;
    this.lastBatchKey = null;
    this.lastBatchAllFailed = false;
    this.identicalStreakKey = null;
    this.identicalStreak = 0;
    this.prevBatchKey = null;
    this.twoAgoKey = null;
    this.oscillation = 0;
    this.droppedTools = null;
    this.heldBatch = null;
    this.lastBatchResults = [];
    this.droveThisRun = false;
    this.takeSnapshot();
  }

  private takeSnapshot(): ElementSnapshot {
    this.snapshot = buildElementSnapshot();
    return this.snapshot;
  }

  // --- display helpers ---------------------------------------------------------

  private pushDisplay(msg: Omit<ChatMessage, 'id'>): number {
    return this.gem.pushDisplay(msg);
  }

  private pushNotice(text: string): void {
    this.pushDisplay({ role: 'model', text, kind: 'notice', avatar: this.characters.getSelected().avatar });
  }

  private pushSteps(explain: string, commands: PilotCommand[], readRow: boolean): number {
    return this.pushDisplay({
      role: 'model',
      text: '',
      kind: 'pilot',
      avatar: this.characters.getSelected().avatar,
      pilot: {
        explain: readRow ? '' : explain,
        read: readRow,
        steps: commands.map((c) => ({ label: this.describeCommand(c), status: 'run' as const })),
      },
    });
  }

  private setDriving(on: boolean): void {
    this.zone.run(() => this.driving$.next(on));
  }

  private updateBar(step: string, waiting?: boolean): void {
    overlay.updateDriveBar({
      visible: true,
      waiting,
      label: waiting ? 'Take the wheel?' : 'Pilot is driving',
      step,
      avatar: this.characters.getSelected().avatar,
    });
  }

  // --- the loop --------------------------------------------------------------

  private async runTurn(kind: 'start' | 'tool-result' | 'lookup-result', data: Record<string, unknown>): Promise<string> {
    if (this.aborted) return this.finalize();

    // Hard cap on model turns inside one run — a backstop against a model
    // stuck in a loop, NOT a task budget.
    if (this.toolTurns >= MAX_TOOL_TURNS) {
      this.pushNotice("I've been going back and forth too long on this one — let's break it into smaller asks. What you have so far stands.");
      return this.finalize();
    }
    this.toolTurns += 1;
    this.takeSnapshot();

    const avatar = this.characters.getSelected().avatar;
    this.gem.thinkingLabel$.next(kind === 'start' ? 'Thinking…' : 'Checking the screen…');

    let brain: BrainResponse;
    try {
      brain = await this.gem.postBrain(this.brainMessages(kind, data), this.pilotToolDeclarations());
    } catch (e) {
      const friendly = 'Sorry, I had trouble reaching the AI. Try again in a moment.';
      this.pushDisplay({ role: 'model', text: friendly, error: true, avatar });
      this.trail.push('brain call failed');
      return this.finalize();
    }
    if (this.aborted) return this.finalize();

    // One-line app-log note of which brain ran.
    console.log(
      `[Pilot] brain=${brain.brain} turn=${this.toolTurns} calls=${(brain.tool_calls ?? []).map((t) => t.name).join(',') || 'none'}`
    );
    this.gem.thinkingLabel$.next(null);

    const said = (brain.text ?? '').trim();
    // Parallel calls are dropped — ONE tool call per model turn; the next
    // turn reports honestly what never ran.
    const calls = brain.tool_calls ?? [];
    const first = calls[0];
    if (calls.length > 1) this.droppedTools = calls.slice(1).map((c) => c.name);

    if (said) {
      this.pushDisplay({ role: 'model', text: said, avatar });
      this.trail.push(`said: ${said.slice(0, 140)}`);
    }

    if (!first) {
      // Dangling-claim backstop: the turn CLAIMED an action but sent no tool
      // call and didn't deliver the words. First offense → one automatic
      // nudge ordering act-or-ask; second offense → a visible honest note.
      if (said && hasDanglingClaim(said)) {
        if (!this.nudgeUsed) {
          this.nudgeUsed = true;
          return this.runTurn('tool-result', { nudge: true });
        }
        this.pushNotice('(I said I’d do that but nothing happened on screen — ask me again and I’ll actually do it.)');
      }
      return this.finalize(said);
    }

    const toolCall: GeminiFunctionCall = { name: first.name, args: (first.arguments || {}) as Record<string, unknown> };

    if (first.name === 'invoke_screen') {
      const explain = String(first.arguments['explain'] ?? 'On it.');
      const commands = this.coerceCommands(first.arguments['commands']);
      if (commands.length === 0) {
        this.trail.push('invoke_screen arrived with no valid commands — nothing ran');
        return this.runTurn('tool-result', { nudge: true });
      }
      const verdict = await this.handleTool(explain, commands);
      if (verdict === 'declined') {
        const message = 'No problem — it stays in your hands.';
        this.pushNotice(message);
        return this.finalize(message);
      }
      if (verdict === 'stopped') return this.finalize('');
      return this.runTurn('tool-result', { results: this.lastBatchResults });
    }

    if (first.name === 'request_data') {
      const query = String(first.arguments['query'] ?? '');
      const params = (first.arguments['params'] ?? {}) as Record<string, unknown>;
      const lookup = await this.handleLookup(query, params);
      return this.runTurn('lookup-result', { ...lookup });
    }

    // Existing app tool (search_places, get_directions, start_navigation, …) —
    // reused from the plain chat loop, cards and map reactions included.
    this.gem.thinkingLabel$.next(this.gem.statusLabelFor(toolCall));
    const result = await this.gem.runPilotTool(toolCall);
    this.gem.flushPendingCards();
    this.gem.thinkingLabel$.next('');
    // Persistent digests: facts survive many turns in the trail.
    this.trail.push(`${toolCall.name} → ${jsonClip(result, 400)}`);
    return this.runTurn('tool-result', {
      results: [{ action: toolCall.name, ok: !result['error'], message: jsonClip(result, 400) } as PilotCommandResult],
    });
  }

  // --- brain payloads ----------------------------------------------------------

  /** Stateless turns: every turn re-sends task, route, snapshot and a TRAIL
   *  of the run's recent actions/findings (last ~10 lines) — each model turn
   *  is otherwise amnesiac and starts inventing numbers. */
  private brainMessages(
    kind: 'start' | 'tool-result' | 'lookup-result',
    data: Record<string, unknown>
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: buildPilotSystemPrompt(this.characters.getSelected(), this.gem.promptContext()) },
    ];
    // Persisted cross-run history (plain text turns only) — tool/lookup
    // traffic inside a run travels in the turn content, not the history.
    for (const h of this.chatHistoryLines()) messages.push({ role: h.role, content: h.text });
    messages.push({ role: 'user', content: this.turnContent(kind, data) });
    return messages;
  }

  /** Persisted cross-run history (plain text turns only) — tool/lookup
   *  traffic inside a run travels in the turn content, not the history.
   *  Deliberately SHORT: older requests are context, never the plan. The
   *  latest user message (carried in turnContent) is the only task. */
  private chatHistoryLines(): Array<{ role: 'user' | 'assistant'; text: string }> {
    const out: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    for (const m of this.gem.messages$.value) {
      if (!m.text || m.kind === 'pilot' || m.kind === 'notice' || m.error) continue;
      if (m.role === 'user') out.push({ role: 'user' as const, text: m.text.slice(0, 600) });
      else if (!m.kind || m.kind === 'text') out.push({ role: 'assistant' as const, text: m.text.slice(0, 600) });
    }
    return out.slice(-8);
  }

  private turnContent(kind: 'start' | 'tool-result' | 'lookup-result', data: Record<string, unknown>): string {
    const route = this.router.url || '/';
    const consentLine = this.consentGranted ? 'consent already granted this run' : 'no consent granted yet this run';
    const trailLines = this.trail.slice(-10);
    const trail =
      trailLines.length > 0
        ? '\nRECENT ACTIONS & FINDINGS THIS RUN (the facts below are yours to reuse — never repeat a lookup or action that is already listed):\n' +
          trailLines.map((t) => `- ${t}`).join('\n') +
          '\n'
        : '';

    if (kind === 'start') {
      return (
        `CURRENT PAGE: ${route}\n` +
        `CONSENT STATE: ${consentLine}\n\n` +
        `PAGE ELEMENTS (address controls by [ref] numbers):\n${this.snapshot.text}\n\n` +
        `USER REQUEST: ${this.task}\n` +
        '(The earlier conversation is background context ONLY — including what you did in previous requests. ' +
        'THIS request is the live task: resolve it from the latest screen, not from what you did last time. ' +
        'Reply with your short spoken line AND — when the screen must change — the ONE tool call for it, ' +
        'in the same reply. The approval gate asks the user for you; never also ask in words.)'
      );
    }

    if (kind === 'tool-result') {
      const results = (data['results'] as PilotCommandResult[] | undefined) ?? [];
      const lines: string[] = results.length ? ['RESULTS of your last command batch:'] : [];
      for (const r of results) {
        const status = r.blocked ? 'BLOCKED' : r.ok ? 'ok' : 'failed';
        lines.push(`- ${r.action}${r.ref != null ? ` ${r.ref}` : ''} → ${status}: ${r.message}`);
      }
      if (data['nudge']) {
        lines.push(
          'NOTE: your last reply CLAIMED an action ("I\'m opening…") but sent NO tool call and didn\'t deliver the ' +
            'words. Fix it NOW, in this reply: send the tool call (point/scroll/snapshot run freely; a click or input ' +
            'lands at the approval gate — the gate asks, so don\'t ask in words too), OR deliver the answer you ' +
            'promised, OR ask one concrete question. Never claim without doing. If the request already approved ' +
            'exactly this read-only action, send the tool call — do not re-ask.'
        );
      }
      const dropped = this.consumeDroppedNote();
      if (dropped) lines.push(dropped);
      return (
        lines.filter(Boolean).join('\n') +
        (lines.length ? '\n' : '') +
        trail +
        `CURRENT PAGE: ${route}\nCONSENT STATE: ${consentLine}\n\n` +
        `PAGE ELEMENTS (address controls by [ref] numbers):\n${this.snapshot.text}\n\n` +
        'The task is done only when EVERY part of the USER REQUEST is complete — one successful step is not the ' +
        'task. Decide now:\n' +
        '- Task complete → give a short wrap-up answering the original request, no tool call.\n' +
        '- Task not complete → send the NEXT tool call in this reply. Do not end the turn with a status report or ' +
        'a "want me to…?" offer while a step you are able to take remains — take it.'
      );
    }

    // lookup-result
    const lookup = data as {
      query?: string;
      params?: Record<string, unknown>;
      result?: Record<string, unknown>;
      repeated?: boolean;
      failed_streak?: boolean;
    };
    const lines: string[] = [`CURRENT TASK: ${this.task}`];
    lines.push(`DATA for ${lookup.query} (params: ${JSON.stringify(lookup.params ?? {})}) returned:\n${jsonClip(lookup.result ?? {}, 4000)}`);
    if (lookup.repeated) {
      lines.push('NOTE: you already ran this EXACT lookup earlier this run — what follows is the same cached data. Do not call it again; use it.');
    }
    if (lookup.failed_streak) {
      lines.push('SEVERAL lookups in a row have failed. Do NOT call request_data again this turn — ask the user a concrete question or answer from data you already have.');
    }
    if (lookup.result && typeof lookup.result === 'object' && 'error' in lookup.result) {
      lines.push("NOTE: this lookup FAILED (see the error above). It never ran — never claim you searched or checked anything. Say what you couldn't check and ask for the missing detail.");
    }
    const dropped = this.consumeDroppedNote();
    if (dropped) lines.push(dropped);
    return (
      lines.filter(Boolean).join('\n') +
      '\n' +
      trail +
      `CURRENT PAGE: ${route}\nCONSENT STATE: ${consentLine}\n\n` +
      'This is tool data, NOT a new user message. Respond to CURRENT TASK with it: if the data answers the ' +
      'question, answer with your short spoken line; if it only partly answers, say what you DO know honestly and ' +
      'offer the closest next step. Never greet, never say the message was empty or didn\'t come through.'
    );
  }

  private consumeDroppedNote(): string {
    if (!this.droppedTools?.length) return '';
    const note =
      `NOTE: your previous turn ALSO requested ${this.droppedTools.map((d) => `«${d}»`).join(' and ')} — only one ` +
      'tool call runs per turn, so that call was NOT executed. Send it again now if the task still needs it.';
    this.droppedTools = null;
    return note;
  }

  // --- tools ---------------------------------------------------------------

  private coerceCommands(raw: unknown): PilotCommand[] {
    if (!Array.isArray(raw)) return [];
    const out: PilotCommand[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const action = String(rec['action'] ?? '').toLowerCase();
      if (!['click', 'input', 'select', 'goto', 'scroll', 'point', 'snapshot'].includes(action)) continue;
      const cmd: PilotCommand = { action: action as PilotCommand['action'] };
      if (rec['ref'] != null && Number.isFinite(Number(rec['ref']))) cmd.ref = Number(rec['ref']);
      if (rec['path'] != null) cmd.path = String(rec['path']);
      if (rec['value'] != null) cmd.value = String(rec['value']);
      if (rec['direction'] === 'up' || rec['direction'] === 'down') cmd.direction = rec['direction'];
      out.push(cmd);
    }
    return out;
  }

  /** Gemini-style declarations wrapped for the OpenAI-format brains. */
  private pilotToolDeclarations(): Array<{ type: 'function'; function: Record<string, unknown> }> {
    return this.gem.pilotToolDeclarations().map((t) => ({ type: 'function' as const, function: { ...t } }));
  }
  private handleTool = async (explain: string, commands: PilotCommand[]): Promise<'go' | 'declined' | 'stopped'> => {
    const needsConsent = !this.consentGranted && commands.some((c) => ACTING_ACTIONS.has(c.action));

    if (needsConsent) {
      // The gate is structural: the batch is HELD here until the card is
      // answered — any acting batch while consent is ungranted lands here.
      const self = this;
      // A run must NEVER wedge on an unanswered gate: the card lives in the
      // chat sheet, which can be frozen on an inactive tab, so the bar
      // carries the answer buttons, and after 2 minutes the run declines
      // itself, honestly, without touching anything.
      const timer = setTimeout(() => {
        const held = self.heldBatch;
        if (!held) return;
        self.heldBatch = null;
        self.zone.run(() => self.consent$.next(null));
        overlay.setWaitingActions(null);
        overlay.updateDriveBar({ visible: false });
        self.pushNotice('I stopped waiting for your OK — nothing was touched. Ask again whenever you want.');
        held.resolve('declined');
      }, 120000);

      const verdict = await new Promise<'go' | 'declined' | 'stopped'>((resolve) => {
        self.heldBatch = {
          explain,
          commands,
          resolve: (v) => {
            clearTimeout(timer);
            resolve(v);
          },
        };
        overlay.setWaitingActions({ approve: () => self.approve(), decline: () => self.decline() });
        self.zone.run(() => {
          self.consent$.next({
            explain,
            commands: commands.map((c) => self.describeCommand(c)),
          });
          // The card lives in the chat sheet — if the pilot drove to another
          // tab, the bar carries the ask AND the answer buttons everywhere.
          // The explain rides as the step line so "OK / No" need no caption.
          self.updateBar(explain, true);
        });
      });
      overlay.setWaitingActions(null);
      if (verdict !== 'go') return verdict;
      // No hide-then-reshow here — the batch immediately re-labels the same
      // bar ("Taking the wheel…" → per-command steps) so there's no flicker.
      this.updateBar('Taking the wheel…', false);    }

    const takesOver = commands.some((c) => !SILENT_ACTIONS.has(c.action));
    if (takesOver) {
      this.setDriving(true);
      this.droveThisRun = true;
      // The wheel is taken: the page itself locks (taps land on the overlay
      // blocker) until the run ends — Stop on the drive bar stays live.
      overlay.setPageLock(true);
      this.updateBar(commands.map((c) => this.describeCommand(c))[0] ?? explain);
    } else {
      this.gem.thinkingLabel$.next('Reading the page…');
    }
    const stepsId = this.pushSteps(explain, commands, !takesOver);

    const self = this;
    const ctx: ExecuteContext = {
      entries: this.snapshot.byRef,
      snapshotText: this.snapshot.text,
      buildSnapshot: () => this.takeSnapshot(),
      navigate: (path) => this.zone.run(() => this.router.navigateByUrl(path)),
      signal: {
        get aborted(): boolean {
          return self.aborted; // Stop cuts the batch at the next command
        },
      },
      batchExplain: explain,
    };

    const { results } = await executeBatch(commands, ctx);

    // Audit (a selling point): the run's executed commands in user words,
    // appended per batch, local only (last 50).
    auditAppend({
      ts: Date.now(),
      explain,
      commands: commands.map((c) => this.describeCommand(c)),
      route: this.router.url,
    });

    this.trail.push(
      ...results.map(
        (r) =>
          `${r.action}${r.ref != null ? `(${r.ref})` : ''} → ${r.blocked ? 'BLOCKED' : r.ok ? 'ok' : 'failed'}: ${r.message.slice(0, 160)}`
      )
    );

    this.gem.updatePilotRow(stepsId, results);
    if (takesOver) this.setDriving(false);
    else this.gem.thinkingLabel$.next('');

    // --- loop protection -------------------------------------------------------
    // Keys normalize commands; a toggle that renames itself per state produces
    // a different key each flip and dodges the identical guard — so A-B-A
    // alternation counts DOUBLE.
    const batchKey = JSON.stringify(commands.map((c) => [c.action, c.ref ?? c.path ?? c.value ?? null]));
    const allFailed = results.length > 0 && results.every((r) => !r.ok);

    // (a) an identical batch whose results ALL failed twice in a row → stop
    if (allFailed && this.lastBatchKey === batchKey && this.lastBatchAllFailed) {
      this.pushNotice("The same steps keep failing — I'm stopping rather than spinning. Want to rephrase, or take it from here yourself?");
      return 'stopped';
    }
    this.lastBatchAllFailed = allFailed;
    this.lastBatchKey = batchKey;

    // (b/c) identical batches ×3 → warning; ×6 → stop; A-B-A counts double.
    if (batchKey === this.identicalStreakKey) this.identicalStreak += 1;
    else {
      this.identicalStreakKey = batchKey;
      this.identicalStreak = 1;
    }
    const oscillating = batchKey === this.twoAgoKey;
    this.twoAgoKey = this.prevBatchKey;
    this.prevBatchKey = batchKey;
    this.oscillation = oscillating ? this.oscillation + 1 : 0;
    const loopCount = Math.max(this.identicalStreak, this.oscillation * 2);
    if (loopCount >= 6) {
      this.pushNotice("The same steps keep landing in the same place — I'm stopping rather than spinning. Tell me what I'm missing and I'll pick it up from there.");
      return 'stopped';
    }
    const loopWarning: PilotCommandResult | null =
      loopCount >= 3
        ? {
            action: 'repeat',
            ok: false,
            message:
              this.oscillation >= 2
                ? "this batch is ping-ponging with the previous one — classic toggle flip-flop: a toggle's label describes the action from the CURRENT state, so if the page already shows the state the user asked for, that step is DONE. Move to the next part of the task."
                : `identical batch repeated ${this.identicalStreak}× — this exact sequence is not progressing. Change the PATH, not just the ref: take a fresh snapshot, go via a different screen (bottom tab bar), scroll, use a different control for the same goal — or tell the user this control doesn't exist.`,
          }
        : null;

    this.lastBatchResults = loopWarning ? [...results, loopWarning] : results;
    if (this.aborted) return 'stopped';
    return 'go';
  };

  /** Read-only data request — reuses existing app services. Cached per run:
   *  an identical repeat is served from cache with a "repeated" flag; 3
   *  failed lookups in a row → the model is told to stop querying. */
  private async handleLookup(
    query: string,
    params: Record<string, unknown>
  ): Promise<{ query: string; params: Record<string, unknown>; result: Record<string, unknown>; repeated?: boolean; failed_streak?: boolean }> {
    const cacheKey = `${query}|${JSON.stringify(params, Object.keys(params).sort())}`;
    const isRepeat = this.lookupCache.has(cacheKey);
    const streakBreached = this.failedLookupStreak >= 2;

    let result: Record<string, unknown>;
    if (streakBreached) {
      result = { error: 'repeated lookup failures — stop querying and ask the user a concrete question' };
      this.trail.push('lookup abandoned after repeated failures');
    } else if (isRepeat) {
      result = this.lookupCache.get(cacheKey)!;
      this.trail.push(`lookup ${query} — repeat, served the SAME cached data`);
    } else {
      try {
        result = await this.runLookup(query, params);
        this.failedLookupStreak = 0;
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) };
        this.failedLookupStreak += 1;
      }
      this.lookupCache.set(cacheKey, result);
      this.trail.push(`lookup ${query} → ${jsonClip(result, 300)}`);
    }

    return {
      query,
      params,
      result,
      repeated: isRepeat && !streakBreached ? true : undefined,
      failed_streak: streakBreached ? true : undefined,
    };
  }

  private async runLookup(query: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const pos = this.location.position;
    void params;
    switch (query) {
      case 'trip_status':
        return { status: this.nav.tripStatusText(), phase: this.nav.phase };
      case 'app_settings':
        return {
          dark_mode: this.settings.dark,
          satellite_view: this.settings.satellite,
          simulate_travel: this.settings.simMode,
          demo_speed: this.settings.simSpeed$.value,
          travel_mode: this.settings.profile === 'foot-walking' ? 'walking' : 'driving',
        };
      case 'recent_places':
        return {
          note: 'Community places near the user that the map already knows. Search for anything specific.',
          nearby: this.community.localPool().slice(0, 5).map((p) => ({ name: p.name, rating: p.rating.average, likes: p.likes })),
        };
      case 'service_area':
        return {
          center: 'General Tinio, Nueva Ecija',
          radius_km: Math.round(GENERAL_TINIO_SERVICE_RADIUS_M / 1000),
          note: 'Routes are only plotted inside this radius; places outside must be declined honestly.',
        };
      case 'current_route': {
        const route = this.nav.navState$.value.route;
        if (!route) return { note: 'No route plotted right now. Use get_directions to plot one.' };
        return {
          destination: route.destination.name,
          distance_km: Number((route.distanceM / 1000).toFixed(1)),
          eta_minutes: Math.max(1, Math.round(route.durationS / 60)),
          travel_mode: route.profile === 'foot-walking' ? 'walking' : 'driving',
          steps: route.steps.length,
        };
      }
      case 'current_location':
        if (!pos) return { error: 'GPS has no fix yet — the user must enable location.' };
        return {
          lat: Number(pos.lat.toFixed(5)),
          lng: Number(pos.lng.toFixed(5)),
          accuracy_m: pos.accuracy ?? null,
          simulated: pos.simulated ?? false,
        };
      case 'weather':
        if (!pos) return { error: 'GPS has no fix yet.' };
        return this.gem.weatherAt(pos.lat, pos.lng);
      default:
        return {
          error: `unknown query "${query}" — valid: trip_status, app_settings, recent_places, service_area, current_route, current_location, weather`,
        };
    }
  }

  // --- end -----------------------------------------------------------------

  private finalize(replyOverride?: string): string {
    // The stop notice lands here so EVERY abort path ends the same way.
    if (this.aborted && !this.stopNoticeShown) {
      this.stopNoticeShown = true;
      this.pushNotice('Stopped — your call. Say the word when you want me again.');
    }
    this.setDriving(false);
    overlay.setPageLock(false); // the page is the user's again
    overlay.setWaitingActions(null);
    this.zone.run(() => this.active$.next(false));
    overlay.updateDriveBar({ visible: false });
    overlay.hideCursor();
    overlay.hideHighlight();
    this.heldBatch = null;
    return replyOverride ?? '';
  }
}
