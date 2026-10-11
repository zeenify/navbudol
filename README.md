# NavBudol

NavBudol is a **community-mapped, voice-first navigation companion** for **General Tinio, Nueva Ecija (Philippines)**. Neighbors add the places that matter to them — a milk-tea shop, a shortcut, a barber that isn't on any map — right from where they're standing, complete with photos, ratings, comments, and likes. An AI co-pilot (you pick the character) navigates everyone there with precise spoken turn-by-turn directions, reads the community's reviews with its trust signals, and chats with you *while you drive*. The frontend is an Angular/Ionic app packaged for Android with Capacitor; the backend is a FastAPI service holding the accounts, the community database, and the API keys for the AI, speech, and geo providers.

## Features

- **Accounts** — lightweight username/password registration with bcrypt-hashed passwords and server-side sessions. Every contribution is public and attributable: profiles show the places someone added, their photos, comments, and verified visits.
- **Community places** — anyone can add a place **only while physically standing at it** (GPS geofence, 75 m tolerance). The creator owns the name, description, icon, and curated photo gallery; the community contributes photos, 1–5 star ratings, likes/dislikes, and comments. Community places can be edited or retired by their creator.
- **Places are typed by icon, not by a rigid schema** — a ~100-icon library (Material Symbols, self-hosted) covers common categories (school, church, police, health center…) down to niche ones, with a searchable picker and **AI icon matching** ("let the AI pick" from the place description). The map renders community places as teardrop icon pins up close and circle chips when zoomed out.
- **Verified visits** — the app has GPS proof when someone actually arrives at a place (navigation arrival or an on-site photo upload). Comments from those users carry a **"was here" badge**, which is the platform's answer to "are the comments legit?".
- **One-tap photo contribution** — while the user is on-site at a community place, the app watches the system MediaStore for new camera photos (native Android plugin, foreground-only) and pops a card: *post this photo?* with an optional one-line caption. In-app camera and library upload live on the place page too.
- **AI chat co-pilot** — a Gemini function-calling loop that runs entirely on the device, with tools for local POI search, directions, navigation control, trip status, weather, and **community place intelligence**: `get_nearby_community_places` and `get_place_details` surface ratings, likes, photos, and comments *with their verified-visit badges*, so the model can honestly judge whether a place's reviews are trustworthy. The chat is available **during navigation** in a compact sheet that never covers the map.
- **Turn-by-turn voice** — staged, precise approach calls for **every decision point** (turns, forks, ramps, roundabouts, and 3-way-plus crossings): "In 160 meters, turn right" → "50 meters — turn right" → "Turn right now.", spoken in the character's voice with no AI round trip. Off-route detection with hysteresis and automatic rerouting; arrival detection within 30 m that records a verified visit at community destinations.
- **Character co-pilots** — seven selectable characters (NavBuddy, Gojo, Makima, Marin, Toji, Miku, Reze), each with their own greeting, in-character system prompt, navigation start/arrival lines, and Fish Audio voice.
- **Simulate Travel** — a demo mode that drives the GPS dot along the plotted route at walking or driving pace with a speed multiplier, so the whole experience works indoors.
- **Local place search** — the committed General Tinio POI dataset (`backend/data/places_final.json`, merged from Foursquare, Overture, and OSM), curated on-device landmarks, Geoapify autocomplete through the backend, keyless Photon fallback, and community places joined into the same results.
- **Routing** — OpenRouteService through the backend (driving and walking, elevation) with the public OSRM demo server as keyless fallback; durations clamped to speeds a local would actually do on these roads.
- **Map** — MapLibre GL with MapTiler **vector** styles (satellite imagery by default, bright and dark street modes), 3D terrain with hillshading, building extrusions, and a globe projection when zoomed out.

## Architecture

The repository is two independent apps:

- **`app/`** — the Angular + Ionic + Capacitor client. The Gemini function-calling loop lives here, on the device, because only the device knows the GPS position and map state. The backend never executes tools; it is a stateless proxy for the conversation (`contents` + `tools` round-trip untouched, including thought signatures). Requests use `fetch` in the browser and `CapacitorHttp` on device. A small local Android plugin (`PhotoWatcherPlugin`) bridges system MediaStore events into the app.
- **`backend/`** — the FastAPI service: accounts and sessions (`/api/auth/*`), the community database (`/api/places/*`, `/api/users/*`), the Gemini chat proxy (`/api/chat`), Fish Audio TTS with an MP3 cache (`/api/tts`), and the geo providers (weather, geocoding, directions, the local POI index). Place photos are served from `/uploads` — swap `routers/places.py` to Cloudinary and the URLs keep working.

**Keys never ship in the client.** Gemini, Fish Audio, OpenRouteService, OpenWeatherMap, and Geoapify keys live only in `backend/.env`. The single exception is the MapTiler map key, which is public by design (map-rendering keys are meant for clients; restrict it to your domains in the MapTiler dashboard).

**Storage.** The POI index is a committed JSON file. Community data (accounts, places, photos, comments, ratings, votes, visits) lives in a SQL database through SQLAlchemy: SQLite in development (`backend/data/navbudol.db`), and any `DATABASE_URL` (e.g. a free Postgres) in deployment — the schema is portable. Session tokens are opaque server-side records (revocable, no JWT secrets). Place photos are stored on local disk and served from `/uploads`; the Cloudinary swap is a single function.

## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | Angular 22.1.7, Ionic Angular 9, Capacitor 8.5.2, MapLibre GL 5, TypeScript 6.0, RxJS 7.8 |
| Native | Capacitor Android, `@capacitor-community/speech-recognition` 7.0.1, Capacitor Geolocation + Camera, local `PhotoWatcherPlugin` (MediaStore) |
| Tooling | Angular CLI 22.1.8, ESLint 10 + angular-eslint, Vitest 4 |
| Backend | Python, FastAPI ≥ 0.115, Uvicorn ≥ 0.30, SQLAlchemy ≥ 2.0, bcrypt, httpx ≥ 0.27 |
| AI | Google Gemini (default model `gemini-3.5-flash-lite`) for chat + tool calls, Fish Audio for character voices |
| Geo | MapTiler vector styles + terrain, OpenRouteService, OpenWeatherMap, Geoapify, plus keyless OSRM / Photon / Overpass fallbacks |

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
DATABASE_URL      # optional — defaults to the local SQLite file
```

`backend/api_flow_check.py` runs a full end-to-end pass over the community API (accounts, geofenced place creation, verified visits, ratings, votes, gallery curation) against a running server:

```powershell
.\venv\Scripts\python.exe api_flow_check.py
```

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

Open `http://localhost:8300` — you'll land on sign-in; create an account and the map is yours. Keep the backend running alongside it.

### Android

From `app/`, with the local Node runtime still on your PATH:

```powershell
npx ng build --configuration production
npx cap sync android
npx cap open android
```

The production client points at the deployed backend, so no `adb reverse` is needed. The debug APK lands at `app/android/app/build/outputs/apk/debug/app-debug.apk`.

## Deployment

A [Render Blueprint](render.yaml) at the repository root deploys the backend as a free Render Python web service: **Root Directory** `backend`, build command `pip install -r requirements.txt`, start command `uvicorn main:app --host 0.0.0.0 --port $PORT`, and health check path `/api/health`. Secret environment variables are declared with `sync: false` — set their values in the Render dashboard. The deployed backend for this build lives at `https://navbudol-backend.onrender.com` (health probe: `/api/health`), and the production client (`environment.prod.ts`) points at it.

Two deployment notes: **set `DATABASE_URL` to a hosted Postgres** (free tiers exist on Supabase/Neon) — Render's free disk is ephemeral and would wipe the community data on every redeploy — and remember the backend is a coursework demo proxy with permissive CORS.

## Project structure

```
app/                              Angular + Ionic + Capacitor client
  src/app/map/                    Map tab: MapLibre map, search bar, chat sheet,
                                  nav banner, route preview, photo prompt card
  src/app/add-place/              Full add-place flow (GPS-gated) with icon picker
  src/app/place/                  Place page: gallery, ratings, votes, comments
  src/app/profile/                Public contributor profile (+ own profile editing)
  src/app/auth/                   Sign in / create account
  src/app/chat/                   Full-page conversation tab (shares state with the map)
  src/app/settings/               Dark mode, satellite, travel profile, simulation
  src/app/character-select/       Pick your AI co-pilot
  src/app/core/services/          Gemini function-calling loop, navigation engine +
                                  voice alerts, routing, community places, auth,
                                  speech recognition, TTS, simulation, photo watcher
  src/app/core/constants/         Character roster, curated landmarks, icon library,
                                  system prompt
  src/environments/               Backend URL, map config, navigation thresholds
  android/.../PhotoWatcherPlugin  Local native plugin: MediaStore photo detection
backend/                          FastAPI service
  main.py                         App wiring + GET /api/health + /uploads static
  routers/                        users (auth/profiles), places (community data),
                                  chat, tts, geo (weather/geocode/directions/localpois)
  services/                       gemini_client, fish_client (stateless proxies)
  db.py                           SQLAlchemy schema: users, sessions, places, photos,
                                  comments, ratings, votes, visits
  api_flow_check.py               End-to-end community API verification
  data/places_final.json          Committed POI dataset served by GET /api/localpois
  data/navbudol.db                SQLite community database (dev)
render.yaml                       Render Blueprint for the backend
```
