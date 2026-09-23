import { LatLng } from './models';

const EARTH_R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in meters. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees 0-360 (0 = north). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180) / Math.PI < 0
    ? (Math.atan2(y, x) * 180) / Math.PI + 360
    : (Math.atan2(y, x) * 180) / Math.PI;
}

/** Linear interpolation between two points (t in 0..1). */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** Local flat projection (meters) — fine for distances < ~10 km. */
function toLocalM(p: LatLng, origin: LatLng): { x: number; y: number } {
  const x = toRad(p.lng - origin.lng) * EARTH_R * Math.cos(toRad(origin.lat));
  const y = toRad(p.lat - origin.lat) * EARTH_R;
  return { x, y };
}

/** Shortest distance in meters from a point to a polyline. */
export function distanceToPolylineM(p: LatLng, line: LatLng[]): number {
  if (!line || line.length === 0) return Infinity;
  if (line.length === 1) return haversineM(p, line[0]);

  const o = p;
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = toLocalM(line[i], o);
    const b = toLocalM(line[i + 1], o);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    let t = lenSq === 0 ? 0 : -(a.x * abx + a.y * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const dx = a.x + abx * t;
    const dy = a.y + aby * t;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < min) min = dist;
  }
  return min;
}

/** Closest point to `p` on segment a→b (flat-earth math, fine < 10 km). */
export function snapToSegment(p: LatLng, a: LatLng, b: LatLng): LatLng {
  const o = p;
  const la = toLocalM(a, o);
  const lb = toLocalM(b, o);
  const abx = lb.x - la.x;
  const aby = lb.y - la.y;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : -(la.x * abx + la.y * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** "350 m" / "1.2 km" — TTS-friendly. */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} meters`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} kilometers`;
}

/** "in 50 meters" style short label for banners. */
export function shortDistance(m: number): string {
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** "2 min" / "1 hr 5 min" — TTS-friendly. */
export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} hour${h === 1 ? '' : 's'}` : `${h} hr ${m} min`;
}

/** Loose name key for duplicate checks: case/diacritic/punctuation-insensitive. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same name, close together — i.e. one place seen by two providers. */
export function isSamePlace(a: LatLng & { name: string }, b: LatLng & { name: string }, withinM = 250): boolean {
  return normName(a.name) === normName(b.name) && haversineM(a, b) < withinM;
}
