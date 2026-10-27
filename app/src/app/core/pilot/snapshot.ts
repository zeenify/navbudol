/**
 * NavBudol Pilot — element snapshot (the pilot's eyes).
 *
 * Builds the numbered registry of interactive elements the agent addresses
 * by ref ("click 17"), the way browser agents do: enumerate → number → the
 * model picks. Ported from the EUNA Pilot.
 *
 * The output is a TREE, not a flat ref wall:
 *   Page: <title> — <path> (theme: …)
 *   == "Section heading" (section heading — …)
 *   ## pointer-card owner (a row/card the UI marks clickable)
 *     [12] button "…"
 * Headings and clickable-card owners open sections; their controls nest
 * under them; every control stays addressable by its global [ref].
 *
 * The chat panel marks itself [data-nbpilot-ignore], so the pilot never
 * tries to operate itself.
 */

export const MAX_ELEMENTS = 220;
export const NAME_LIMIT = 60;
export const MAX_SNAPSHOT_CHARS = 20000;

export interface PilotElementEntry {
  ref: number;
  tag: string;
  role: string;
  name: string;
  href?: string;
  input?: boolean;
  value?: string;
  disabled?: boolean;
  clickable?: boolean;
  belowFold?: boolean;
  dangerous?: boolean;
  on?: boolean;
  owner?: string;
  rect: { x: number; y: number; w: number; h: number };
  el: HTMLElement;
}

export interface ElementSnapshot {
  text: string;
  entries: PilotElementEntry[];
  byRef: Map<number, PilotElementEntry>;
}

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  // Ionic's interactive custom elements are NOT <button> tags — without
  // these the snapshot never sees the tab bar, back buttons, segments or
  // FABs, and a click-only pilot has no wayfinding at all.
  'ion-button',
  'ion-back-button',
  'ion-tab-button',
  'ion-fab-button',
  'ion-segment-button',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="combobox"]',
  '[role="option"]',
  '[role="switch"]',
  'ion-toggle',
  'ion-checkbox',
  'ion-radio',
  'ion-searchbar',
  // Wayfinding — page titles and section labels live here; without them
  // the model can't tell cards apart ("two rows but which is Dark Mode?").
  'h1',
  'h2',
  'h3',
  'h4',
].join(',');

// A destructive control. Tested on the LABEL, not the dialog: per-row
// Delete buttons sit outside dialogs and are exactly the ones a driving
// agent fat-fingers. The executor refuses to click these regardless of any
// consent — the user's own finger finishes destructive actions.
const DESTRUCTIVE_RE = /\b(delete|remove|confirm|clear|sign out|logout|reset|stop navigation)\b/i;

// Capture window: the WHOLE page, top to bottom. A partial snapshot teaches
// the model "this page has no <thing>" while the thing is one scroll away —
// the #1 cause of stuck loops. The executor scrolls to refs before acting,
// so far-below-fold entries are fully actionable; each carries a ~distance
// hint so the brain knows the section it belongs to.
function belowFoldMargin(): number {
  return Math.max(document.body.scrollHeight, window.innerHeight * 3) + 600;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  const margin = belowFoldMargin();
  if (rect.bottom < -margin || rect.right < 0) return false;
  if (rect.top > window.innerHeight + margin || rect.left > window.innerWidth + 200) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (parseFloat(style.opacity) === 0) return false;
  return true;
}

function stateOf(el: HTMLElement): boolean | undefined {
  if (el.tagName === 'ION-TOGGLE' || el.tagName === 'ION-CHECKBOX' || el.tagName === 'ION-RADIO') {
    return el.hasAttribute('aria-checked')
      ? el.getAttribute('aria-checked') === 'true'
      : (el as unknown as { checked?: boolean }).checked === true;
  }
  if (el.tagName === 'INPUT') {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') return (el as HTMLInputElement).checked;
  }
  if (el.getAttribute('role') === 'switch') return el.getAttribute('aria-checked') === 'true';
  return undefined;
}

function describeElement(el: HTMLElement, ref: number): PilotElementEntry {
  const role =
    el.getAttribute('role') ||
    (el.tagName === 'A' ? 'link' : el.tagName === 'BUTTON' || el.tagName === 'ION-BUTTON' ? 'button' : el.tagName.toLowerCase());
  let name = (
    el.getAttribute('aria-label') ||
    (typeof el.innerText === 'string' ? el.innerText : '') ||
    el.getAttribute('title') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('value') ||
    ''
  )
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, NAME_LIMIT);
  // Toggles, checkboxes and bare inputs usually carry no text of their own —
  // borrow the human-visible row/label name (checked BEFORE the entries loop
  // drops unnamed controls).
  if (!name && el.tagName === 'ION-BACK-BUTTON') {
    const custom = el.getAttribute('aria-label');
    name = custom && custom.trim() ? custom.trim().slice(0, NAME_LIMIT) : 'Back';
  }
  if (!name) name = labelFromContext(el);
  const rect = el.getBoundingClientRect();

  const entry: PilotElementEntry = {
    ref,
    tag: el.tagName.toLowerCase(),
    role,
    name,
    el,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
  };

  const href = el.getAttribute('href');
  if (href && href.startsWith('/')) entry.href = href;

  const state = stateOf(el);
  if (state !== undefined) entry.on = state;

  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    entry.input = true;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type !== 'password' && (el as HTMLInputElement).value) {
      entry.value = String((el as HTMLInputElement).value).slice(0, 40);
    }
    if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) entry.disabled = true;
  }
  if (el.tagName === 'ION-SEARCHBAR' || el.tagName === 'ION-INPUT') entry.input = true;
  if ((el as HTMLButtonElement).disabled) entry.disabled = true;

  // Scrolled out of view but present — the executor scrolls to refs before
  // acting, so this is a "you'll need to scroll" hint, not a limit.
  if (rect.y > window.innerHeight) entry.belowFold = true;

  // Affordance signal: non-button elements the UI itself marks clickable
  // (cursor: pointer) — cards, rows, list items. Without this the pilot
  // sees a heading or an ion-item and assumes it's inert.
  if (!el.matches('a,button,input,textarea,select')) {
    try {
      if (getComputedStyle(el).cursor === 'pointer') entry.clickable = true;
    } catch {
      /* detached — no style */
    }
  }

  if ((el.tagName === 'BUTTON' || role === 'button') && DESTRUCTIVE_RE.test(name)) {
    entry.dangerous = true;
  }

  return entry;
}

const HEADING_TAG_RE = /^h[1-4]$/;

function entryLine(entry: PilotElementEntry): string {
  // Headings read as SECTION headers, not buttons — wayfinding first.
  if (HEADING_TAG_RE.test(entry.tag)) {
    return `== "${entry.name}" (section heading — everything below it until the next heading belongs to it)`;
  }
  let line = `  [${entry.ref}] ${entry.role}`;
  if (entry.name) line += ` "${entry.name}"`;
  if (entry.href) line += ` → ${entry.href}`;
  if (entry.on !== undefined) line += entry.on ? ' · ON' : ' · OFF';
  if (entry.clickable) line += ' · clickable';
  if (entry.belowFold) {
    const vh = window.innerHeight || 800;
    const screens = Math.max(1, Math.round((entry.rect.y - vh) / Math.max(vh, 1)));
    line += ` · below fold (~${screens} screen${screens === 1 ? '' : 's'} down)`;
  }
  if (entry.input) line += ' (text input)';
  if (entry.value !== undefined) line += ` value: "${entry.value}"`;
  if (entry.disabled) line += ' [disabled]';
  if (entry.dangerous) line += ' [DESTRUCTIVE — never click]';
  return line;
}

function cardNameOf(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button,input,textarea,select,svg,ion-icon,[data-nbpilot-ignore]').forEach((x) => x.replaceWith(' '));
  return ((clone.innerHTML.replace(/<[^>]*>/g, ' ') || '').replace(/\s+/g, ' ').trim().slice(0, NAME_LIMIT));
}

/**
 * A visible label for controls that carry none of their own — Ionic
 * toggles/checkboxes in labeled rows ("Dark Mode … [toggle]"). The name the
 * human reads lives in a `.row-title` / ion-label / first text line of the
 * surrounding row; without borrowing it the control is unnameable and the
 * pilot spends its whole run scrolling after a toggle it can never see.
 */
function labelFromContext(el: HTMLElement): string {
  const clean = (s: string | null | undefined): string => String(s ?? '').replace(/\s+/g, ' ').trim();
  const id = el.getAttribute('id');
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) return clean(label.textContent).slice(0, NAME_LIMIT);
  }
  let node = el.parentElement;
  for (let depth = 0; node && node !== document.body && depth < 6; depth++, node = node.parentElement) {
    if (node.tagName === 'LABEL') return clean(node.textContent).slice(0, NAME_LIMIT);
    // Named row part — .row-title, ion-label, or a heading inside the row.
    const part = node.querySelector<HTMLElement>('.row-title, ion-label, .section-label, h1, h2, h3, h4');
    if (part) {
      const text = clean(part.textContent);
      if (text) return text.slice(0, NAME_LIMIT);
    }
    // Last resort within this row: the row's own first bits of text.
    if (depth >= 2) {
      const own = clean(node.childNodes.length ? Array.from(node.childNodes).map((n) => (n.textContent ?? '')).join(' ') : '');
      if (own) return own.slice(0, NAME_LIMIT);
    }
  }
  return '';
}

/**
 * Build the snapshot: { text } goes into the prompt, entries power executor
 * ref resolution. Refs are resolved through the CAPTURED element, never by
 * re-querying an attribute — zoneless re-renders invalidate attributes.
 */
export function buildElementSnapshot(): ElementSnapshot {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)).filter((el) => {
    if (el.closest('[data-nbpilot-ignore]')) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return isVisible(el);
  });

  const entries: PilotElementEntry[] = [];
  let lastOwner: string | null = null;
  // Ionic applies dark mode via a `.dark` class on <body> (SettingsService).
  // The theme is otherwise invisible to a snapshot — the toggle's label
  // "Dark Mode" describes the OPPOSITE state. Naming the CURRENT state ends
  // the switch-to-dark flip-flop: the model can see the goal is already met.
  const theme = document.body.classList.contains('dark') ? 'dark' : 'light';
  const lines = [`Page: ${document.title} — ${window.location.pathname} (theme: ${theme})`];

  // Pointer-origin cards are discovered FIRST (before refs are assigned) so
  // every control inside them is annotated with its owner — with several
  // settings rows on screen the bare "ON/OFF" toggle is meaningless.
  const captured = new Set<HTMLElement>();
  const cardOwners = new Map<HTMLElement, string>();
  const declaresPointer = (el: HTMLElement): boolean => {
    try {
      if (getComputedStyle(el).cursor !== 'pointer') return false;
      const parent = el.parentElement;
      return !parent || getComputedStyle(parent).cursor !== 'pointer';
    } catch {
      return false;
    }
  };
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('div,li,ion-item,ion-card,span,p'))) {
    if (cardOwners.size >= 24) break;
    if (el.closest('[data-nbpilot-ignore]') || el.closest('[aria-hidden="true"]')) continue;
    if (el.matches('a,button,input,textarea,select,label,[role="button"],h1,h2,h3,h4,ion-toggle,ion-checkbox,ion-radio,ion-searchbar')) continue;
    if (!isVisible(el) || !declaresPointer(el)) continue;
    // A pointer wrapper around form fields is noise — the field itself is
    // the actionable thing.
    if (el.querySelector('input,textarea,select')) continue;
    const name = cardNameOf(el);
    if (name.length < 2) continue;
    cardOwners.set(el, name);
  }
  const ownerOf = (el: HTMLElement): string | null => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const owner = cardOwners.get(node);
      if (owner) return owner;
      node = node.parentElement;
    }
    return null;
  };

  // Cap priority — interaction relevance:
  //   0. floating portals attached to body (ion action sheets, alerts, menus)
  //   1. inside an open ion modal/alert — the covered background is not what
  //      the user can act on right now
  //   2. the rest of the page (in-viewport before below-fold)
  const vh = window.innerHeight;
  const DIALOG_SEL = 'ion-alert, ion-modal, ion-action-sheet, ion-toast, [role="dialog"]';
  const rankOf = (el: HTMLElement): number => {
    const p = el.parentElement;
    if (p === document.body && getComputedStyle(el).position === 'fixed') return 0;
    if (el.closest(DIALOG_SEL)) return 1;
    return 2;
  };
  const ranked = candidates.map((el) => {
    const rect = el.getBoundingClientRect();
    return { el, rank: rankOf(el), top: rect.top };
  });
  ranked.sort((a, b) => a.rank - b.rank || (a.top <= vh ? 0 : 1) - (b.top <= vh ? 0 : 1));
  const ordered = ranked.map((c) => c.el);

  for (const el of ordered) {
    if (entries.length >= MAX_ELEMENTS) {
      // Don't just count the cut — NAME it, so the model knows what a
      // scroll might still reveal instead of declaring the page empty.
      const cut = ordered.slice(entries.length);
      const names = new Map<string, number>();
      for (const c of cut) {
        const n = (c.getAttribute('aria-label') || (typeof c.innerText === 'string' ? c.innerText : '') || '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40);
        if (!n) continue;
        names.set(n, (names.get(n) || 0) + 1);
        if (names.size >= 6) break;
      }
      const preview = [...names.entries()]
        .map(([n, k]) => (k > 1 ? `"${n}" ×${k}` : `"${n}"`))
        .join(', ')
        .slice(0, 200);
      lines.push(`… (${cut.length} more truncated — including: ${preview || 'unnamed controls'})`);
      break;
    }
    const owner = ownerOf(el);
    const entry = describeElement(el, entries.length + 1);
    // An Ionic toggle/checkbox carries no label text of its own — the name
    // lives in the owning row ("Dark Mode — easier on the eyes"). Without
    // borrowing the owner's name the control is dropped here and the model
    // spends its run scrolling after a toggle it can never see.
    if (!entry.name && owner) entry.name = owner;
    if (!entry.name && !entry.input && !entry.href) continue; // unnamed, unactionable
    entry.owner = owner ?? undefined;
    entries.push(entry);
    captured.add(el);

    // TREE: a new pointer-card owner opens a section; its controls nest
    // under it. Top-level items (no owner) sit flush — the outline reads
    // screen → section → control instead of a flat ref wall.
    if ((owner ?? null) !== lastOwner) {
      if (owner) {
        lines.push('');
        lines.push(`## ${owner}`);
      }
      lastOwner = owner ?? null;
    }
    lines.push(entryLine(entry));
  }

  // Pointer-affordance rows (cards, ion-items with tap handlers) get their
  // refs here — the ROW opens the thing while buttons inside it are the
  // per-item tools. Only the element that DECLARES pointer is captured.
  let pointerAdded = 0;
  for (const [el, name] of cardOwners) {
    if (entries.length >= MAX_ELEMENTS || pointerAdded >= 16) break;
    if (captured.has(el) || !isVisible(el)) continue;
    const entry = describeElement(el, entries.length + 1);
    entry.name = name;
    entries.push(entry);
    lines.push(entryLine(entry));
    pointerAdded += 1;
  }

  // Clip to the char budget, line-aligned, so the model never sees a half line.
  let text = lines.join('\n');
  if (text.length > MAX_SNAPSHOT_CHARS) {
    text = text.slice(0, MAX_SNAPSHOT_CHARS);
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline > MAX_SNAPSHOT_CHARS * 0.6) text = text.slice(0, lastNewline);
    text += '\n… (snapshot truncated)';
  }

  return { text, entries, byRef: new Map(entries.map((e) => [e.ref, e])) };
}
