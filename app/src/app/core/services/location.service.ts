import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Geolocation } from '@capacitor/geolocation';
import { environment } from '../../../environments/environment';
import { GpsPosition, LatLng } from '../models';

/**
 * Single source of GPS truth. There is NO default position: `position$`
 * stays null until a real fix (or a simulated position) arrives, so the
 * app never shows a location the device doesn't actually have.
 *
 * When the simulation is running it injects fake positions into the same
 * stream — the rest of the app can't tell the difference.
 */
@Injectable({ providedIn: 'root' })
export class LocationService {
  readonly position$ = new BehaviorSubject<GpsPosition | null>(null);
  /** Set when permissions are denied or the GPS fails — UI can prompt. */
  readonly gpsError$ = new BehaviorSubject<string | null>(null);

  private watchId: string | null = null;

  constructor(private zone: NgZone) {}

  get position(): GpsPosition | null {
    return this.position$.value;
  }

  get hasFix(): boolean {
    return this.position$.value !== null;
  }

  /**
   * The town-center fallback for town-wide features (weather chip, search
   * bias) — never for navigation, which requires a real fix.
   */
  get positionOrTownCenter(): LatLng {
    return this.position$.value ?? environment.defaultCenter;
  }

  async startWatch(): Promise<void> {
    if (this.watchId !== null) return;
    try {
      const status = await Geolocation.checkPermissions();
      if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted' && req.coarseLocation !== 'granted') {
          this.gpsError$.next('Location permission denied');
          return;
        }
      }
    } catch {
      /* checkPermissions can throw on web — the watch will surface errors */
    }
    try {
      this.watchId = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 },
        (pos, err) =>
          this.zone.run(() => this.onWatch(pos as unknown as WatchPos | null, err))
      );
    } catch (e) {
      console.warn('LocationService watch failed', e);
      this.gpsError$.next(e instanceof Error ? e.message : 'Location unavailable');
      this.watchId = null;
    }
  }

  stopWatch(): void {
    if (this.watchId !== null) {
      Geolocation.clearWatch({ id: this.watchId }).catch(() => undefined);
      this.watchId = null;
    }
  }

  async requestPermissions(): Promise<boolean> {
    const status = await Geolocation.requestPermissions();
    return status.location === 'granted' || status.coarseLocation === 'granted';
  }

  /** Simulation override — pushes into the same stream as real GPS. */
  injectPosition(pos: LatLng, jittered = true): void {
    this.gpsError$.next(null);
    this.position$.next({
      ...pos,
      accuracy: 5,
      heading: null,
      simulated: true,
      timestamp: Date.now(),
    });
  }

  private onWatch(pos: WatchPos | null, err: unknown): void {
    if (err || !pos) return;
    // Ignore real GPS while the simulation is driving the dot.
    if (this.position$.value?.simulated) return;
    this.gpsError$.next(null);
    this.position$.next({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? undefined,
      heading: pos.coords.heading ?? null,
      simulated: false,
      timestamp: pos.timestamp ?? Date.now(),
    });
  }
}

/** Minimal structural shape of a fix — decouples us from the plugin's
 *  quirky internal Position typings. */
interface WatchPos {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    heading?: number | null;
  };
  timestamp?: number;
}
