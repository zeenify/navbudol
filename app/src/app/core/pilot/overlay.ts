/**
 * NavBudol Pilot — takeover overlay.
 *
 * The "alive" layer: a virtual cursor that glides across the real page, a
 * highlight around the element about to be acted on, a click pulse, the
 * app-wide drive bar ("Pilot is driving — tap to stop"), and — once the
 * wheel is taken — a page blocker: the screen is the pilot's, the ONLY
 * thing still tappable is the drive bar's Stop button. Pure DOM + rAF;
 * styles are injected once because imperative DOM outside Angular gets no
 * component styles.
 */

let root: HTMLDivElement | null = null;
let cursorEl: HTMLDivElement | null = null;
let cursorLabelEl: HTMLSpanElement | null = null;
let highlightEl: HTMLDivElement | null = null;
let pulseEl: HTMLDivElement | null = null;
let blockerEl: HTMLDivElement | null = null;
let barEl: HTMLDivElement | null = null;
let barLabelEl: HTMLSpanElement | null = null;
let barStepEl: HTMLSpanElement | null = null;

let cursorPos = { x: -100, y: -100 };
let rafId: number | undefined;
let highlightSync: number | undefined;
let labelTimer: number | undefined;
let stopHandler: (() => void) | null = null;
let waitingActions: { approve: () => void; decline: () => void } | null = null;

const STYLE = `
#nbpilot-overlay-root { position: fixed; inset: 0; z-index: 99998; pointer-events: none; font-family: inherit; }
.nbpl-blocker { position: fixed; inset: 0; z-index: 1; pointer-events: auto; touch-action: none;
  display: none; cursor: not-allowed;
  background: radial-gradient(130% 100% at 50% 110%, rgba(124,92,255,.07), rgba(10,8,30,.14)); }
.nbpl-blocker.is-on { display: block; }
.nbpl-cursor { position: fixed; top: 0; left: 0; z-index: 3; color: #7c5cff; opacity: 0;
  transition: opacity .18s ease; will-change: transform; display: flex; align-items: flex-start; gap: 6px; }
.nbpl-cursor.is-shown { opacity: 1; }
.nbpl-cursor.is-flipped { flex-direction: row-reverse; }
.nbpl-cursor.is-flipped .nbpl-cursor__label { margin-top: 22px; margin-right: 26px; }
.nbpl-cursor__arrow { filter: drop-shadow(0 2px 8px rgba(0,0,0,.45)); position: relative; }
.nbpl-cursor__label { background: linear-gradient(135deg,#7c5cff,#4ca1ff); color: #fff; font-size: 11.5px;
  font-weight: 600; line-height: 1; padding: 6px 9px; border-radius: 999px; margin-top: 22px; max-width: 260px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 4px 14px rgba(40,30,120,.35);
  opacity: 0; transition: opacity .15s ease; }
.nbpl-cursor--labelled .nbpl-cursor__label { opacity: 1; }
.nbpl-cursor--danger { color: #ff4b26; }
.nbpl-cursor--acting { color: #ffd23e; }
.nbpl-highlight { position: fixed; z-index: 2; border-radius: 12px; opacity: 0; display: none;
  border: 2.5px solid #7c5cff; box-shadow: 0 0 0 3px rgba(124,92,255,.25), 0 0 22px rgba(124,92,255,.5);
  animation: nbpl-hl-in .18s ease; }
.nbpl-highlight.is-visible { display: block; opacity: 1; }
.nbpl-highlight.is-danger { border-color: #ff4b26; box-shadow: 0 0 0 3px rgba(255,75,38,.22), 0 0 22px rgba(255,75,38,.5); }
@keyframes nbpl-hl-in { from { transform: scale(1.06); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.nbpl-pulse { position: fixed; top: 0; left: 0; width: 64px; height: 64px; border-radius: 50%;
  background: radial-gradient(circle, rgba(124,92,255,.55) 0%, rgba(124,92,255,0) 70%); opacity: 0; z-index: 1; }
.nbpl-pulse.is-firing { animation: nbpl-pulse .5s ease-out; }
@keyframes nbpl-pulse { 0% { transform: scale(.4); opacity: .9; } 100% { transform: scale(1.7); opacity: 0; } }
.nbpl-bar { position: fixed; left: 50%; bottom: calc(64px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  z-index: 4; display: flex; align-items: center; gap: 8px; pointer-events: none;
  width: max-content; max-width: min(92vw, 430px);
  background: linear-gradient(135deg, rgba(30,26,52,.96), rgba(22,20,44,.96)); color: #fff;
  border: 1px solid rgba(124,92,255,.55); border-radius: 999px; padding: 7px 7px 7px 12px;
  box-shadow: 0 8px 26px rgba(10,8,30,.45); backdrop-filter: blur(10px);
  animation: nbpl-bar-in .22s ease; }
.nbpl-bar.is-leaving { animation: nbpl-bar-out .2s ease forwards; }
@keyframes nbpl-bar-in { from { transform: translateX(-50%) translateY(18px); opacity: 0; } }
@keyframes nbpl-bar-out { to { transform: translateX(-50%) translateY(18px); opacity: 0; } }
.nbpl-bar__avatar { width: 24px; height: 24px; border-radius: 50%; object-fit: cover;
  border: 1.5px solid rgba(255,255,255,.5); flex: 0 0 auto; }
.nbpl-bar__dot { width: 8px; height: 8px; border-radius: 50%; background: #ffd23e; flex: 0 0 auto;
  animation: nbpl-blink 1s ease infinite; }
.nbpl-bar.is-waiting .nbpl-bar__dot { background: #4ca1ff; }
@keyframes nbpl-blink { 50% { opacity: .3; } }
.nbpl-bar__text { display: flex; flex-direction: column; gap: 1px; flex: 0 1 auto; min-width: 0;
  padding-right: 2px; }
.nbpl-bar__label { font-size: 12.5px; font-weight: 700; letter-spacing: .01em; line-height: 1.25;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nbpl-bar__step { font-size: 11.5px; opacity: .85; line-height: 1.25;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nbpl-bar__stop { pointer-events: auto; flex: 0 0 auto; display: flex; align-items: center; gap: 5px;
  background: #ff4b26; color: #fff; border: none; border-radius: 999px; padding: 7px 12px;
  font-size: 12px; font-weight: 700; cursor: pointer; }
.nbpl-bar__stop:active { transform: scale(.96); }
.nbpl-bar__ok { pointer-events: auto; flex: 0 0 auto; background: linear-gradient(135deg,#7c5cff,#4ca1ff); color: #fff;
  border: none; border-radius: 999px; padding: 7px 11px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.nbpl-bar__no { pointer-events: auto; flex: 0 0 auto; background: rgba(255,255,255,.12); color: #fff;
  border: 1px solid rgba(255,255,255,.3); border-radius: 999px; padding: 7px 10px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }`;

function ensureRoot(): HTMLDivElement {
  if (root && document.body.contains(root)) return root;
  root = document.createElement('div');
  root.id = 'nbpilot-overlay-root';
  root.setAttribute('data-nbpilot-ignore', '');
  root.setAttribute('aria-hidden', 'true');

  if (!document.getElementById('nbpilot-overlay-style')) {
    const style = document.createElement('style');
    style.id = 'nbpilot-overlay-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  cursorEl = document.createElement('div');
  cursorEl.className = 'nbpl-cursor';
  cursorEl.innerHTML = `
      <span class="nbpl-cursor__arrow">
        <svg width="34" height="34" viewBox="0 0 40 40" fill="none">
          <path d="M8 4 L32 20 L20.5 22.5 L26 33.5 L21.5 35.5 L16 24.5 L8 31 Z"
              fill="currentColor" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="nbpl-cursor__label"></span>`;
  cursorLabelEl = cursorEl.querySelector('.nbpl-cursor__label');

  highlightEl = document.createElement('div');
  highlightEl.className = 'nbpl-highlight';

  pulseEl = document.createElement('div');
  pulseEl.className = 'nbpl-pulse';

  blockerEl = document.createElement('div');
  blockerEl.className = 'nbpl-blocker';
  // While the pilot drives, taps on the page are swallowed here — the ONLY
  // control that stays live is the drive bar's Stop (z-index above this).
  blockerEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  blockerEl.addEventListener('click', (e) => e.stopPropagation());

  root.append(blockerEl, highlightEl, cursorEl, pulseEl);
  document.body.appendChild(root);
  return root;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

function animateCursorTo(x: number, y: number, durationMs?: number): Promise<void> {
  return new Promise((resolve) => {
    const from = { ...cursorPos };
    const dist = Math.hypot(x - from.x, y - from.y);
    const dur = durationMs ?? Math.min(1050, Math.max(420, dist * 2.2));
    const start = performance.now();

    if (rafId) cancelAnimationFrame(rafId);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = undefined;
      resolve();
    };
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = easeOutCubic(t);
      cursorPos = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
      if (cursorEl) cursorEl.style.transform = `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0)`;
      if (t < 1) rafId = requestAnimationFrame(step);
      else finish();
    };
    rafId = requestAnimationFrame(step);
    // rAF is throttled to zero in hidden/backgrounded tabs — without this
    // wall-clock fallback a hidden pane wedges the whole driving batch.
    setTimeout(finish, dur + 400);
  });
}

export function showCursor(mode: 'default' | 'danger' | 'acting' = 'default'): void {
  ensureRoot();
  if (!cursorEl) return;
  cursorEl.classList.remove('nbpl-cursor--danger', 'nbpl-cursor--acting');
  if (mode === 'danger') cursorEl.classList.add('nbpl-cursor--danger');
  if (mode === 'acting') cursorEl.classList.add('nbpl-cursor--acting');
  if (!cursorEl.classList.contains('is-shown')) cursorEl.classList.add('is-shown');
}

export async function moveCursorTo(x: number, y: number, opts: { label?: string; mode?: 'default' | 'danger' | 'acting' } = {}): Promise<void> {
  showCursor(opts.mode);
  if (cursorEl) {
    // Keep the cursor (and its label bubble) inside the viewport — a target
    // near the right edge made the label spill off-screen.
    const clampedX = Math.min(Math.max(x, 6), window.innerWidth - 6);
    const clampedY = Math.min(Math.max(y, 6), window.innerHeight - 6);
    cursorEl.classList.toggle('is-flipped', !!opts.label && clampedX > window.innerWidth - 170);
    if (opts.label && cursorLabelEl) {
      cursorLabelEl.textContent = opts.label;
      cursorEl.classList.add('nbpl-cursor--labelled');
      clearTimeout(labelTimer);
      labelTimer = window.setTimeout(() => cursorEl?.classList.remove('nbpl-cursor--labelled'), 2600);
      await animateCursorTo(clampedX, clampedY, 720);
      return;
    }
    await animateCursorTo(clampedX, clampedY);
    return;
  }
  await animateCursorTo(x, y);
}

export function hideCursor(): void {
  if (!cursorEl) return;
  cursorEl.classList.remove('is-shown', 'nbpl-cursor--labelled');
  cursorPos = { x: -100, y: -100 };
  cursorEl.style.transform = 'translate3d(-100px, -100px, 0)';
}

export function showHighlight(target: HTMLElement, danger = false): void {
  ensureRoot();
  if (!highlightEl) return;
  const pad = 3;
  const position = () => {
    if (!document.body.contains(target)) return hideHighlight();
    const rect = target.getBoundingClientRect();
    if (!highlightEl) return;
    highlightEl.style.top = `${rect.top - pad}px`;
    highlightEl.style.left = `${rect.left - pad}px`;
    highlightEl.style.width = `${rect.width + pad * 2}px`;
    highlightEl.style.height = `${rect.height + pad * 2}px`;
  };
  position();
  highlightEl.classList.toggle('is-danger', danger);
  highlightEl.classList.add('is-visible');
  // Keep it glued to the element while visible (scroll, layout shifts).
  clearInterval(highlightSync);
  highlightSync = setInterval(position, 120);
}

export function hideHighlight(): void {
  if (!highlightEl) return;
  clearInterval(highlightSync);
  highlightSync = undefined;
  highlightEl.classList.remove('is-visible');
}

export function pulseAt(x: number, y: number): void {
  ensureRoot();
  if (!pulseEl || !cursorEl) return;
  pulseEl.style.transform = `translate3d(${x - 32}px, ${y - 32}px, 0)`;
  pulseEl.classList.remove('is-firing');
  void pulseEl.offsetWidth; // restart the animation
  pulseEl.classList.add('is-firing');
  cursorEl.classList.add('nbpl-cursor--acting');
  setTimeout(() => cursorEl?.classList.remove('nbpl-cursor--acting'), 380);
}

export function centerOf(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

// --- drive bar -------------------------------------------------------------

export interface DriveBarState {
  visible: boolean;
  waiting?: boolean;
  label?: string;
  step?: string;
  avatar?: string;
}

export function setStopHandler(handler: () => void): void {
  stopHandler = handler;
}

/**
 * While the consent gate waits, the bar itself carries Approve / No thanks —
 * the gate card lives in the (possibly frozen) chat sheet, so the bar is the
 * always-answerable surface, on every route.
 */
export function setWaitingActions(actions: { approve: () => void; decline: () => void } | null): void {
  waitingActions = actions;
}

/**
 * Page lock while the pilot holds the wheel: every tap lands on the blocker
 * (nothing on the page is touchable); the drive bar's Stop button sits above
 * it and stays the one live control. Cleared when the run ends — the page is
 * the user's again.
 */
export function setPageLock(on: boolean): void {
  if (on) {
    ensureRoot();
    blockerEl?.classList.add('is-on');
  } else {
    blockerEl?.classList.remove('is-on');
  }
}

export function updateDriveBar(state: DriveBarState): void {
  if (!state.visible) {
    if (barEl) {
      barEl.classList.add('is-leaving');
      const el = barEl;
      setTimeout(() => el.remove(), 220);
      barEl = null;
      barLabelEl = barStepEl = null;
    }
    return;
  }
  ensureRoot();
  if (!barEl) {
    barEl = document.createElement('div');
    barEl.className = 'nbpl-bar';
    barEl.setAttribute('data-nbpilot-ignore', '');
    barEl.setAttribute('role', 'status');
    barEl.innerHTML = `
        ${state.avatar ? `<img class="nbpl-bar__avatar" src="${state.avatar}" alt=""/>` : ''}
        <span class="nbpl-bar__dot"></span>
        <span class="nbpl-bar__text">
          <span class="nbpl-bar__label"></span>
          <span class="nbpl-bar__step"></span>
        </span>
        <button class="nbpl-bar__ok" hidden aria-label="Approve">OK</button>
        <button class="nbpl-bar__no" hidden aria-label="Decline">No</button>
        <button class="nbpl-bar__stop" aria-label="Stop the pilot">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
          Stop
        </button>`;
    barLabelEl = barEl.querySelector('.nbpl-bar__label');
    barStepEl = barEl.querySelector('.nbpl-bar__step');
    barEl.querySelector('.nbpl-bar__stop')?.addEventListener('click', () => stopHandler?.());
    barEl.querySelector('.nbpl-bar__ok')?.addEventListener('click', () => waitingActions?.approve());
    barEl.querySelector('.nbpl-bar__no')?.addEventListener('click', () => waitingActions?.decline());
    root?.appendChild(barEl);
    void root;
  }
  barEl.classList.toggle('is-waiting', !!state.waiting);
  const okBtn = barEl.querySelector<HTMLButtonElement>('.nbpl-bar__ok');
  const noBtn = barEl.querySelector<HTMLButtonElement>('.nbpl-bar__no');
  if (okBtn) okBtn.hidden = !state.waiting || !waitingActions;
  if (noBtn) noBtn.hidden = !state.waiting || !waitingActions;
  if (barLabelEl) barLabelEl.textContent = state.label ?? 'Pilot is driving';
  if (barStepEl) barStepEl.textContent = state.step ?? '';
  if (state.avatar) {
    const img = barEl!.querySelector<HTMLImageElement>('.nbpl-bar__avatar');
    if (img && img.dataset['src'] !== state.avatar) {
      img.src = state.avatar;
      img.dataset['src'] = state.avatar;
    } else if (!img) {
      const created = document.createElement('img');
      created.className = 'nbpl-bar__avatar';
      created.alt = '';
      created.src = state.avatar;
      created.dataset['src'] = state.avatar;
      barEl!.prepend(created);
    }
  }
}

export function destroyOverlay(): void {
  clearInterval(highlightSync);
  if (rafId) cancelAnimationFrame(rafId);
  document.getElementById('nbpilot-overlay-style')?.remove();
  root?.remove();
  root = cursorEl = highlightEl = pulseEl = blockerEl = barEl = null;
  barLabelEl = barStepEl = cursorLabelEl = null;
  cursorPos = { x: -100, y: -100 };
}
