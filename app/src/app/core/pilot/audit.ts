/**
 * NavBudol Pilot — local action audit.
 *
 * Every run's executed commands append {explain, commands (user words),
 * route, ts} to a local log (last 50), surfaced as "Pilot history" in
 * Settings. Local-only by design — case-study scope, nothing leaves the
 * device.
 */

export interface PilotAuditEntry {
  ts: number;
  explain: string;
  commands: string[];
  route: string;
}

const KEY = 'navbudol.pilot.audit';
const LIMIT = 50;

export function auditAppend(entry: PilotAuditEntry): void {
  try {
    const log = auditList();
    log.push(entry);
    localStorage.setItem(KEY, JSON.stringify(log.slice(-LIMIT)));
  } catch {
    /* storage full — audit is best-effort */
  }
}

export function auditList(): PilotAuditEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PilotAuditEntry[]) : [];
  } catch {
    return [];
  }
}

export function auditClear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
