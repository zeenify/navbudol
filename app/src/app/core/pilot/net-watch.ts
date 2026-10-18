/**
 * NavBudol Pilot — in-flight network counter.
 *
 * Counts pending fetch/XHR so the executor's settle can tell a
 * quiet-but-loading page from a genuinely idle one. Installed once, at
 * pilot load — it wraps window.fetch and XHR globally.
 */

let pending = 0;

export const netPending = (): number => pending;

let installed = false;

export function installNetWatch(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const origFetch = window.fetch?.bind(window);
  if (origFetch) {
    window.fetch = (...args: Parameters<typeof fetch>): Promise<Response> => {
      pending += 1;
      return origFetch(...args).finally(() => {
        pending = Math.max(0, pending - 1);
      });
    };
  }

  const OrigOpen = XMLHttpRequest.prototype.open;
  const OrigSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...args: unknown[]) {
    (this as XMLHttpRequest & { __nbTracked?: boolean }).__nbTracked = true;
    return (OrigOpen as any).apply(this, args);
  };
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: unknown[]) {
    if ((this as XMLHttpRequest & { __nbTracked?: boolean }).__nbTracked) {
      pending += 1;
      this.addEventListener('loadend', () => {
        pending = Math.max(0, pending - 1);
      });
    }
    return (OrigSend as any).apply(this, args);
  };
}
