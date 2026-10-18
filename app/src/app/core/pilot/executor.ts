/**
 * NavBudol Pilot — command executor (the pilot's hands).
 *
 * Runs the model's invoke_screen command batches against the real page:
 * resolve ref → scroll to it → glide the cursor → highlight → act → settle
 * → fresh snapshot. Every command returns a structured result fed back to
 * the model.
 *
 * Safety enforced HERE, never trusted to the model:
 *  - [DESTRUCTIVE]-labeled controls are never clicked —
 *    ok:false, blocked:"destructive controls are yours to press"
 *  - refs that vanished never resolve to guesses ("take a snapshot")
 *  - goto only moves to whitelisted in-app routes (/tabs/*, /place/*, /add-place)
 *
 * Refs resolve through the element CAPTURED at snapshot time — zoneless
 * Ionic re-renders invalidate attributes, so a re-query would click the
 * wrong control. A captured node that got detached is re-anchored via tag +
 * accessible name against the live DOM; nameless entries never guess.
 */

import * as overlay from './overlay';
import { netPending } from './net-watch';
import { PilotElementEntry } from './snapshot';

export interface PilotCommand {
  action: 'click' | 'input' | 'select' | 'goto' | 'scroll' | 'point' | 'snapshot';
  ref?: number;
  value?: string;
  path?: string;
  direction?: 'up' | 'down';
}

export interface PilotCommandResult {
  action: string;
  ref?: number;
  ok: boolean;
  blocked?: boolean;
  message: string;
}

export interface ExecuteContext {
  entries: Map<number, PilotElementEntry>;
  snapshotText: string;
  buildSnapshot(): { text: string; entries: PilotElementEntry[]; byRef: Map<number, PilotElementEntry> };
  navigate(path: string): Promise<boolean>;
  signal: { aborted: boolean };
  batchExplain: string;
}

// In-app routes the pilot may drive to. Anything else is refused.
const GOTO_WHITELIST = [/^\/tabs(\/[a-z0-9-]+)?\/?$/, /^\/place\/[A-Za-z0-9_-]+$/, /^\/add-place\/?$/];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normalizeGotoPath(raw: string): string | null {
  const path = raw.trim();
  if (!path.startsWith('/')) return null;
  if (!GOTO_WHITELIST.some((re) => re.test(path))) return null;
  return path;
}

function throwIfAborted(signal: ExecuteContext['signal']): void {
  if (signal.aborted) throw new DOMException('aborted', 'AbortError');
}

/** Interactive selector used ONLY for re-anchoring a detached entry. */
const REANCHOR_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  'ion-toggle',
  'ion-checkbox',
  'ion-radio',
].join(',');

function liveName(el: HTMLElement): string {
  return (el.getAttribute('aria-label') || (typeof el.innerText === 'string' ? el.innerText : '') || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Zoneless Ionic re-renders REPLACE nodes, so a captured element can be
 * detached while the SAME control is still on screen. Before declaring a
 * ref stale, re-anchor by matching tag + accessible name against live
 * elements (nearest to the old position wins same-named twins). Nameless
 * matches are never guessed — "take a snapshot" instead.
 */
function reAnchorToLive(entry: PilotElementEntry): HTMLElement | null {
  if (!entry.name) return null;
  const wanted = entry.name.toLowerCase();
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(REANCHOR_SELECTOR))) {
    if (el.closest('[data-nbpilot-ignore]') || el.closest('[aria-hidden="true"]')) continue;
    if (el.tagName.toLowerCase() !== entry.tag) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (liveName(el) !== wanted) continue;
    if (entry.rect) {
      const dist = Math.hypot(r.x + r.width / 2 - (entry.rect.x + entry.rect.w / 2), r.y + r.height / 2 - (entry.rect.y + entry.rect.h / 2));
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    } else {
      best = el;
      break;
    }
  }
  return best;
}

function resolveTarget(ref: number | null | undefined, ctx: ExecuteContext): { entry: PilotElementEntry; el: HTMLElement } | null {
  if (ref == null) return null;
  const entry = ctx.entries.get(Number(ref));
  if (!entry) return null;
  if (entry.el && document.contains(entry.el)) return { entry, el: entry.el };
  const live = reAnchorToLive(entry);
  if (live) {
    entry.el = live; // re-captured: later commands in this batch use it too
    return { entry, el: live };
  }
  return null;
}

/**
 * Wait for the page to actually settle: the in-flight fetch/XHR counter
 * quiet ~400ms AND DOM mutations quiet, then one NgZone.run + ~350ms
 * (zoneless Ionic renders on microtasks/rAF — kicking the zone lets CD
 * flush before we read the DOM). Capped at 6.5s; then a FRESH snapshot.
 */
async function waitForPageSettle(ctx: ExecuteContext): Promise<{ text: string; entries: PilotElementEntry[] }> {
  const deadline = Date.now() + 6500;
  let lastMutation = Date.now();
  const observer = new MutationObserver(() => {
    lastMutation = Date.now();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    while (Date.now() < deadline) {
      // 400ms of DOM quiet AND no in-flight fetch/XHR — quiescence alone
      // snapshots mid-fetch states.
      if (Date.now() - lastMutation >= 400 && netPending() === 0) break;
      await sleep(110);
    }
    await sleep(350); // let the final mutation's renders paint
  } finally {
    observer.disconnect();
  }
  const snap = ctx.buildSnapshot();
  return { text: snap.text, entries: snap.entries };
}

async function aimAt(entry: PilotElementEntry, el: HTMLElement, opts: { danger?: boolean; label?: string } = {}): Promise<{ x: number; y: number }> {
  const { x, y } = overlay.centerOf(el);
  await overlay.moveCursorTo(x, y, { label: opts.label, mode: opts.danger ? 'danger' : 'default' });
  overlay.showHighlight(el, !!opts.danger);
  return { x, y };
}

/** Real pointer sequence with coordinates — Ionic controls trust it. */
function realClick(el: HTMLElement): void {
  const { x, y } = overlay.centerOf(el);
  const base: PointerEventInit & MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };
  try {
    el.dispatchEvent(new PointerEvent('pointerdown', base));
    el.dispatchEvent(new PointerEvent('pointerup', base));
  } catch {
    /* PointerEvent unsupported — the plain click below still works */
  }
  el.dispatchEvent(new MouseEvent('click', { ...base, detail: 1 }));
}

function writableFieldFor(el: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  if (el.isContentEditable) return null;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el as HTMLInputElement | HTMLTextAreaElement;
  return el.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea');
}

async function runOne(cmd: PilotCommand, ctx: ExecuteContext): Promise<PilotCommandResult> {
  const action = String(cmd.action || '').toLowerCase();
  const ref = cmd.ref != null ? Number(cmd.ref) : null;
  const value = cmd.value != null ? String(cmd.value) : '';
  throwIfAborted(ctx.signal);

  if (action === 'goto') {
    const path = normalizeGotoPath(String(cmd.path || value || ''));
    if (!path) {
      return {
        action,
        ok: false,
        message: `goto refused — only in-app routes are allowed: /tabs/map, /tabs/chat, /tabs/settings, /place/<id>, /add-place. Ask the user to press that control yourself if it lives elsewhere.`,
      };
    }
    overlay.hideHighlight();
    await ctx.navigate(path);
    await waitForPageSettle(ctx);
    return { action, ok: true, message: `navigated to ${path}` };
  }

  if (action === 'snapshot') {
    const snap = ctx.buildSnapshot();
    ctx.entries = snap.byRef;
    return { action, ok: true, message: `snapshot taken — ${snap.entries.length} elements` };
  }

  if (action === 'scroll') {
    const target = ref != null ? resolveTarget(ref, ctx) : null;
    if (cmd.ref != null && !target) {
      return { action, ref: ref ?? undefined, ok: false, message: `ref ${ref} not found — take a snapshot` };
    }
    if (target) {
      target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      // Scroll the scrollable container nearest the viewport center (ion-content
      // scrolls itself — window.scrollBy never reaches fields inside sheets).
      const dir = cmd.direction === 'up' ? -420 : 420;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      let chosen: HTMLElement | null = null;
      let bestArea = Infinity;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('ion-content, ion-scroll, div'))) {
        if (el.closest('[data-nbpilot-ignore]')) continue;
        const s = getComputedStyle(el);
        if (!/(auto|scroll)/.test(s.overflowY) || !s.overflowY) continue;
        if (el.scrollHeight <= el.clientHeight + 4 || el.clientHeight < 120) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 100 || r.height < 100) continue;
        if (!(cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom)) continue;
        const area = r.width * r.height;
        if (area < bestArea) {
          bestArea = area;
          chosen = el;
        }
      }
      if (chosen) chosen.scrollBy({ top: dir, behavior: 'smooth' });
      else window.scrollBy({ top: dir, behavior: 'smooth' });
    }
    await sleep(450);
    throwIfAborted(ctx.signal);
    return { action, ref: ref ?? undefined, ok: true, message: 'scrolled' };
  }

  const target = resolveTarget(ref, ctx);
  if (!target) {
    // Tell the model WHAT it lost — a bare ref number gives nothing to recover with.
    const stale = ctx.entries.get(Number(ref));
    const was = stale?.name ? ` ("${stale.name}")` : '';
    return {
      action,
      ref: ref ?? undefined,
      ok: false,
      message: `ref ${ref}${was} no longer exists — take a snapshot and use a fresh ref`,
    };
  }

  const danger = !!target.entry.dangerous;

  if (action === 'point') {
    await aimAt(target.entry, target.el, { danger });
    await sleep(150);
    return { action, ref: target.entry.ref, ok: true, message: `pointing at "${target.entry.name || ref}"` };
  }

  if (action === 'click') {
    if (target.entry.dangerous) {
      await aimAt(target.entry, target.el, { danger: true });
      return {
        action,
        ref: target.entry.ref,
        ok: false,
        blocked: true,
        message: `BLOCKED: "${target.entry.name}" deletes or resets something — destructive controls are yours to press. Do everything else the task needs, then hand the user exactly this one press.`,
      };
    }
    target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(250);
    throwIfAborted(ctx.signal);
    const { x, y } = await aimAt(target.entry, target.el, { label: ctx.batchExplain });
    await sleep(180);
    throwIfAborted(ctx.signal);
    overlay.pulseAt(x, y);
    // Portal tracking: Ionic alert/action-sheet/modal/toast attach under
    // ion-app (or body) — a click can OPEN one or CLOSE the one already
    // open; the model must know which.
    const overlayHosts: ParentNode[] = [document.body, document.querySelector('ion-app') ?? document.body];
    const isPortal = (el: Element): boolean =>
      el.id === 'nbpilot-overlay-root' ||
      ['ION-ALERT', 'ION-ACTION-SHEET', 'ION-MODAL', 'ION-TOAST', 'ION-POPOVER', 'ION-LOADING'].includes(el.tagName) ||
      getComputedStyle(el).position === 'fixed';
    const portalsBefore = overlayHosts.flatMap((host) => Array.from(host.children)).filter(isPortal);
    const clickedInPortal = portalsBefore.some((p) => p.contains(target.el));
    realClick(target.el);
    await waitForPageSettle(ctx);
    throwIfAborted(ctx.signal);
    const portalsAfter = overlayHosts.flatMap((host) => Array.from(host.children)).filter(isPortal);
    let portalNote = '';
    if (portalsAfter.length > portalsBefore.length) {
      portalNote = ' — a popup/menu OPENED from this click; its controls are in the fresh snapshot, act on them directly (do not click the trigger again)';
    } else if (portalsAfter.length < portalsBefore.length && clickedInPortal) {
      portalNote = ' — the popup closed after your selection; that is normal — the value is set, move on';
    } else if (portalsAfter.length < portalsBefore.length) {
      portalNote = ' — the popup that was open is now CLOSED (this trigger toggles it)';
    }
    return { action, ref: target.entry.ref, ok: true, message: `clicked "${target.entry.name || ref}"${portalNote}` };
  }

  if (action === 'input') {
    if (!value) return { action, ref: target.entry.ref, ok: false, message: 'input requires a value' };
    if (target.entry.dangerous) {
      return { action, ref: target.entry.ref, ok: false, blocked: true, message: 'BLOCKED: destructive control.' };
    }
    target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    throwIfAborted(ctx.signal);
    await aimAt(target.entry, target.el, { label: ctx.batchExplain });

    // Resolve the element that can actually hold text; inputs point at the
    // wrapper (row/label captured by the pointer scan) otherwise.
    let writable = target.el.tagName === 'INPUT' || target.el.tagName === 'TEXTAREA' ? (target.el as HTMLInputElement | HTMLTextAreaElement) : writableFieldFor(target.el);
    if (!writable) {
      return {
        action,
        ref: target.entry.ref,
        ok: false,
        message: `ref ${ref} resolved to a <${target.el.tagName.toLowerCase()}${target.entry.name ? ` "${target.entry.name}"` : ''}>, which can't hold typed text — take a snapshot and target the input field itself`,
      };
    }
    try {
      writable.focus();
    } catch {
      /* detached */
    }
    const applyValue = (el: HTMLInputElement | HTMLTextAreaElement) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
      // Both worlds: plain Angular fields listen to 'input'; Ionic's
      // ion-input/ion-textarea/ion-searchbar listen for 'ionInput'.
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new CustomEvent('ionInput', { bubbles: true, composed: true, detail: { value, isTrusted: true } }));
    };
    applyValue(writable);
    await sleep(250);
    // Read-back: controlled inputs and validation can silently reject a
    // fill — report what the field ACTUALLY holds.
    let readBack = String(writable.value ?? '');
    if (readBack !== value) {
      const re = resolveTarget(ref, ctx);
      if (re) {
        writable = re.el.tagName === 'INPUT' || re.el.tagName === 'TEXTAREA' ? (re.el as HTMLInputElement | HTMLTextAreaElement) : writableFieldFor(re.el) ?? writable;
        applyValue(writable);
        await sleep(250);
        readBack = String(writable.value ?? '');
      }
    }
    if (readBack === value) {
      return { action, ref: target.entry.ref, ok: true, message: `filled "${value}" into ${target.entry.name ? `"${target.entry.name}"` : `field ${ref}`} — verified, the field reads it back` };
    }
    return {
      action,
      ref: target.entry.ref,
      ok: false,
      message: `typed "${value}" but the field reads "${readBack || '(empty)'}" — it rejected or cleared the input. Take a snapshot, find the real input, and fill that.`,
    };
  }

  if (action === 'select') {
    const el = target.el;
    if (el.tagName === 'SELECT') {
      const options = Array.from((el as HTMLSelectElement).options);
      const match = options.find((o) => o.text.trim().toLowerCase() === value.toLowerCase() || o.value === value);
      if (!match) {
        return { action, ref: target.entry.ref, ok: false, message: `no option "${value}" — options: ${options.map((o) => o.text.trim()).slice(0, 8).join(' | ')}` };
      }
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, match.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new CustomEvent('ionChange', { bubbles: true, composed: true, detail: { value: match.value } }));
      await sleep(250);
      return { action, ref: target.entry.ref, ok: true, message: `selected "${match.text.trim()}"` };
    }
    if (el.tagName === 'ION-SELECT') {
      // Open the alert, then click the matching [role=option] (or radio) inside it.
      const { x, y } = await aimAt(target.entry, el, { label: ctx.batchExplain });
      overlay.pulseAt(x, y);
      realClick(el);
      await sleep(500);
      throwIfAborted(ctx.signal);
      const options = Array.from(
        document.querySelectorAll<HTMLElement>('.alert-wrapper [role="option"], .alert-wrapper [role="radio"], .alert-wrapper button.alert-radio, ion-alert button')
      );
      const match = options.find((o) => liveName(o).includes(value.toLowerCase()));
      if (!match) {
        await waitForPageSettle(ctx);
        return { action, ref: target.entry.ref, ok: false, message: `no option "${value}" found in the opened dialog — take a snapshot and pick by ref` };
      }
      const optName = match.textContent?.trim().slice(0, 60) || value;
      const p2 = await aimAt({ ...target.entry, name: optName, el: match }, match, {});
      overlay.pulseAt(p2.x, p2.y);
      realClick(match);
      await sleep(350);
      // Confirm the alert (OK button) when present.
      const okBtn = Array.from(document.querySelectorAll<HTMLButtonElement>('.alert-wrapper button.alert-button, ion-alert button')).find((b) => /^(ok|done)$/i.test(b.textContent?.trim() || ''));
      if (okBtn) {
        realClick(okBtn);
      }
      await waitForPageSettle(ctx);
      el.dispatchEvent(new CustomEvent('ionChange', { bubbles: true, composed: true, detail: { value } }));
      return { action, ref: target.entry.ref, ok: true, message: `selected "${match.textContent?.trim().slice(0, 60) || value}"` };
    }
    // Custom dropdown: open it, model picks the option by ref from the fresh snapshot.
    target.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(200);
    throwIfAborted(ctx.signal);
    const { x, y } = await aimAt(target.entry, target.el, { label: ctx.batchExplain });
    overlay.pulseAt(x, y);
    realClick(target.el);
    await sleep(450);
    const snap = ctx.buildSnapshot();
    ctx.entries = snap.byRef;
    return { action, ref: target.entry.ref, ok: true, message: 'dropdown opened — snapshot taken; click the option by ref' };
  }

  return { action, ref: target.entry.ref, ok: false, message: `unknown action "${action}"` };
}

/**
 * Execute a batch. The consent gate lives in the caller (run.service) —
 * mutating batches arrive pre-approved or read-only. `signal` makes Stop
 * cut the batch short at the next command boundary.
 */
export async function executeBatch(commands: PilotCommand[], ctx: ExecuteContext): Promise<{ results: PilotCommandResult[] }> {
  const results: PilotCommandResult[] = [];

  for (const cmd of commands) {
    if (ctx.signal.aborted) break;
    let result: PilotCommandResult;
    try {
      result = await Promise.race([
        runOne(cmd, ctx),
        sleep(45000).then(
          (): PilotCommandResult => ({
            action: String(cmd.action || ''),
            ref: cmd.ref,
            ok: false,
            message: 'command timed out after 45s — take a snapshot and try a different approach',
          })
        ),
      ]);
      ctx.entries = ctx.entries; // entries may be updated inside runOne via ctx
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') break;
      result = {
        action: String(cmd.action || ''),
        ref: cmd.ref,
        ok: false,
        message: `executor error: ${(err as Error)?.message || String(err)} (while ${cmd.action || 'acting'}${cmd.ref != null ? ` on ref ${cmd.ref}` : ''})`,
      };
    }
    results.push(result);
    if (result.blocked) break; // destructive refusal ends the batch
    if (result.ok === false && ['click', 'goto'].includes(String(cmd.action))) break;
  }

  return { results };
}
