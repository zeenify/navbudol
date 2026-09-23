import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LatLng, RouteProfile, RouteResult } from '../models';
import { haversineM, interpolate } from '../geo.utils';
import { LocationService } from './location.service';

/**
 * Simulate Travel for indoor demos (plan §7.10): moves the position along
 * the route geometry and injects into LocationService so the whole app
 * believes the user is really moving. Speed matches the travel mode —
 * walking pace on foot, car pace when driving — times the demo multiplier.
 */
@Injectable({ providedIn: 'root' })
export class SimulationService {
  readonly isSimulating$ = new BehaviorSubject(false);

  private timer: ReturnType<typeof setInterval> | null = null;
  private segmentDistances: number[] = [];
  private totalDistance = 0;
  private traveled = 0;
  private geometry: LatLng[] = [];

  constructor(
    private location: LocationService,
    private zone: NgZone
  ) {}

  start(route: RouteResult, speedMultiplier: number, profile: RouteProfile): void {
    this.stop();
    this.geometry = route.geometry;
    this.segmentDistances = [];
    this.totalDistance = 0;
    for (let i = 0; i < this.geometry.length - 1; i++) {
      const d = haversineM(this.geometry[i], this.geometry[i + 1]);
      this.segmentDistances.push(d);
      this.totalDistance += d;
    }
    if (this.totalDistance === 0) return;
    this.traveled = 0;
    this.isSimulating$.next(true);

    const baseMs = profile === 'foot-walking' ? environment.simSpeedWalkingMs : environment.simSpeedDrivingMs;
    this.timer = setInterval(
      () => this.zone.run(() => this.tick(baseMs * speedMultiplier)),
      environment.simTickMs
    );
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isSimulating$.next(false);
    // Drop the simulation override flag so real GPS flows again.
    const cur = this.location.position$.value;
    if (cur?.simulated) {
      void this.location.startWatch();
    }
  }

  get isSimulating(): boolean {
    return this.isSimulating$.value;
  }

  private tick(speedMs: number): void {
    this.traveled += speedMs * (environment.simTickMs / 1000);

    if (this.traveled >= this.totalDistance) {
      const last = this.geometry[this.geometry.length - 1];
      this.location.injectPosition(last, false);
      this.stop();
      return;
    }

    // Find the segment containing `traveled` and interpolate inside it.
    let acc = 0;
    for (let i = 0; i < this.segmentDistances.length; i++) {
      const seg = this.segmentDistances[i];
      if (acc + seg >= this.traveled) {
        const t = seg === 0 ? 0 : (this.traveled - acc) / seg;
        const pos = interpolate(this.geometry[i], this.geometry[i + 1], t);
        // tiny jitter for realism (~±2 m)
        pos.lat += (Math.random() - 0.5) * 0.00004;
        pos.lng += (Math.random() - 0.5) * 0.00004;
        this.location.injectPosition(pos);
        return;
      }
      acc += seg;
    }
  }
}
