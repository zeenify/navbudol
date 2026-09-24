import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GpsPosition, LatLng, NavState, RouteResult, RouteStep } from '../models';
import { distanceToPolylineM, haversineM, shortDistance } from '../geo.utils';
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
  readonly started$ = new Subject<{ destination: string }>();
  readonly arrived$ = new Subject<{ destination: string }>();

  private route: RouteResult | null = null;
  private currentStepIndex = 0;
  private offRouteCount = 0;
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
    const nextIndex = this.nextManeuverIndex(0);
    const nextStep = nextIndex === null ? null : route.steps[nextIndex];
    const start = route.geometry[0];
    const nextDistance = nextStep && start ? haversineM(start, nextStep.location) : 0;
    this.emit({
      phase: 'preview',
      route,
      currentStepIndex: 0,
      remainingDistanceM: route.distanceM,
      remainingDurationS: route.durationS,
      distanceToNextManeuverM: nextDistance,
      nextInstruction: nextStep?.instruction ?? '',
      nextManeuverType: nextStep?.maneuverType ?? '',
      nextManeuverModifier: nextStep?.maneuverModifier ?? '',
    });
  }

  startNavigation(): void {
    const route = this.route;
    if (!route || this.phase === 'navigating') return;
    this.gpsSub?.unsubscribe();
    this.gpsSub = this.location.position$.subscribe((pos) =>
      this.zone.run(() => this.onPositionUpdate(pos))
    );
    if (!this.route) return;
    const start = route.geometry[0];
    const nextIndex = this.nextManeuverIndex(this.currentStepIndex + 1);
    const nextStep = nextIndex === null ? null : route.steps[nextIndex];
    const nextDistance = nextStep && start ? haversineM(start, nextStep.location) : 0;
    this.emit(this.snapshot(nextDistance));
    this.started$.next({ destination: route.destination.name });
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

    const nextIndex = this.nextManeuverIndex(this.currentStepIndex + 1);
    if (nextIndex === null) {
      if (haversineM(pos, route.destination) < environment.arrivalThresholdM) {
        this.arrived$.next({ destination: route.destination.name });
        this.stopNavigation();
      }
      return;
    }
    const nextStep = route.steps[nextIndex];

    if (nextIndex === route.steps.length - 1 && nextStep.maneuverType.toLowerCase().includes('arrive')) {
      const dest = route.destination;
      if (haversineM(pos, dest) < environment.arrivalThresholdM) {
        this.arrived$.next({ destination: route.destination.name });
        this.stopNavigation();
        return;
      }
    }

    const distToManeuver = haversineM(pos, nextStep.location);

    let displayDistance = distToManeuver;
    if (distToManeuver < environment.stepAdvanceM) {
      this.currentStepIndex = Math.max(this.currentStepIndex, nextIndex);
      const followingIndex = this.nextManeuverIndex(this.currentStepIndex + 1);
      const followingStep = followingIndex === null ? null : route.steps[followingIndex];
      displayDistance = followingStep ? haversineM(pos, followingStep.location) : 0;
    }

    this.emit(this.snapshot(displayDistance));
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

  private nextManeuverIndex(startIndex: number): number | null {
    const route = this.route;
    if (!route) return null;
    for (let i = Math.max(0, startIndex); i < route.steps.length; i++) {
      if (this.isMeaningfulManeuver(route.steps[i])) return i;
    }
    return null;
  }

  private isMeaningfulManeuver(step: RouteStep): boolean {
    const type = `${step.maneuverType} ${step.maneuverModifier}`.toLowerCase();
    return (
      type.includes('left') ||
      type.includes('right') ||
      type.includes('merge') ||
      type.includes('fork') ||
      type.includes('ramp') ||
      type.includes('roundabout') ||
      type.includes('rotary') ||
      type.includes('arrive')
    );
  }

  private snapshot(distToManeuver: number): NavState {
    const route = this.route!;
    const nextIndex = this.nextManeuverIndex(this.currentStepIndex + 1);
    const nextStep = nextIndex === null ? route.steps[route.steps.length - 1] : route.steps[nextIndex];
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

  /** For the AI's get_trip_status function. */
  tripStatusText(): string {
    const s = this.navState$.value;
    if (s.phase === 'idle' || !s.route) return 'No active navigation.';
    return `Heading to ${s.route.destination.name}. ${shortDistance(s.remainingDistanceM)} remaining, about ${Math.round(
      s.remainingDurationS / 60
    )} minutes left. Next: ${s.nextInstruction}.`;
  }
}
