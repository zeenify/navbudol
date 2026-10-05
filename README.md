# NavBudol

NavBudol is a voice-first AI navigation companion for **General Tinio, Nueva Ecija (Philippines)**. You pick a character co-pilot, say where you want to go by text or voice, and the app searches local places, plots a route, and walks or drives you there with spoken turn-by-turn directions — all grounded in a committed local POI dataset and OpenStreetMap-based routing. The frontend is an Angular/Ionic app packaged for Android with Capacitor; the backend is a small FastAPI service that holds the API keys and proxies the AI, speech, and geo providers.

## Features

- **Interactive map** — Leaflet with MapTiler raster tiles (light / dark / satellite), centered on the General Tinio poblacion, with a GPS dot that only appears after a real (or simulated) fix.
- **Local place search** — instant search over a committed dataset of General Tinio–area places (`backend/data/places_final.json`, merged from Foursquare, Overture, and OSM) served by `GET /api/localpois` and cached on-device, plus curated on-device landmarks for spots OSM is missing, Geoapify autocomplete through the backend, and reverse geocoding for the current address.
- **AI chat co-pilot** — a Gemini function-calling loop that runs entirely on the device. The model can call seven tools: `search_places`, `find_nearby_places`, `get_directions`, `start_navigation`, `stop_navigation`, `get_trip_status`, and `get_weather`. When a search returns several matches they render as a tappable list, and replies like "the nearest" or "the second one" resolve without another AI round-trip.
- **Character co-pilots** — seven selectable characters (NavBuddy, Gojo, Makima, Marin, Toji, Miku, Reze), each with their own greeting, in-character system prompt, and navigation start/arrival lines.
- **Voice in and out** — speech recognition (native Android `SpeechRecognizer` via Capacitor, Web Speech API in the browser) for tap-to-talk input, and Fish Audio text-to-speech through the backend with cached MP3s and per-character playback gain. Characters without a Fish voice (NavBuddy) speak with the browser's `speechSynthesis` instead.
- **Turn-by-turn navigation** — a navigation engine with step tracking, spoken proximity alerts before each maneuver, off-route detection with hysteresis and automatic rerouting, and arrival detection within 30 m of the destination.
- **Simulate Travel** — a demo mode that moves the GPS dot along the plotted route at walking or driving pace (with a speed multiplier), so the whole experience can be demonstrated indoors without moving.
- **Shared community locations** — named pins added by users at runtime are stored in `backend/data/user_locations.json` and served back into search results. New pins are accepted only inside the General Tinio service area (20 km around the town center).
- **Routing** — OpenRouteService through the backend (driving and walking profiles, elevation, maneuver instructions) with the public OSRM demo server as a keyless driving fallback. Estimated durations are clamped to speeds a local would actually do on these roads.
- **Weather chip** — current conditions from OpenWeatherMap, shown on the map.
- **Settings** — dark mode, satellite basemap, travel profile (driving / walking), and simulation controls, persisted in `localStorage`.

## Architecture

The repository is two independent apps:

- **`app/`** — the Angular + Ionic + Capacitor client. The Gemini function-calling loop lives here, on the device, because only the device knows the GPS position and map state. The backend never executes tools; it is a stateless proxy that forwards the conversation (`contents` + `tools`) to Gemini and returns the model's text, function calls, and raw parts (including thought signatures, which round-trip untouched). Requests use `fetch` in the browser and `CapacitorHttp` on device.
- **`backend/`** — the FastAPI service. Three jobs: proxy Gemini (`POST /api/chat`), proxy Fish Audio TTS with an MP3 cache (`POST /api/tts`), and proxy/key the free geo providers (weather, geocoding, routing, the local POI index, shared locations).

**Keys never ship in the client.** Gemini, Fish Audio, OpenRouteService, OpenWeatherMap, and Geoapify keys live only in `backend/.env`. The single exception is the MapTiler map key, which is public by design (map-rendering keys are meant for clients; restrict it to your domains in the MapTiler dashboard).

**No accounts, no database.** The POI search index is a committed JSON file; shared locations go to a single runtime JSON file (`backend/data/user_locations.json`, written atomically behind a lock); all app settings live in the browser's `localStorage`. The backend has wildcard CORS and no authentication — it is a demo proxy, so don't expose it to the open internet as-is.

## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | Angular 22.1.7, Ionic Angular 9, Capacitor 8.5.2, Leaflet 1.9.4, TypeScript 6.0, RxJS 7.8 |
| Native | Capacitor Android, `@capacitor-community/speech-recognition` 7.0.1, Capacitor Geolocation |
| Tooling | Angular CLI 22.1.8, ESLint 10 + angular-eslint, Vitest 4 |
| Backend | Python, FastAPI ≥ 0.115, Uvicorn ≥ 0.30, httpx ≥ 0.27, python-dotenv ≥ 1.0 |
| AI | Google Gemini (default model `gemini-3.5-flash-lite`) for chat, Fish Audio for character voices |
| Geo | MapTiler tiles, OpenRouteService, OpenWeatherMap, Geoapify, plus keyless OSRM / Photon / Overpass fallbacks |

## Getting started

### Backend

From the `backend/` directory:

```powershell
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
.\venv\Scripts\python.exe -m uvicorn main:app --port 8010
```

Create `backend/.env` with the API keys the backend proxies. The variable names (values live in the Render dashboard or your local `.env`, never in git):

```
GEMINI_API_KEY
FISH_API_KEY
GEMINI_MODEL
FISH_MODEL
ORS_API_KEY
OWM_API_KEY
GEOAPIFY_KEY
HF_TOKEN
```

The app still boots if some keys are missing — `GET /api/health` reports which AI/TTS keys are set, and routing falls back to keyless OSRM when the OpenRouteService key is absent. Port **8010** is deliberate: the client's environment files point at `http://localhost:8010`.

### Frontend

From the repository root, put the repo-local Node runtime on your PATH first (Angular CLI 22 needs a newer Node than many system installs):

```powershell
$env:Path = "$PWD\.tooling\node22;$env:Path"
```

Then, from `app/`:

```powershell
npm install
npx ng serve --port 8300
```

Open `http://localhost:8300` — it lands on the map tab. Keep the backend running alongside it.

### Android

From `app/`, with the local Node runtime still on your PATH:

```powershell
npx ng build --configuration production
npx cap sync android
npx cap open android
```

For a USB-connected device, run `adb reverse tcp:8010 tcp:8010` so the app's `http://localhost:8010` reaches your laptop's backend.

## Deployment

A [Render Blueprint](render.yaml) at the repository root deploys the backend as a free Render Python web service: **Root Directory** `backend`, build command `pip install -r requirements.txt`, start command `uvicorn main:app --host 0.0.0.0 --port $PORT`, and health check path `/api/health`. The secret environment variables (Gemini, Fish, ORS, OWM, Geoapify) are declared with `sync: false` — set their values in the Render dashboard when the blueprint syncs. Remember the backend is an unauthenticated demo proxy; keep it on Render's free tier for coursework demos rather than a public product.

## Project structure

```
app/                          Angular + Ionic + Capacitor client
  src/app/map/                Map tab: Leaflet map, search bar, chat sheet,
                              navigation banner, route preview, mic button
  src/app/chat/               Full-page conversation tab (shares state with the map)
  src/app/settings/           Dark mode, satellite, travel profile, simulation
  src/app/character-select/   Pick your AI co-pilot
  src/app/core/services/      Gemini function-calling loop, navigation engine,
                              routing, places, speech recognition, TTS, simulation
  src/app/core/constants/     Character roster, curated landmarks, system prompt
  src/environments/           Backend URL, map config, navigation thresholds
backend/                      FastAPI service
  main.py                     App wiring + GET /api/health
  routers/                    chat, tts, geo (weather/geocode/directions/localpois),
                              locations (shared community locations)
  services/                   gemini_client, fish_client (stateless proxies)
  data/places_final.json      Committed POI dataset served by GET /api/localpois
render.yaml                   Render Blueprint for the backend
```
