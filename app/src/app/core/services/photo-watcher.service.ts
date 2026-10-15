import { Injectable, NgZone } from '@angular/core';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { CommunityPlaceSummary } from '../models';
import { haversineM } from '../geo.utils';
import { CommunityPlacesService } from './community-places.service';
import { LocationService } from './location.service';

interface PhotoWatcherPlugin {
  startWatch(options: { since: number; placeName?: string }): Promise<void>;
  stopWatch(): Promise<void>;
  checkNow(options: { since: number; rescan?: boolean }): Promise<{ photos: CapturedPhoto[] }>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  addListener(
    eventName: 'photoCaptured',
    listener: (photo: CapturedPhoto) => void
  ): Promise<PluginListenerHandle>;
}

export interface CapturedPhoto {
  id?: string;
  base64: string;
  mimeType: string;
  capturedAt: number;
}

const PhotoWatcher = registerPlugin<PhotoWatcherPlugin>('PhotoWatcher');

/**
 * Live-proximity radius, adjusted by GPS accuracy: a fix with ±30 m noise
 * must not disarm the watch while the user stands inside the place, so the
 * measured distance gets the accuracy subtracted before comparing.
 */
const ON_SITE_RADIUS_M = 100;
/** Distance from the latched place that proves the user moved on. */
const LEAVE_RADIUS_M = 250;
/** How long a latch holds without fresh GPS proof (indoor drift cover). */
const PROXIMITY_LATCH_MIN = 45;
const ARRIVAL_LATCH_MIN = 60;
/** Photos older than this when the app starts are never resurfaced. */
const MAX_BACKLOG_S = 12 * 3600;
const LASTSEEN_KEY = 'navbudol.photoWatch.lastSeen';

/**
 * The one-tap contribution hook: while the user is ON-SITE at a community
 * place, watch the system MediaStore for NEW camera photos (their own camera
 * app, not ours) and surface the in-app "post it?" card + a system
 * notification when the app is backgrounded.
 *
 * Robustness rules learned from device testing:
 *  - On-site state is LATCHED: entering proximity (or navigating to the
 *    place) arms a 45–60 minute window. GPS drift indoors or a stale fix
 *    never silently disarms it mid-visit; only real distance (>250 m),
 *    window expiry, or the user leaving does.
 *  - Photos are delivered against the LATCHED place — a photo taken at the
 *    place is still matched even if the fix wandered by delivery time.
 *  - The watermark (last seen DATE_ADDED) persists in localStorage, so
 *    photos survive process kills and are swept on resume.
 *  - Native polling filters to real camera shots (DCIM) — screenshots and
 *    saved memes don't trigger "post this?".
 */
@Injectable({ providedIn: 'root' })
export class PhotoWatcherService {
  /** The latched on-site place (drives the map's arming chip + delivery). */
  readonly onSite$ = new BehaviorSubject<CommunityPlaceSummary | null>(null);
  readonly photoCaptured$ = new Subject<{ place: CommunityPlaceSummary; photo: CapturedPhoto }>();
  /** False after the user declined the Android 13+ notification prompt. */
  readonly notificationsGranted$ = new BehaviorSubject(true);

  private listener: PluginListenerHandle | null = null;
  private resumeListener: PluginListenerHandle | null = null;
  private posSub: Subscription | null = null;
  private active = false;
  private watching = false;
  private latched: CommunityPlaceSummary | null = null;
  private latchUntil = 0;
  private lastSeen = 0;
  private handled = new Set<string>();

  constructor(
    private community: CommunityPlacesService,
    private location: LocationService,
    private zone: NgZone
  ) {}

  /** Begin the on-site watch loop (no-op outside Android). */
  start(): void {
    if (!Capacitor.isNativePlatform() || this.active) return;
    this.active = true;
    this.lastSeen = this.restoreWatermark();
    this.posSub = this.location.position$.subscribe((pos) => {
      if (pos) this.evaluateOnSite(pos);
    });
    // Photos taken while the app was backgrounded are swept on return.
    CapApp.addListener('appStateChange', (state) => {
      if (state.isActive) void this.checkMissed();
    })
      .then((handle) => (this.resumeListener = handle))
      .catch(() => undefined);
    PhotoWatcher.requestNotificationPermission()
      .then((res) => this.notificationsGranted$.next(res?.granted !== false))
      .catch(() => undefined);
  }

  stop(): void {
    this.active = false;
    this.posSub?.unsubscribe();
    this.posSub = null;
    this.clearLatch();
    this.stopNativeWatch();
    this.resumeListener?.remove().then(() => (this.resumeListener = null));
  }

  /**
   * Navigation arrival — the strongest on-site proof there is. Arms the
   * watch for the destination place even if GPS immediately drifts.
   */
  latchArrival(placeId: string, placeName: string): void {
    if (!Capacitor.isNativePlatform() || !this.active) return;
    const known = this.community.cachedPlace(placeId);
    const place: CommunityPlaceSummary =
      known ?? {
        id: placeId,
        name: placeName,
        icon: 'location_on',
        customIconUrl: null,
        lat: 0,
        lng: 0,
        creator: null,
        rating: { average: null, count: 0, distribution: {} },
        photoCount: 0,
        commentCount: 0,
        likes: 0,
        dislikes: 0,
        createdAt: new Date().toISOString(),
      };
    this.setLatch(place, ARRIVAL_LATCH_MIN);
  }

  // --- latching ---------------------------------------------------------------

  private evaluateOnSite(pos: { lat: number; lng: number; accuracy?: number }): void {
    const accuracy = pos.accuracy ?? 0;
    let nearest: CommunityPlaceSummary | null = null;
    let nearestD = Infinity;
    for (const place of this.community.localPool()) {
      const d = haversineM(pos, place) - accuracy;
      if (d <= ON_SITE_RADIUS_M && d < nearestD) {
        nearest = place;
        nearestD = d;
      }
    }
    if (nearest) {
      this.setLatch(nearest, PROXIMITY_LATCH_MIN);
      return;
    }
    // No live proximity — hold the latch unless we truly moved on.
    if (this.latched) {
      const movedOn =
        Date.now() > this.latchUntil ||
        (this.latched.lat !== 0 && haversineM(pos, this.latched) > LEAVE_RADIUS_M);
      if (movedOn) this.clearLatch();
    }
  }

  private setLatch(place: CommunityPlaceSummary, minutes: number): void {
    const changed = this.latched?.id !== place.id;
    this.latched = place;
    this.latchUntil = Math.max(this.latchUntil, Date.now() + minutes * 60_000);
    if (changed || !this.watching) {
      this.onSite$.next(place);
      this.startNativeWatch();
    }
  }

  private clearLatch(): void {
    const had = this.latched !== null;
    this.latched = null;
    this.latchUntil = 0;
    if (had) {
      this.onSite$.next(null);
      this.stopNativeWatch();
    }
  }

  // --- native watch -------------------------------------------------------------

  private startNativeWatch(): void {
    const place = this.latched;
    if (!place || this.watching) return;
    this.watching = true;
    PhotoWatcher.startWatch({ since: this.lastSeen, placeName: place.name })
      .then(() => this.attachListener())
      .catch(() => {
        this.watching = false;
      });
  }

  private stopNativeWatch(): void {
    if (!this.watching) return;
    this.watching = false;
    void PhotoWatcher.stopWatch().catch(() => undefined);
    this.listener?.remove().then(() => (this.listener = null));
    this.listener = null;
  }

  /** Catch photos captured while the app was backgrounded (camera app open).
   * rescan=true re-offers photos the background poll may have handed to a
   * frozen WebView — deliver() dedupes by id, so nothing double-fires. */
  private async checkMissed(): Promise<void> {
    if (!this.active || !this.latched) return;
    try {
      const res = await PhotoWatcher.checkNow({ since: this.lastSeen, rescan: true });
      for (const photo of res.photos ?? []) this.deliver(photo);
    } catch {
      /* the native poll will resurface them */
    }
  }

  private attachListener(): void {
    PhotoWatcher.addListener('photoCaptured', (photo) => this.deliver(photo))
      .then((handle) => (this.listener = handle))
      .catch(() => undefined);
  }

  private deliver(photo: CapturedPhoto): void {
    const key = photo.id ?? `t${photo.capturedAt}`;
    if (this.handled.has(key)) return;
    this.handled.add(key);
    if (this.handled.size > 100) {
      this.handled = new Set(Array.from(this.handled).slice(-50));
    }
    if (photo.capturedAt > this.lastSeen) {
      this.lastSeen = photo.capturedAt;
      this.persistWatermark();
    }
    // Deliver against the latched place, not the live fix — the photo was
    // taken where the user WAS; GPS may have drifted since.
    const place = this.latched;
    if (!place) return;
    this.zone.run(() => this.photoCaptured$.next({ place, photo }));
  }

  // --- watermark persistence ------------------------------------------------------

  private restoreWatermark(): number {
    try {
      const raw = localStorage.getItem(LASTSEEN_KEY);
      if (raw) {
        const value = Number(raw);
        if (Number.isFinite(value) && value > 0) {
          // An ancient watermark must not resurface last month's selfies.
          return Date.now() / 1000 - value > MAX_BACKLOG_S ? this.nowSeconds() : value;
        }
      }
    } catch {
      /* private mode — memory-only */
    }
    return this.nowSeconds();
  }

  private persistWatermark(): void {
    try {
      localStorage.setItem(LASTSEEN_KEY, String(this.lastSeen));
    } catch {
      /* ignore */
    }
  }

  private nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }
}
