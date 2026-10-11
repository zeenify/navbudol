import { Injectable, NgZone } from '@angular/core';
import { Capacitor, PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { Subject, Subscription } from 'rxjs';
import { CommunityPlaceSummary } from '../models';
import { haversineM } from '../geo.utils';
import { CommunityPlacesService } from './community-places.service';
import { LocationService } from './location.service';

interface PhotoWatcherPlugin {
  startWatch(options: { since: number }): Promise<void>;
  stopWatch(): Promise<void>;
  addListener(eventName: 'photoCaptured', listener: (data: CapturedPhoto) => void): Promise<PluginListenerHandle>;
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
 * When one lands, emit it — the map page pops the "post it?" card.
 *
 * Native-only (Android). The watch runs only while the app is open because
 * Android forbids background MediaStore listening.
 */
@Injectable({ providedIn: 'root' })
export class PhotoWatcherService {
  readonly photoCaptured$ = new Subject<{ place: CommunityPlaceSummary; photo: CapturedPhoto }>();

  private listener: PluginListenerHandle | null = null;
  private watching = false;
  private active = false;
  private posSub: Subscription | null = null;
  private nearbyPlace: CommunityPlaceSummary | null = null;

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
  }

  stop(): void {
    this.active = false;
    this.posSub?.unsubscribe();
    this.posSub = null;
    this.nearbyPlace = null;
    this.syncWatch();
  }

  private syncWatch(): void {
    if (this.nearbyPlace && !this.watching) {
      this.watching = true;
      PhotoWatcher.startWatch({ since: Math.floor(Date.now() / 1000) })
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

  private attachListener(): void {
    PhotoWatcher.addListener('photoCaptured', (photo) => {
      if (!this.nearbyPlace) return;
      const place = this.nearbyPlace;
      this.zone.run(() => this.photoCaptured$.next({ place, photo }));
    })
      .then((handle) => (this.listener = handle))
      .catch(() => undefined);
  }
}
