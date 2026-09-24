import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { LatLng, PlaceResult } from '../models';
import { haversineM, isSamePlace } from '../geo.utils';
import { BackendApiService } from './backend-api.service';
import { LOCAL_LANDMARKS } from '../constants/landmarks';
import { isWithinGeneralTinioServiceArea } from '../service-area';

/** Spoken category → dataset words that satisfy it (local nearby search). */
const CATEGORY_SYNONYMS: Array<{ test: RegExp; hay: string[] }> = [
  { test: /\b(7 ?11|seven ?eleven|convenience|sari)\b/, hay: ['7-eleven', '7 eleven', 'convenience'] },
  { test: /\b(hospital|clinic|doctor|healer)\b/, hay: ['hospital', 'clinic', 'medicare'] },
  { test: /\b(gas|fuel|gasoline)\b/, hay: ['fuel', 'gasoline', 'gas station'] },
  { test: /\b(restaurant|eat|food|grill)\b/, hay: ['restaurant', 'eatery', 'food', 'grill', 'barbecue'] },
  { test: /\b(cafe|coffee)\b/, hay: ['cafe', 'coffee'] },
  { test: /\b(atm|bank|money)\b/, hay: ['atm', 'bank'] },
  { test: /\b(pharmacy|drugstore|medicine)\b/, hay: ['pharmacy', 'drug', 'medicine'] },
  { test: /\b(hotel|stay|sleep|lodge)\b/, hay: ['hotel', 'hostel', 'lodge', 'inn', 'transient'] },
  { test: /\b(resort|swim|pool)\b/, hay: ['resort', 'pool', 'water park'] },
  { test: /\b(grocery|market)\b/, hay: ['market', 'grocery', 'supermarket'] },
  { test: /\b(church|parish)\b/, hay: ['church', 'parish'] },
  { test: /\b(school|campus|university)\b/, hay: ['school', 'neust', 'university', 'college'] },
];

/**
 * Search stack, fastest-first:
 *   1. Curated General Tinio landmarks + local OSM index — instant, on-device
 *   2. Geoapify AUTOCOMPLETE via backend (keystroke endpoint, PH-only)
 *   3. Photon (keyless OSM search, typo-fuzzy) — run in PARALLEL with (2)
 *
 * All free providers share OpenStreetMap's underlying data, so gaps in OSM
 * (e.g. NEUST Papaya campus) are covered by curated landmarks instead.
 * Overpass is only used server-side for the one-time local index snapshot.
 */

/** Spoken shortcuts → extra search terms that exist in the map data. */
interface SharedLocationRecord {
  id: string;
  name: string;
  detail?: string;
  lat: number;
  lng: number;
  createdAt?: string;
}

const LOCAL_ALIASES: Array<{ match: RegExp; terms: string[] }> = [
  { match: /neust|science|technology/i, terms: ['neust', 'science', 'technology'] },
  { match: /municipal|town hall|city hall/i, terms: ['municipal'] },
  { match: /church|parish/i, terms: ['church', 'parish'] },
  { match: /school|campus|college|university/i, terms: ['school', 'campus', 'neust'] },
  { match: /market|grocery/i, terms: ['market'] },
  { match: /plaza/i, terms: ['plaza'] },
  // "park" also surfaces Minalungao, but NOT the other way round — searching
  // "minalungao" must not drag in every "… Memorial Park" in the province.
  { match: /\bpark\b/i, terms: ['park', 'minalungao'] },
  { match: /hall/i, terms: ['hall'] },
];

@Injectable({ providedIn: 'root' })
export class PlacesService {
  private lastReverse: { lat: number; lng: number; label: string } | null = null;
  private searchSeq = 0;
  private localIndex: PlaceResult[] | null = null;
  private localIndexLoading: Promise<void> | null = null;
  private userLocations: PlaceResult[] = [];
  private userLocationsLoadedAt = 0;
  private userLocationsLoading: Promise<void> | null = null;

  constructor(private api: BackendApiService) {
    void this.ensureUserLocations();
  }

  // --- Instant local matching (landmarks + cached OSM index) ----------------

  /** Kick off the one-time download of General Tinio's named places. */
  ensureLocalIndex(): Promise<void> {
    if (this.localIndex || this.localIndexLoading) return this.localIndexLoading ?? Promise.resolve();
    this.localIndexLoading = (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const key = `navbudol.localpois.v3.${today}`; // v3 = + Overture/Meta places
        const cached = localStorage.getItem(key);
        if (cached) {
          this.localIndex = JSON.parse(cached) as PlaceResult[];
          return;
        }
        const data = await this.api.get<{
          name: string;
          detail?: string;
          lat: number;
          lng: number;
          type?: string;
        }[]>('/api/localpois', 30000);
        if (data.length) {
          this.localIndex = data.map(
            (d) =>
              ({
                name: d.name,
                detail: d.detail ?? 'General Tinio area',
                lat: d.lat,
                lng: d.lng,
                type: d.type,
              }) as PlaceResult
          );
          try {
            localStorage.setItem(key, JSON.stringify(this.localIndex));
          } catch {
            /* storage full — index still lives in memory */
          }
        }
      } catch {
        /* backend/Overpass unavailable — curated landmarks still work */
      }
    })();
    return this.localIndexLoading;
  }

  ensureUserLocations(force = false): Promise<void> {
    if (!force && this.userLocationsLoadedAt && Date.now() - this.userLocationsLoadedAt < 30000) {
      return Promise.resolve();
    }
    if (this.userLocationsLoading) return this.userLocationsLoading;
    this.userLocationsLoading = (async () => {
      try {
        const records = await this.api.get<SharedLocationRecord[]>('/api/user-locations', 8000);
        this.userLocations = records.map((record) => this.sharedLocationToPlace(record));
        this.userLocationsLoadedAt = Date.now();
      } catch {
        if (!this.userLocationsLoadedAt) this.userLocations = [];
      }
    })().finally(() => {
      this.userLocationsLoading = null;
    });
    return this.userLocationsLoading;
  }

  async addSharedLocation(name: string, detail: string, position: LatLng): Promise<PlaceResult> {
    const record = await this.api.post<SharedLocationRecord>('/api/user-locations', {
      name,
      detail: detail || undefined,
      lat: position.lat,
      lng: position.lng,
    });
    const place = this.sharedLocationToPlace(record);
    this.userLocations = [place, ...this.userLocations.filter((item) => item.sharedLocationId !== place.sharedLocationId)];
    this.userLocationsLoadedAt = Date.now();
    return place;
  }

  private sharedLocationToPlace(record: SharedLocationRecord): PlaceResult {
    return {
      name: record.name,
      detail: record.detail || 'Shared location',
      lat: record.lat,
      lng: record.lng,
      type: 'Shared location',
      sharedLocationId: record.id,
      outsideServiceArea: !isWithinGeneralTinioServiceArea(record),
    };
  }

  /** Instant matches from curated landmarks + the local index. */
  searchLocal(query: string, near: LatLng | null): PlaceResult[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    void this.ensureUserLocations();
    const pool = [...LOCAL_LANDMARKS, ...(this.localIndex ?? []), ...this.userLocations];
    if (pool.length === 0) return [];
    const landmarkCount = LOCAL_LANDMARKS.length;

    // Curated landmarks dupe against dataset entries by name — dedupe
    // name-aware within ~110 m (multiple branches of one brand survive).
    const seen = new Set<string>();
    const deduped = pool.filter((p) => {
      const key = `${p.name.trim().toLowerCase()}|${p.lat.toFixed(3)}|${p.lng.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // alias expansion: "neust" also matches science/technology names, etc.
    const terms = new Set([q]);
    for (const alias of LOCAL_ALIASES) {
      if (alias.match.test(q)) alias.terms.forEach((t) => terms.add(t.toLowerCase()));
    }

    const scored: Array<{ p: PlaceResult; score: number; curated: boolean }> = [];
    for (let i = 0; i < deduped.length; i++) {
      const p = deduped[i];
      const name = p.name.toLowerCase();
      let score = 99;
      for (const term of terms) {
        if (name.startsWith(term)) score = Math.min(score, 0);
        else if (name.includes(term)) score = Math.min(score, 2);
      }
      if (score < 99) {
        scored.push({
          p: {
            ...p,
            distanceM: near ? haversineM(near, p) : undefined,
            outsideServiceArea: !isWithinGeneralTinioServiceArea(p),
          },
          score,
          // curated entry wins outright — the landmark it represents is what
          // people mean ("minalungao" → the park, not a nearby transient)
          curated: i < landmarkCount,
        });
      }
    }
    scored.sort(
      (a, b) =>
        Number(b.curated) - Number(a.curated) ||
        a.score - b.score ||
        (a.p.distanceM ?? 0) - (b.p.distanceM ?? 0)
    );
    return scored.slice(0, 8).map((s) => s.p);
  }

  // --- Online search (Geoapify autocomplete ∥ Photon) -----------------------

  async search(query: string, near: LatLng | null, limit = 8): Promise<PlaceResult[]> {
    const seq = ++this.searchSeq;
    const q = query.trim();
    if (!q) return [];
    await Promise.all([this.ensureLocalIndex(), this.ensureUserLocations()]);
    const local = this.searchLocal(q, near);

    const [geoRes, photonRes] = await Promise.allSettled([
      // Geoapify AUTOCOMPLETE via backend — designed for keystrokes, PH-only
      this.api.getParams<GeocodeItem[]>('/api/geocode', {
        q,
        lat: near?.lat,
        lon: near?.lng,
        limit,
      }),
      // Photon — OSM-native with typo fuzziness
      this.photonSearch(q, near, limit),
    ]);
    if (seq !== this.searchSeq) return []; // a newer search superseded this one

    const remote: PlaceResult[] = [];
    if (geoRes.status === 'fulfilled') {
      for (const g of geoRes.value) {
        remote.push({
          name: g.name,
          detail: g.detail ?? undefined,
          lat: g.lat,
          lng: g.lng,
          type: g.type ?? undefined,
        });
      }
    }
    if (photonRes.status === 'fulfilled') {
      remote.push(...photonRes.value);
    }
    const fresh = this.dedupe(remote)
      .map((result) => ({ ...result, outsideServiceArea: !isWithinGeneralTinioServiceArea(result) }))
      .filter((result) => !local.some((item) => isSamePlace(item, result)));
    return [...local, ...fresh].slice(0, limit);
  }

  private async photonSearch(query: string, near: LatLng | null, limit: number): Promise<PlaceResult[]> {
    let url = `${environment.photonBaseUrl}/api/?q=${encodeURIComponent(query)}&limit=${limit}`;
    if (near) {
      url += `&lat=${near.lat}&lon=${near.lng}`;
    }
    const data = await this.httpGetJson<{ features?: PhotonFeature[] }>(url);
    return (data.features ?? [])
      .filter((f) => f.geometry?.coordinates?.length === 2)
      .map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties ?? {};
        const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || 'Unnamed place';
        const detail = [p.city, p.state].filter(Boolean).join(', ');
        return {
          name,
          detail: detail || p.type || undefined,
          lat,
          lng,
          type: p.osm_value || p.type,
        } as PlaceResult;
      });
  }

  private dedupe(places: PlaceResult[]): PlaceResult[] {
    // Geoapify and Photon return the same OSM object with slightly different
    // pins, so key on normalised name + proximity instead of exact coords.
    const kept: PlaceResult[] = [];
    for (const p of places) {
      if (!kept.some((k) => isSamePlace(k, p))) kept.push(p);
    }
    return kept;
  }

  // --- Nearby POI (local dataset first; Overpass as fallback) ----------------

  /**
   * Instant nearby search over the local merged dataset — no network. Good
   * for "nearest 7-Eleven"-style asks at town scale, where live Overpass
   * mirrors are too flaky to be the primary path.
   */
  async nearbyLocal(query: string, near: LatLng, radiusM = 5000, limit = 6): Promise<PlaceResult[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    await Promise.all([this.ensureLocalIndex(), this.ensureUserLocations()]);
    const pool = [...LOCAL_LANDMARKS, ...(this.localIndex ?? []), ...this.userLocations];
    if (pool.length === 0) return [];

    const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const scored: Array<{ p: PlaceResult; rank: number }> = [];
    for (const p of pool) {
      const d = haversineM(near, p);
      if (d > radiusM) continue;
      const hay = `${p.name} ${p.type ?? ''} ${p.detail ?? ''}`.toLowerCase();
      let score = 0;
      for (const w of words) if (hay.includes(w)) score += 5;
      for (const syn of CATEGORY_SYNONYMS) {
        if (syn.test.test(q) && syn.hay.some((h) => hay.includes(h))) score += 5;
      }
      if (score > 0) {
        scored.push({
          p: { ...p, distanceM: d, outsideServiceArea: !isWithinGeneralTinioServiceArea(p) },
          rank: score * 1000 - d,
        });
      }
    }
    return scored
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit)
      .map((s) => s.p);
  }

  /** Common spoken categories mapped to OSM tags — "nearby gas station"
   *  should query amenity=fuel, not name~"gas". */
  private static CATEGORY_TAGS: Record<string, string[]> = {
    restaurant: ['amenity=restaurant', 'amenity=fast_food', 'amenity=cafe'],
    food: ['amenity=restaurant', 'amenity=fast_food', 'amenity=cafe'],
    cafe: ['amenity=cafe'],
    gas: ['amenity=fuel'],
    fuel: ['amenity=fuel'],
    atm: ['amenity=atm'],
    bank: ['amenity=bank'],
    pharmacy: ['amenity=pharmacy'],
    drugstore: ['amenity=pharmacy'],
    hospital: ['amenity=hospital', 'amenity=clinic'],
    clinic: ['amenity=clinic'],
    school: ['amenity=school'],
    university: ['amenity=university', 'amenity=college'],
    church: ['amenity=place_of_worship'],
    hotel: ['tourism=hotel', 'tourism=guest_house'],
    market: ['shop=supermarket', 'amenity=marketplace'],
    grocery: ['shop=supermarket', 'shop=convenience'],
    parking: ['amenity=parking'],
    police: ['amenity=police'],
    barangay: ['amenity=townhall', 'office=government'],
  };

  async nearby(query: string, near: LatLng, radiusM = 2000, limit = 10): Promise<PlaceResult[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const tags = this.matchCategory(q);
    // Inner filters only — node()/way()/relation() provide the element type,
    // an "nwr" prefix here is invalid Overpass QL (HTTP 400).
    const inner = tags.length
      ? tags.map((t) => this.tagFilter(t)).join(',')
      : `["name"~"${this.escapeRegex(query.trim())}",i]`;

    const body =
      `[out:json][timeout:20];(node${inner}(around:${Math.round(radiusM)},${near.lat},${near.lng});` +
      `way${inner}(around:${Math.round(radiusM)},${near.lat},${near.lng});` +
      `relation${inner}(around:${Math.round(radiusM)},${near.lat},${near.lng}););out center ${limit};`;

    const data = await this.httpPostJson<{ elements?: OverpassElement[] }>(
      environment.overpassUrl,
      body
    );
    return (data.elements ?? [])
      .filter((el) => el.lat != null && el.lon != null)
      .map((el) => ({
        name: el.tags?.['name'] ?? el.tags?.['brand'] ?? 'Unnamed place',
        detail: el.tags?.['addr:street'] ?? el.tags?.['amenity'] ?? el.tags?.['shop'] ?? undefined,
        lat: el.lat as number,
        lng: el.lon as number,
        type: el.tags?.['amenity'] ?? el.tags?.['shop'] ?? el.tags?.['tourism'] ?? 'poi',
        distanceM: haversineM(near, { lat: el.lat as number, lng: el.lon as number }),
      }))
      .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
      .slice(0, limit);
  }

  private matchCategory(q: string): string[] {
    for (const key of Object.keys(PlacesService.CATEGORY_TAGS)) {
      if (q.includes(key)) return PlacesService.CATEGORY_TAGS[key];
    }
    return [];
  }

  private tagFilter(tag: string): string {
    const [k, v] = tag.split('=');
    return `["${k}"="${v}"]`;
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // --- Reverse geocode (cached, 200 m threshold) --------------------------

  async reverseGeocode(pos: LatLng): Promise<string | null> {
    const last = this.lastReverse;
    if (last && haversineM(pos, last) < 200) return last.label;

    // 1. Geoapify via backend
    try {
      const r = await this.api.getParams<{ label: string | null }>('/api/reverse', {
        lat: pos.lat,
        lon: pos.lng,
      });
      if (r.label) {
        this.lastReverse = { lat: pos.lat, lng: pos.lng, label: r.label };
        return r.label;
      }
    } catch {
      /* fall through */
    }

    // 2. Nominatim fallback (1 req/s — we cache 200 m so we're well under)
    try {
      const url = `${environment.nominatimUrl}/reverse?lat=${pos.lat}&lon=${pos.lng}&format=json&zoom=18`;
      const data = await this.httpGetJson<NominatimReverse>(url);
      const label =
        (data.address
          ? [
              data.address.road,
              data.address.suburb,
              data.address.city ?? data.address.town ?? data.address.municipality,
            ]
              .filter(Boolean)
              .join(', ') || data.display_name
          : data.display_name) ?? null;
      if (label) this.lastReverse = { lat: pos.lat, lng: pos.lng, label };
      return label;
    } catch {
      return this.lastReverse?.label ?? null;
    }
  }

  // --- HTTP plumbing (CapacitorHttp on device avoids CORS entirely) -------

  private async httpGetJson<T>(url: string): Promise<T> {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.get({ url, connectTimeout: 15000, readTimeout: 20000 });
      if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`);
      return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T;
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  }

  private async httpPostJson<T>(url: string, body: string): Promise<T> {
    if (Capacitor.isNativePlatform()) {
      const res = await CapacitorHttp.post({
        url,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: `data=${encodeURIComponent(body)}`,
        connectTimeout: 15000,
        readTimeout: 30000,
      });
      if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`);
      return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(body)}`,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return (await res.json()) as T;
  }
}

interface PhotonFeature {
  geometry: { coordinates: number[] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    type?: string;
    osm_value?: string;
  };
}

interface GeocodeItem {
  name: string;
  detail?: string | null;
  lat: number;
  lng: number;
  type?: string | null;
}

interface OverpassElement {
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

interface NominatimReverse {
  display_name?: string;
  address?: {
    road?: string;
    suburb?: string;
    city?: string;
    town?: string;
    municipality?: string;
  };
}
