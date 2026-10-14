import { Injectable, NgZone } from '@angular/core';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Subject, Subscription } from 'rxjs';
import { CommunityPlaceSummary } from '../models';
import { haversineM } from '../geo.utils';
import { CommunityPlacesService } from './community-places.service';
import { LocationService } from './location.service';

interface PhotoWatcherPlugin {
  startWatch(options: { since: number }): Promise<void>;
  stopWatch(): Promise<void>;
  checkNow(options: { since: number }): Promise<{ photos: CapturedPhoto[] }>;
  requestNotificationPermission(): Promise<void>;
  addListener(
    eventName: 'photoCaptured',
    listener: (photo: CapturedPhoto) => void
  ): Promise<PluginListenerHandle>;
}

export interface CapturedPhoto {
  base64: string;
  mimeType: string;
  capturedAt: number;
}

const PhotoWatcher = registerPlugin<PhotoWatcherPlugin>('PhotoWatcher');

const ON_SITE_RADIUS_M = 75;

/**
 * The one-tap contribution hook: while the user is on-site at a community
 * place (within 75 m), watch the system MediaStore for NEW camera photos.
 *
 * The user takes the photo in their own camera app, so detection works in
 * two layers:
 *  - a real system notification posted by the native layer whenever the app
 *    is not focused (visible over the camera app; tapping opens the app);
 *  - the 'photoCaptured' event + a resume-time checkNow() sweep that shows
 *    the in-app "post it?" card for anything caught in the background.
 *
 * The watch runs only while the app is open (Android forbids background
 * MediaStore listening) and only while the user is on-site.
 */
@Injectable({ providedIn: 'root' })
export class PhotoWatcherService {
  readonly photoCaptured$ = new Subject<{ place: CommunityPlaceSummary; photo: CapturedPhoto }>();

  private listener: PluginListenerHandle | null = null;
  private resumeListener: PluginListenerHandle | null = null;
  private watching = false;
  private active = false;
  private posSub: Subscription | null = null;
  private nearbyPlace: CommunityPlaceSummary | null = null;
  private lastSeen = 0;
  private handled = new Set<number>();

  constructor(
    private community: CommunityPlacesService,
    private location: LocationService,
    private zone: NgZone
  ) {}

  /** Begin the on-site watch loop (no-op outside Android). */
  start(): void {
    if (!Capacitor.isNativePlatform() || this.active) return;
    this.active = true;
    this.posSub = this.location.position$.subscribe((pos) => {
      this.nearbyPlace = pos
        ? this.community.localPool().find((p) => haversineM(pos, p) <= ON_SITE_RADIUS_M) ?? null
        : null;
      this.syncWatch();
    });
    // Photos taken while the app was backgrounded are swept on return.
    CapApp.addListener('appStateChange', (state) => {
      if (state.isActive) void this.checkMissed();
    })
      .then((handle) => (this.resumeListener = handle))
      .catch(() => undefined);
    void PhotoWatcher.requestNotificationPermission().catch(() => undefined);
  }

  stop(): void {
    this.active = false;
    this.posSub?.unsubscribe();
    this.posSub = null;
    this.nearbyPlace = null;
    this.syncWatch();
    this.resumeListener?.remove().then(() => (this.resumeListener = null));
  }

  private syncWatch(): void {
    if (this.nearbyPlace && !this.watching) {
      this.watching = true;
      // Start from NOW — only photos taken after the user is on-site count.
      this.lastSeen = Math.floor(Date.now() / 1000);
      PhotoWatcher.startWatch({ since: this.lastSeen })
        .then(() => this.attachListener())
        .catch(() => {
          this.watching = false;
        });
    } else if (!this.nearbyPlace && this.watching) {
      this.watching = false;
      void PhotoWatcher.stopWatch().catch(() => undefined);
      this.listener?.remove().then(() => (this.listener = null));
      this.listener = null;
    }
  }

  /** Catch photos captured while the app was backgrounded (camera app open). */
  private async checkMissed(): Promise<void> {
    if (!this.nearbyPlace || !this.watching) return;
    try {
      const res = await PhotoWatcher.checkNow({ since: this.lastSeen });
      for (const photo of res.photos ?? []) {
        this.deliver(photo);
      }
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
    // Native notifications + resume sweeps can double-deliver; dedupe.
    if (this.handled.has(photo.capturedAt)) return;
    this.handled.add(photo.capturedAt);
    if (this.handled.size > 50) {
      this.handled = new Set(Array.from(this.handled).slice(-25));
    }
    if (photo.capturedAt > this.lastSeen) this.lastSeen = photo.capturedAt;
    if (!this.nearbyPlace) return;
    const place = this.nearbyPlace;
    this.zone.run(() => this.photoCaptured$.next({ place, photo }));
  }
}
