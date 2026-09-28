# 🏴‍☠️ NavBudol

A voice-conversational AI navigation app for **General Tinio (Papaya), Nueva Ecija** —
Waze-style live navigation, an AI co-pilot that controls the map, and a cast of
anime characters with real Fish Audio voices. Apple-clean design throughout.

> Full blueprint: [NAVBUDOL_PLAN.md](./NAVBUDOL_PLAN.md)
> Community layer (design, not built yet): [COMMUNITY_REPORTS_PLAN.md](./COMMUNITY_REPORTS_PLAN.md)

## Layout

```
navbudol/
├── NAVBUDOL_PLAN.md      the full plan (architecture, phases, API cheatsheets)
├── COMMUNITY_REPORTS_PLAN.md   the community layer — places, reports, trust, AI reasoning
├── assets/characters/    original copies — portraits + voices.json (Fish Audio voice IDs)
├── backend/              FastAPI proxies — ALL keys live here (gitignored .env):
│                         /api/chat (Gemini 3.5 Flash Lite)  /api/tts (Fish Audio + MP3 cache)
│                         /api/weather (OWM)  /api/geocode + /api/reverse (Geoapify)
│                         /api/directions + /api/isochrone (OpenRouteService)
└── app/                  Ionic 8 + Angular (NgModule) + Capacitor 8 + Leaflet
    └── android/          Capacitor Android project
```

## What's inside

- **Map**: MapTiler raster tiles @2x retina (light / dark / satellite toggle) on Leaflet
- **Routing**: OpenRouteService (walking + elevation!) with OSRM fallback — "ORS" badge on the preview card
- **Search**: Geoapify autocomplete via backend, Photon fallback
- **AI**: Gemini 3.5 Flash Lite with function calling — it searches places, plots routes, starts/stops navigation, reads trip status, and reports the weather
- **Voice**: Fish Audio voices (7 anime cast members, real voice IDs) + system-TTS fallback; MP3 cache on the backend
- **Isochrones**: the 10′ button draws a 10-minute walking range around you
- **Community locations**: anyone can drop a pin, name it, and it shows up in
  everyone's search (shared index in the backend, 20 km General Tinio fence).
- **Community reports**: anyone can report what's happening at a spot — floods,
  checkpoints, hazards, fares — with an expiry per kind. Others confirm (stamped
  with how close they were) or dispute; the AI reads the reports near you or on
  your route and mentions them, and routes around the presence-confirmed ones.
  Tap a report pin to confirm, dispute, or retire it. Design notes:
  [COMMUNITY_REPORTS_PLAN.md](./COMMUNITY_REPORTS_PLAN.md)

## Run it

### 1. Backend (one terminal)

```bash
cd backend
python -m venv venv                      # once
venv/Scripts/pip install -r requirements.txt   # once

# paste your keys into backend/.env:
#   GEMINI_API_KEY=...   ← AI Studio (confirm the exact model id there too)
#   FISH_API_KEY=...
venv/Scripts/python -m uvicorn main:app --port 8010
```

Check: `curl http://localhost:8010/api/health` → `{"ok":true, ...}`
(`gemini_key_set` / `fish_key_set` stay `false` until real keys are in `.env`.)

### 2. App in the browser (second terminal)

```bash
cd app
npm install          # once
npx ng serve --port 8300
```

Open http://localhost:8300 → Map tab. Search "Minalungao" → route preview → Start.
(Chrome grants location; without it the map centers on Gen. Tinio Poblacion.)

> Note: port 8100 on this machine is occupied by another dev server — use 8300.

### 3. Android

```bash
cd app
npx ng build --configuration production
npx cap sync android
npx cap open android         # → Build APK in Android Studio
```

Phone connected by USB? Route the app to the laptop's backend with **no WiFi needed**:

```bash
adb reverse tcp:8010 tcp:8010
```

The app talks to `http://localhost:8010` on both browser and device thanks to that
reverse (or `10.0.2.2` on an emulator). Debug APK lands in
`app/android/app/build/outputs/apk/debug/app-debug.apk`.

## The cast

NavBuddy (default, system voice for now) + **Gojo, Makima, Marin, Toji, Miku,
Reze, Horikita** — all with working Fish Audio voice IDs from
`app/src/assets/characters/voices.json`. Makima's clips play with +16 dB gain
(her raw output is quiet). Preview them in Settings → Character.

## Demo-day checklist

1. `uvicorn main:app --port 8010` (backend)
2. `adb reverse tcp:8010 tcp:8010` (USB to phone)
3. Settings → Developer → **Simulated Walk ON** (indoor demo)
4. Pick Gojo 🍿 — say *"Gojo, take me to the municipal hall"*
