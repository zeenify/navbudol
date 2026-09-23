import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { LatLng, PlaceResult, RouteProfile, RouteResult, RouteStep } from '../models';
import { BackendApiService } from './backend-api.service';

/**
 * Routing: OpenRouteService via our backend first (walking profile +
 * elevation + isochrones), OSRM as the keyless fallback. Both are built
 * on OpenStreetMap data.
 */
@Injectable({ providedIn: 'root' })
export class RoutingService {
  constructor(private api: BackendApiService) {}

  async getRoute(
    from: LatLng,
    destination: PlaceResult,
    profile: RouteProfile = 'driving-car'
  ): Promise<RouteResult> {
    // 1. ORS via backend — supports foot-walking and returns elevation.
    try {
      const r = await this.api.post<{
        geometry: LatLng[];
        steps: RouteStep[];
        distanceM: number;
        durationS: number;
        ascentM: number;
      }>(
        '/api/directions',
        { frm: from, to: { lat: destination.lat, lng: destination.lng }, profile },
        30000
      );
      // Backend sends geometry as [lat, lng] pairs — normalize to LatLng.
      const geometry = (r.geometry as unknown as Array<[number, number] | LatLng>).map((p) =>
        Array.isArray(p) ? { lat: p[0], lng: p[1] } : p
      );
      return {
        geometry,
        steps: r.steps,
        distanceM: r.distanceM,
        durationS: this.saneDuration(r.durationS, r.distanceM, profile),
        ascentM: r.ascentM,
        destination,
        source: 'ors',
        profile,
      };
    } catch {
      // ORS/backend unavailable — fall back to OSRM (driving only).
    }

    // 2. OSRM demo server (driving only, no key).
    const url =
      `${environment.osrmBaseUrl}/route/v1/driving/` +
      `${from.lng},${from.lat};${destination.lng},${destination.lat}` +
      `?steps=true&geometries=geojson&overview=full`;

    const data = await this.httpGetJson<OsrmResponse>(url);
    const route = data.routes?.[0];
    if (!route) throw new Error('No route found');
    if (route.distance > 50000) throw new Error('Destination is too far — stay around General Tinio');

    const geometry: LatLng[] = (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lat, lng }));

    const steps: RouteStep[] = [];
    let cumulative = 0;
    for (const leg of route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        const maneuver = step.maneuver ?? { type: 'continue', modifier: '', location: [0, 0] };
        const [lng, lat] = maneuver.location;
        const s: RouteStep = {
          instruction: this.instructionFor(maneuver, step.name ?? ''),
          name: step.name ?? '',
          distanceM: step.distance ?? 0,
          durationS: step.duration ?? 0,
          maneuverType: maneuver.type,
          maneuverModifier: maneuver.modifier ?? '',
          location: { lat, lng },
          cumulativeDistanceM: 0,
        };
        cumulative += s.distanceM;
        s.cumulativeDistanceM = cumulative;
        steps.push(s);
      }
    }

    return {
      geometry,
      steps,
      distanceM: route.distance,
      durationS: this.saneDuration(route.duration, route.distance, profile),
      destination,
      source: 'osrm',
      profile,
    };
  }

  /**
   * Routing engines are optimistic on Philippine roads (missing speed data
   * → motorway defaults). Clamp the average speed to something a local
   * would actually do: 45 km/h driving, 5 km/h walking. The OSRM fallback
   * is car-only, so under the walking profile the time IS the walk time.
   */
  private saneDuration(durationS: number, distanceM: number, profile: RouteProfile): number {
    const cap = profile === 'foot-walking' ? 1.389 : 12.5; // m/s
    const walkOnly = profile === 'foot-walking' ? distanceM / 1.389 : durationS;
    return Math.max(walkOnly, durationS, distanceM / cap);
  }

  /** Human/TTS-friendly instruction from an OSRM maneuver. */
  private instructionFor(
    m: { type: string; modifier?: string; exit?: number },
    roadName: string
  ): string {
    const onto = roadName ? ` onto ${roadName}` : '';
    const mod = (m.modifier ?? '').toLowerCase();

    switch (m.type) {
      case 'depart':
        return mod && mod !== 'uturn' ? `Head ${this.compass(mod)}${onto}` : `Head out${onto}`;
      case 'arrive':
        return 'You have arrived at your destination';
      case 'turn':
      case 'end of road':
        return `${m.type === 'end of road' ? 'At the end of the road, ' : ''}Turn ${mod}${onto}`;
      case 'new name':
        return `Continue${onto}`;
      case 'merge':
        return `Merge ${mod}${onto}`;
      case 'on ramp':
        return `Take the ramp${mod ? ` on the ${mod}` : ''}${onto}`;
      case 'off ramp':
        return `Take the exit${mod ? ` on the ${mod}` : ''}${onto}`;
      case 'fork':
        return `Keep ${mod}${onto}`;
      case 'roundabout':
      case 'rotary':
        return m.exit ? `At the roundabout, take exit ${m.exit}${onto}` : `Enter the roundabout${onto}`;
      case 'roundabout turn':
        return `At the roundabout, turn ${mod}${onto}`;
      case 'exit roundabout':
      case 'exit rotary':
        return `Exit the roundabout${onto}`;
      case 'notification':
        return `Continue${onto}`;
      default:
        return `Continue${onto}`;
    }
  }

  private compass(modifier: string): string {
    const map: Record<string, string> = {
      left: 'left',
      right: 'right',
      'slight left': 'slightly left',
      'slight right': 'slightly right',
      straight: 'straight ahead',
      uturn: 'around',
    };
    return map[modifier] ?? 'ahead';
  }

  /** True when the maneuver glyph should point left. */
  isLeftTurn(step: RouteStep): boolean {
    return step.maneuverModifier.includes('left');
  }

  private async httpGetJson<T>(url: string): Promise<T> {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({ url, connectTimeout: 15000, readTimeout: 25000 });
      if (res.status >= 400) throw new Error(`Routing HTTP ${res.status}`);
      return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T;
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Routing HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

interface OsrmResponse {
  code?: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry?: { coordinates: [number, number][] };
    legs?: Array<{
      steps?: Array<{
        name?: string;
        distance: number;
        duration: number;
        maneuver: {
          type: string;
          modifier?: string;
          exit?: number;
          location: [number, number];
        };
      }>;
    }>;
  }>;
}
