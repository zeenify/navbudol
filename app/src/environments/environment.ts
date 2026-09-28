export const environment = {
  production: false,

  // === Backend (the ONLY private API surface) ===
  // Keys live in backend/.env — GEMINI_API_KEY + FISH_API_KEY. Never here.
  // Android device: same URL thanks to `adb reverse tcp:8010 tcp:8010`
  // Android emulator: 'http://10.0.2.2:8010'
  // (Port 8010 — 8000 is taken by a PHP dev server on this machine.)
  backendBaseUrl: 'http://localhost:8010',

  // === Free geo stack (no keys) ===
  osrmBaseUrl: 'https://router.project-osrm.org',
  photonBaseUrl: 'https://photon.komoot.io',
  overpassUrl: 'https://overpass-api.de/api/interpreter',
  nominatimUrl: 'https://nominatim.openstreetmap.org',

  // === Map ===
  // MapTiler key — public by design (map keys are meant for the client;
  // restrict it to your domains in the MapTiler dashboard later).
  // These are RASTER style bases: the app appends /{z}/{x}/{y}@2x.png.
  maptilerKey: 'BgsOnI7Mec1DAzJCOWSF',
  maptilerStyles: {
    light: 'https://api.maptiler.com/maps/streets-v2',
    dark: 'https://api.maptiler.com/maps/streets-v2-dark',
    satellite: 'https://api.maptiler.com/maps/hybrid',
  },
  defaultCenter: { lat: 15.3519, lng: 121.0633 }, // Gen. Tinio (Papaya) Poblacion, Nueva Ecija
  defaultZoom: 15,

  // === Navigation thresholds ===
  offRouteThresholdM: 50,
  offRouteHysteresis: 3, // consecutive off-route fixes before reroute
  alertDistance1M: 200, // first voice alert
  alertDistance2M: 50, // second voice alert
  stepAdvanceM: 20, // advance to next step
  arrivalThresholdM: 30, // "you have arrived"

  // === Simulation ===
  simSpeedWalkingMs: 1.4, // walking m/s
  simSpeedDrivingMs: 11, // driving m/s (~40 km/h)
  simTickMs: 500, // position update interval

  // === Voice ===
  maxChatHistory: 20,
};
