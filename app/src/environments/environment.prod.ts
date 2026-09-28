export const environment = {
  production: true,

  // 8000 is taken by a PHP dev server on the dev machine — backend lives on 8010.
  backendBaseUrl: 'http://localhost:8010',

  osrmBaseUrl: 'https://router.project-osrm.org',
  photonBaseUrl: 'https://photon.komoot.io',
  overpassUrl: 'https://overpass-api.de/api/interpreter',
  nominatimUrl: 'https://nominatim.openstreetmap.org',

  // === Map ===
  maptilerKey: 'BgsOnI7Mec1DAzJCOWSF',
  maptilerStyles: {
    light: 'https://api.maptiler.com/maps/streets-v2',
    dark: 'https://api.maptiler.com/maps/streets-v2-dark',
    satellite: 'https://api.maptiler.com/maps/hybrid',
  },
  defaultCenter: { lat: 15.3519, lng: 121.0633 },
  defaultZoom: 15,

  offRouteThresholdM: 50,
  offRouteHysteresis: 3,
  alertDistance1M: 200,
  alertDistance2M: 50,
  stepAdvanceM: 20,
  arrivalThresholdM: 30,

  simSpeedWalkingMs: 1.4,
  simSpeedDrivingMs: 11,
  simTickMs: 500,

  maxChatHistory: 20,
};
