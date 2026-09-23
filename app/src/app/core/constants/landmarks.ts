import { PlaceResult } from '../models';

/**
 * Curated General Tinio (Papaya) landmarks — always available in search,
 * matched instantly on-device (no network).
 *
 * These exist here because OpenStreetMap lacks them (verified: NEUST Papaya
 * Off-Campus is unmapped upstream, so NO search engine can find it).
 *
 * Coordinates marked approx were placed at the feature's known part of
 * town — if you know the exact spot, fix the lat/lng here (one line each).
 */
export const LOCAL_LANDMARKS: PlaceResult[] = [
  {
    name: 'NEUST General Tinio Campus (Papaya Off-Campus)',
    detail: 'Nueva Ecija University of Science and Technology — approximate pin',
    lat: 15.3523,
    lng: 121.0645,
  },
  {
    name: 'General Tinio Municipal Hall',
    detail: 'Poblacion, General Tinio (verified via Geoapify)',
    lat: 15.34994,
    lng: 121.0459038,
  },
  {
    name: 'Holy Cross Parish Church',
    detail: 'Poblacion, General Tinio — approximate pin',
    lat: 15.351,
    lng: 121.0642,
  },
  {
    name: 'General Tinio Town Plaza',
    detail: 'Poblacion, General Tinio — approximate pin',
    lat: 15.352,
    lng: 121.0638,
  },
  {
    name: 'General Tinio Public Market',
    detail: 'Poblacion, General Tinio — approximate pin',
    lat: 15.3525,
    lng: 121.062,
  },
  {
    name: 'General Tinio Central School',
    detail: 'Poblacion Central, General Tinio',
    lat: 15.35128,
    lng: 121.0454,
  },
  {
    name: 'Minalungao National Park',
    detail: 'Sitio Minalungao, Peñaranda Rd, General Tinio',
    lat: 15.29893,
    lng: 121.12291,
  },
];
