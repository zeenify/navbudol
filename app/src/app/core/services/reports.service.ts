import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { CommunityReport, LatLng } from '../models';
import { distanceToPolylineM, haversineM } from '../geo.utils';
import { BackendApiService } from './backend-api.service';
import { LocationService } from './location.service';

/** Composer presets. The vocabulary stays open server-side — these are the
 *  common kinds with their shelf lives, mirrored from KIND_SHELF_LIFE_H. */
export const REPORT_KINDS = [
  { id: 'flood', label: 'Flood', emoji: '🌊', shelfLife: '6 hours' },
  { id: 'checkpoint', label: 'Checkpoint', emoji: '🛑', shelfLife: '4 hours' },
  { id: 'hazard', label: 'Hazard', emoji: '⚠️', shelfLife: '12 hours' },
  { id: 'fare', label: 'Fare / price', emoji: '💰', shelfLife: '6 months' },
  { id: 'access', label: 'Access', emoji: '🚪', shelfLife: '1 month' },
  { id: 'info', label: 'Something else', emoji: '✏️', shelfLife: '1 week' },
] as const;

/** Mirrors backend PRESENCE_RADIUS_M — a confirm within this counts as on-site. */
export const PRESENCE_RADIUS_M = 250;

const AUTHOR_KEY = 'navbudol.authorId';
const REFRESH_MS = 30000;

export function reportAgeLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'just now';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min old`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr old`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} old`;
}

/**
 * Community reports: the perishable knowledge layer (floods, checkpoints,
 * fares) that no global map holds. Trust is presence, not popularity — every
 * confirm is stamped with how far the confirmer was from the pin, and only
 * on-site confirmations are ever allowed to change a route.
 */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  readonly reports$ = new BehaviorSubject<CommunityReport[]>([]);

  // Field-injected so existing constructor-injection files can adopt this
  // service without adding new prefer-inject lint errors.
  private api = inject(BackendApiService);
  private location = inject(LocationService);
  private loadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor() {
    void this.ensureReports();
  }

  /** Pseudonymous, stable per device — there are no accounts in this app. */
  get authorId(): string {
    try {
      const existing = localStorage.getItem(AUTHOR_KEY);
      if (existing) return existing;
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(AUTHOR_KEY, id);
      return id;
    } catch {
      return 'anon';
    }
  }

  ensureReports(force = false): Promise<void> {
    if (!force && this.loadedAt && Date.now() - this.loadedAt < REFRESH_MS) {
      return Promise.resolve();
    }
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const reports = await this.api.get<CommunityReport[]>('/api/reports', 8000);
        this.reports$.next(reports);
        this.loadedAt = Date.now();
      } catch {
        if (!this.loadedAt) this.reports$.next([]);
      }
    })().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  async addReport(kind: string, text: string, position: LatLng): Promise<CommunityReport> {
    const report = await this.api.post<CommunityReport>('/api/reports', {
      kind,
      text,
      lat: position.lat,
      lng: position.lng,
      author: this.authorId,
    });
    this.reports$.next([report, ...this.reports$.value.filter((r) => r.id !== report.id)]);
    this.loadedAt = Date.now();
    return report;
  }

  /** Confirm "still true", stamped with how far the user is from the pin. */
  async confirmReport(id: string): Promise<CommunityReport> {
    const pos = this.location.position;
    const report = await this.api.post<CommunityReport>(`/api/reports/${id}/confirm`, {
      author: this.authorId,
      lat: pos?.lat,
      lng: pos?.lng,
    });
    this.reports$.next([report, ...this.reports$.value.filter((r) => r.id !== report.id)]);
    return report;
  }

  async disputeReport(id: string): Promise<CommunityReport> {
    const report = await this.api.post<CommunityReport>(`/api/reports/${id}/dispute`, {
      author: this.authorId,
    });
    this.reports$.next([report, ...this.reports$.value.filter((r) => r.id !== report.id)]);
    return report;
  }

  async retireReport(id: string): Promise<void> {
    await this.api.post(`/api/reports/${id}/retire`, {});
    this.reports$.next(this.reports$.value.filter((r) => r.id !== id));
  }

  /** True when this device's own confirm landed on site. */
  wasOnSite(report: CommunityReport): boolean {
    const mine = report.confirms.find((c) => c.by === this.authorId);
    return mine?.nearM != null && mine.nearM <= PRESENCE_RADIUS_M;
  }

  // --- retrieval (the AI and the UI both read through here) -----------------

  /** Unexpired reports within radiusM of the user (or the town center). */
  reportsNear(pos: LatLng | null, radiusM: number): Array<CommunityReport & { distanceM: number }> {
    const center = pos ?? this.location.positionOrTownCenter;
    return this.reports$.value
      .map((r) => ({ ...r, distanceM: haversineM(center, r) }))
      .filter((r) => r.distanceM <= radiusM)
      .sort((a, b) => a.distanceM - b.distanceM);
  }

  /** Reports close to the route line — "on the way". */
  reportsAlongRoute(geometry: LatLng[], corridorM = 300): Array<CommunityReport & { distanceM: number }> {
    if (geometry.length < 2) return [];
    return this.reports$.value
      .map((r) => ({ ...r, distanceM: distanceToPolylineM(r, geometry) }))
      .filter((r) => r.distanceM <= corridorM)
      .sort((a, b) => a.distanceM - b.distanceM);
  }

  /**
   * Pins to route around: only presence-confirmed reports (plan rule — one
   * unverified note must never change someone's route), clipped to the
   * origin→destination corridor so a far-off report can't distort the path.
   */
  avoidPoints(from: LatLng, to: LatLng, padM = 2000): LatLng[] {
    const latPad = padM / 111320;
    const cosLat = Math.cos((from.lat * Math.PI) / 180);
    const lngPad = padM / (111320 * (cosLat || 1));
    const minLat = Math.min(from.lat, to.lat) - latPad;
    const maxLat = Math.max(from.lat, to.lat) + latPad;
    const minLng = Math.min(from.lng, to.lng) - lngPad;
    const maxLng = Math.max(from.lng, to.lng) + lngPad;
    return this.reports$.value
      .filter((r) => (r.presenceCount ?? 0) >= 1)
      .filter((r) => r.lat >= minLat && r.lat <= maxLat && r.lng >= minLng && r.lng <= maxLng)
      .slice(0, 25)
      .map((r) => ({ lat: r.lat, lng: r.lng }));
  }

  /** "2 confirmed (1 on site) · 3 hr old" — the whole trust model in one line. */
  trustLabel(report: CommunityReport): string {
    const confirmed = report.confirmCount ?? report.confirms.length;
    const onSite = report.presenceCount ?? 0;
    const disputed = report.disputeCount ?? 0;
    const parts: string[] = [];
    if (confirmed > 0) {
      parts.push(`${confirmed} confirmed${onSite ? ` (${onSite} on site)` : ''}`);
    } else {
      parts.push('No confirmations yet');
    }
    if (disputed > 0) parts.push(`${disputed} disputed`);
    parts.push(reportAgeLabel(report.createdAt));
    return parts.join(' · ');
  }

  /** Map pin color per kind — kinds are open vocabulary, so match loosely. */
  kindColor(kind: string): string {
    const k = kind.toLowerCase();
    if (k.includes('flood')) return '#2f6df6';
    if (k.includes('checkpoint')) return '#e5484d';
    if (k.includes('hazard') || k.includes('dog') || k.includes('construction')) return '#f08c00';
    if (k.includes('fare') || k.includes('price')) return '#2f9e44';
    if (k.includes('access')) return '#8e4ec6';
    return '#868e96';
  }
}
