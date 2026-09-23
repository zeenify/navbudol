import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GpsPosition, LatLng, NavState, RouteResult } from '../models';
import { distanceToPolylineM, formatDistance, haversineM, shortDistance } from '../geo.utils';
import { LocationService } from './location.service';
import { RoutingService } from './routing.service';

/**
 * The live navigation engine (plan §7.4). Turns raw GPS updates into a
 * Waze-style experience: step tracking, proximity voice alerts,
 * off-route detection with hysteresis, auto-rerouting, arrival detection.
 */
@Injectable({ providedIn: 'root' })
export class NavigationService {
  readonly navState$ = new BehaviorSubject<NavState>(this.idleState());
  /** Voice alert texts — the voice layer speaks these without any AI call. */
  readonly alerts$ = new Subject<string>();

  private route: RouteResult | null = null;
  private currentStepIndex = 0;
  private offRouteCount = 0;
  private alert200mFired = false;
  private alert50mFired = false;
  private gpsSub: Subscription | null = null;
  private rerouting = false;

  constructor(
    private location: LocationService,
    private routing: RoutingService,
    private zone: NgZone
  ) {}

  get phase() {
    return this.navState$.value.phase;
  }

  previewRoute(route: RouteResult): void {
    this.route = route;
    this.currentStepIndex = 0;
    this.offRouteCount = 0;
    this.alert200mFired = false;
    this.alert50mFired = false;
    this.emit({
      phase: 'preview',
      route,
      currentStepIndex: 0,
      remainingDistanceM: route.distanceM,
      remainingDurationS: route.durationS,
      distanceToNextManeuverM: 0,
      nextInstruction: route.steps[0]?.instruction ?? '',
      nextManeuverType: route.steps[0]?.maneuverType ?? '',
      nextManeuverModifier: route.steps[0]?.maneuverModifier ?? '',
    });
  }

  startNavigation(): void {
    if (!this.route) return;
    if (this.phase === 'navigating') return;
    this.alerts$.next('Navigation started');
    this.gpsSub?.unsubscribe();
    this.gpsSub = this.location.position$.subscribe((pos) =>
      this.zone.run(() => this.onPositionUpdate(pos))
    );
    this.emit({ ...this.navState$.value, phase: 'navigating' });
  }

  stopNavigation(): void {
    this.gpsSub?.unsubscribe();
    this.gpsSub = null;
    this.route = null;
    this.emit(this.idleState());
  }

  get hasRoute(): boolean {
    return this.route !== null;
  }

  // --- core tracking (runs on every GPS fix while navigating) -------------

  private onPositionUpdate(pos: GpsPosition | null): void {
    if (!pos) return;
    const route = this.route;
    if (!route || this.phase !== 'navigating') return;

    // 1. Off-route detection with hysteresis
    const distToRoute = distanceToPolylineM(pos, route.geometry);
    if (distToRoute > environment.offRouteThresholdM) {
      this.offRouteCount++;
      if (this.offRouteCount >= environment.offRouteHysteresis && !this.rerouting) {
        void this.reroute(pos);
      }
      return;
    }
    this.offRouteCount = 0;

    // 2. Distance to the NEXT maneuver point
    const nextStep = route.steps[this.currentStepIndex + 1] ?? route.steps[0];
    if (!nextStep) return;

    if (this.currentStepIndex + 1 >= route.steps.length) {
      // On the last step — check arrival instead.
      const dest = route.destination;
      if (haversineM(pos, dest) < environment.arrivalThresholdM) {
        this.alerts$.next('You have arrived at your destination!');
        this.stopNavigation();
        return;
      }
    }

    const distToManeuver = haversineM(pos, nextStep.location);

    // 3. Proximity voice alerts
    if (distToManeuver < environment.alertDistance1M && !this.alert200mFired) {
      this.alert200mFired = true;
      this.alerts$.next(`In ${formatDistance(distToManeuver)}, ${this.stripYou(nextStep.instruction)}`);
    }
    if (distToManeuver < environment.alertDistance2M && !this.alert50mFired) {
      this.alert50mFired = true;
      this.alerts$.next(`${this.stripYou(nextStep.instruction)} now`);
    }

    // 4. Advance step
    if (distToManeuver < environment.stepAdvanceM) {
      this.currentStepIndex++;
      this.alert200mFired = false;
      this.alert50mFired = false;
    }

    this.emit(this.snapshot(distToManeuver));
  }

  private async reroute(pos: LatLng): Promise<void> {
    if (!this.route) return;
    this.rerouting = true;
    this.alerts$.next('Rerouting...');
    this.emit({ ...this.navState$.value, phase: 'rerouting' });
    try {
      const dest = this.route.destination;
      const newRoute = await this.routing.getRoute(pos, dest);
      this.previewRoute(newRoute);
      this.emit({ ...this.navState$.value, phase: 'navigating' });
    } catch (e) {
      console.warn('Reroute failed', e);
      this.emit({ ...this.navState$.value, phase: 'navigating' });
    } finally {
      this.rerouting = false;
      this.offRouteCount = 0;
    }
  }

  // --- helpers -------------------------------------------------------------

  private snapshot(distToManeuver: number): NavState {
    const route = this.route!;
    const nextStep = route.steps[this.currentStepIndex + 1];
    const done = this.currentStepIndex >= 0 ? route.steps[this.currentStepIndex] : null;
    const traveled = done ? done.cumulativeDistanceM - done.distanceM : 0;
    return {
      phase: 'navigating',
      route,
      currentStepIndex: this.currentStepIndex,
      remainingDistanceM: Math.max(0, route.distanceM - traveled),
      remainingDurationS: Math.max(
        0,
        route.durationS * (route.distanceM > 0 ? (route.distanceM - traveled) / route.distanceM : 0)
      ),
      distanceToNextManeuverM: distToManeuver,
      nextInstruction: nextStep?.instruction ?? 'You have arrived at your destination',
      nextManeuverType: nextStep?.maneuverType ?? 'arrive',
      nextManeuverModifier: nextStep?.maneuverModifier ?? '',
    };
  }

  private emit(state: NavState): void {
    this.navState$.next(state);
  }

  private idleState(): NavState {
    return {
      phase: 'idle',
      route: null,
      currentStepIndex: 0,
      remainingDistanceM: 0,
      remainingDurationS: 0,
      distanceToNextManeuverM: 0,
      nextInstruction: '',
      nextManeuverType: '',
      nextManeuverModifier: '',
    };
  }

  private stripYou(instruction: string): string {
    return instruction.replace(/you have arrived.*/i, 'arrive');
  }

  /** For the AI's get_trip_status function. */
  tripStatusText(): string {
    const s = this.navState$.value;
    if (s.phase === 'idle' || !s.route) return 'No active navigation.';
    return `Heading to ${s.route.destination.name}. ${shortDistance(s.remainingDistanceM)} remaining, about ${Math.round(
      s.remainingDurationS / 60
    )} minutes left. Next: ${s.nextInstruction}.`;
  }
}
