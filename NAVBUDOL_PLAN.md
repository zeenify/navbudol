# 🏴‍☠️ NAVBUDOL — The Full Blueprint

> **A voice-conversational AI navigation app where you pick a character,
> talk to it, and it navigates you — with personality.**
>
> Think Waze × Jarvis × VTuber energy.

---

## Table of Contents

- [1. What We're Building](#1-what-were-building)
- [2. Why This Will Shock the Professor](#2-why-this-will-shock-the-professor)
- [3. Final Decisions](#3-final-decisions)
- [4. Tech Stack](#4-tech-stack)
- [5. Architecture](#5-architecture)
- [6. Project File Structure](#6-project-file-structure)
- [7. Feature Deep Dives](#7-feature-deep-dives)
  - [7.1 Map & GPS](#71-map--gps)
  - [7.2 Search & Geocoding](#72-search--geocoding)
  - [7.3 Routing & Polyline](#73-routing--polyline)
  - [7.4 Live Navigation Engine (Option C)](#74-live-navigation-engine-option-c)
  - [7.5 AI Chatbot (Gemini via Backend)](#75-ai-chatbot-gemini-via-backend)
  - [7.6 Voice — STT](#76-voice--stt)
  - [7.7 Voice — TTS (Fish Audio)](#77-voice--tts-fish-audio)
  - [7.8 Voice Assistant Orchestrator](#78-voice-assistant-orchestrator)
  - [7.9 Character System](#79-character-system)
  - [7.10 Simulated Walk Mode](#710-simulated-walk-mode)
  - [7.11 UI / Screens](#711-ui--screens)
- [8. API Reference Cheat Sheet](#8-api-reference-cheat-sheet)
- [9. System Prompt Engineering](#9-system-prompt-engineering)
- [10. Implementation Phases](#10-implementation-phases)
- [11. Environment & Config](#11-environment--config)
- [12. Android Build Checklist](#12-android-build-checklist)
- [13. Risks & Mitigations](#13-risks--mitigations)
- [14. Demo Day Script](#14-demo-day-script)
- [15. What to Say When the Professor Asks Questions](#15-what-to-say-when-the-professor-asks-questions)
- [16. Community Layer — Places & Reports](#16-community-layer--places--reports)

---

## 1. What We're Building

NavBudol is a mobile navigation app **scoped to General Tinio (Papaya),
Nueva Ecija** — covering the Poblacion area and surrounding barangays.
It has three layers:

```
Layer 1: NAVIGATE
  Full Waze-style navigation — live GPS, route polyline,
  turn-by-turn instructions, auto-rerouting, arrival detection.
  Scoped to General Tinio, Nueva Ecija (Poblacion and nearby barangays).

Layer 2: TALK
  AI chatbot powered by Gemini that UNDERSTANDS your location.
  "Where's the municipal hall?" — it knows where you are
  and can set the destination for you.

Layer 3: PERSONALITY
  Pick a character. Each one has a different Fish Audio voice
  and AI personality. Gojo does NOT talk like Makima.
  The AI's system prompt changes, the voice changes, everything.
```

```
TARGET AREA: General Tinio (Papaya), Nueva Ecija
  Center:     ~15.3519°N, 121.0633°E (Poblacion)
  Coverage:   13 barangays — Poblacion Central, Poblacion East,
              Poblacion West, San Pedro, Concepcion, Padolina,
              Bago, Nazareth, Pias, Pulong Matong, Rio Chico,
              Sampaguita, and surrounding areas.
  Size:       Municipality-wide roads, but demo focuses on
              Poblacion area (~2-5 km radius from town center).
  Key landmarks: Municipal Hall, Holy Cross Parish Church,
              Sto. Cristo Parish Church, General Tinio Central School,
              NEUST Gen. Tinio Campus, Minalungao National Park,
              Maria's Kitchen, On The Woods Diner, local sari-sari stores.
```

Nobody in class is building anything close to this.

---

## 2. Why This Will Shock the Professor

| What others will do | What we're doing |
|---|---|
| Map with a pin | Full Waze-style live navigation with rerouting |
| Basic TTS reading coordinates | Fish Audio natural voices with selectable characters |
| No interactivity | Full voice conversation — talk to the app, it talks back |
| Static | Real-time GPS tracking with simulated walk for demo |
| One trick | AI that controls the map — say "take me to the municipal hall" and it routes |
| Boring | Character system with personality — NavBuddy, Gojo, Makima & co. |
| Covers the whole PH | Scoped to General Tinio (Papaya), Nueva Ecija — focused, practical |

The professor asked for geolocation + TTS.
We're delivering a voice-first AI navigation companion with character selection,
scoped to a real municipality — General Tinio (Papaya), Nueva Ecija.

---

## 3. Final Decisions

| Decision | Answer |
|---|---|
| **App name** | NavBudol 🤣 |
| **Navigation approach** | Option C — Full Waze simulation (max flex) |
| **Target platforms** | Android APK + Browser (dual) |
| **Simulated walk** | Yes — for indoor demo |
| **Languages** | English |
| **AI model** | Gemini 3.5 Flash Lite (AI Studio API key — free tier) |
| **TTS** | Fish Audio — 7 anime voice IDs ready (from Cognify); NavBuddy's voice left empty for now (system TTS) |
| **STT** | Native plugin on device, Web Speech API in browser |
| **Backend** | Python FastAPI, local — Gemini proxy + TTS proxy with MP3 cache |
| **Routing** | OSRM + OpenRouteService as fallback |
| **Place search** | Photon (geocoding) + Overpass (POI "nearest X") |
| **Community layer** | Places + expiring reports on places and roads, presence-weighted confirms, AI reasons over them. Implemented at case-study scope — see [COMMUNITY_REPORTS_PLAN.md](./COMMUNITY_REPORTS_PLAN.md) |
| **Map** | Leaflet + OpenStreetMap tiles |
| **Total cost** | $0 |

---

## 4. Tech Stack

### Dependencies to Install

```
App — npm (Phase 0 scaffold):
  leaflet, @types/leaflet, @capacitor/geolocation
  @capacitor-community/speech-recognition   ← native STT (Phase 5)
  (no other npm packages — geo APIs are plain HTTP via CapacitorHttp;
   AI + TTS calls go to our backend, not to Gemini/Fish directly)

Backend — pip (Phase 0):
  fastapi, uvicorn[standard], httpx, python-dotenv
```

### Full Stack Table

| Layer | Tool | Notes |
|---|---|---|
| **App framework** | Ionic 8 + Angular (NgModule) | Already scaffolded |
| **Native bridge** | Capacitor 8 | Already configured |
| **Map rendering** | Leaflet.js | Install in Phase 0 |
| **Map tiles** | OpenStreetMap (light) + CartoDB (dark) | Free, no key |
| **GPS** | `@capacitor/geolocation` | Install in Phase 0 |
| **Routing** | OSRM demo server | Free, no key — Phase 2 |
| **Place search** | Photon (komoot.io) | Free, no key — Phase 2 |
| **POI search** | Overpass API | Free, no key — Phase 2 |
| **AI chat** | Gemini 3.5 Flash Lite via our FastAPI backend | Key lives in backend/.env only |
| **TTS** | Fish Audio via FastAPI backend | MP3 cache for repeated phrases |
| **STT** | `@capacitor-community/speech-recognition` | Native Android/iOS, Web Speech fallback |
| **Backend** | Python 3 + FastAPI + uvicorn | Local: /api/chat, /api/tts, /api/health |
| **HTTP client** | `CapacitorHttp` (built into @capacitor/core) | Bypasses CORS on device |
| **State management** | RxJS BehaviorSubjects + Angular services | No extra library needed |
| **Storage** | localStorage / Capacitor Preferences | Character selection, saved places |

### Why This Stack

- **₱0 total** — no credit cards, no billing accounts
- **Keys stay server-side** — Gemini + Fish Audio keys live in `backend/.env`, never inside the APK. Map, routing, geocoding and POI need no keys at all
- **The backend is a bodyguard, not a monolith** — ~150 lines of FastAPI: a secure proxy plus an MP3 cache
- **OSRM + Photon + Overpass** are all OpenStreetMap ecosystem — they work together seamlessly
- **CapacitorHttp** means zero CORS headaches on the actual device
- Mentioning "OpenStreetMap ecosystem" in the demo is actually MORE impressive than saying "Google Maps" — it shows you understand open-source infrastructure

---

## 5. Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    NAVBUDOL APP                          │
│               (Ionic + Angular + Capacitor)              │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │              UI LAYER                            │    │
│  │  ┌──────────┐ ┌───────────┐ ┌────────────────┐  │    │
│  │  │ Map Page │ │Chat Sheet │ │Character Select│  │    │
│  │  │(Leaflet) │ │(Slide-up) │ │   (Grid)       │  │    │
│  │  └─────┬────┘ └─────┬─────┘ └───────┬────────┘  │    │
│  └────────┼─────────────┼───────────────┼───────────┘    │
│           │             │               │                │
│  ┌────────┴─────────────┴───────────────┴───────────┐    │
│  │           SERVICE LAYER (Singletons)              │    │
│  │                                                   │    │
│  │  ┌──────────────┐  ┌──────────────────────────┐   │    │
│  │  │ LocationSvc  │  │ VoiceAssistantSvc        │   │    │
│  │  │ · GPS watch  │  │ · orchestrates full loop │   │    │
│  │  │ · simulation │  │ · STT → Gemini → TTS     │   │    │
│  │  │   override   │  │                          │   │    │
│  │  └──────┬───────┘  └──┬──────────┬────────┬───┘   │    │
│  │         │             │          │        │       │    │
│  │  ┌──────┴───────┐  ┌──┴────┐ ┌───┴──┐ ┌──┴────┐  │    │
│  │  │NavigationSvc │  │Gemini │ │ STT  │ │ TTS   │  │    │
│  │  │· state:      │  │Service│ │Svc   │ │Svc    │  │    │
│  │  │  idle→       │  │· chat │ │·native│ │·Fish  │  │    │
│  │  │  preview→    │  │· func │ │ plugin│ │ Audio │  │    │
│  │  │  navigating→ │  │  call │ │·Web   │ │·queue │  │    │
│  │  │  rerouting→  │  │· ctx  │ │ Speech│ │·play  │  │    │
│  │  │  arrived     │  │  build│ │ fback │ │       │  │    │
│  │  └──────────────┘  └──┬────┘ └──────┘ └───────┘  │    │
│  │                       │                           │    │
│  │  ┌──────────────┐  ┌──┴──────────┐                │    │
│  │  │ RoutingSvc   │  │CharacterSvc │                │    │
│  │  │ · OSRM API   │  │· selection  │                │    │
│  │  │ · polyline   │  │· personality│                │    │
│  │  │ · steps      │  │· voice ID   │                │    │
│  │  └──────────────┘  └─────────────┘                │    │
│  │                                                   │    │
│  │  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │ PlacesSvc    │  │SimulationSvc │               │    │
│  │  │ · Photon     │  │· fake GPS    │               │    │
│  │  │ · Overpass   │  │· walk route  │               │    │
│  │  └──────────────┘  └──────────────┘               │    │
│  └───────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
    ─────┼────────────────────┼────────────────────┼─────
         ▼                    ▼                    ▼
    ┌─────────┐       ┌─────────────┐       ┌───────────┐
    │ Device  │       │ Map / Route │       │ BACKEND   │
    │ · GPS   │       │ · OSM tiles │       │ (FastAPI, │
    │ · Mic   │       │ · OSRM      │       │  local)   │
    │ ·Speaker│       │ · Photon    │       │ · /chat   │
    └─────────┘       │ · Overpass  │       │ · /tts    │
                      └─────────────┘       │ · cache   │
                                            └─────┬─────┘
                                                  ▼
                                          ┌──────────────┐
                                          │ Gemini 3.5   │
                                          │ Fish Audio   │
                                          │ (keys in.env)│
                                          └──────────────┘
```

### The Voice Loop (Core Innovation)

This is the heartbeat of the app. Everything connects through this loop:

```
    ┌──────────────────────────────────────────────────┐
    │                                                  │
    │    User taps 🎙️                                  │
    │         │                                        │
    │         ▼                                        │
    │    ┌─────────┐                                   │
    │    │   STT   │  Native speech recognition        │
    │    │         │  Shows partial text in real-time   │
    │    └────┬────┘                                   │
    │         │ "where's the municipal hall?"           │
    │         ▼                                        │
    │    ┌──────────────────────┐                      │
    │    │   CONTEXT BUILDER    │                      │
    │    │                      │                      │
    │    │ Attaches to prompt:  │                      │
    │    │ · GPS: 15.35, 121.06 │                      │
    │    │ · Addr: "Poblacion,  │                      │
    │    │   Gen. Tinio, NE"    │                      │
    │    │ · Nav: heading to X  │                      │
    │    │ · Char: Gojo         │                      │
    │    └────────┬─────────────┘                      │
    │             │                                    │
    │             ▼                                    │
    │    ┌──────────────────────┐                      │
    │    │  BACKEND /api/chat   │                      │
    │    │ via Gemini 3.5 Flash │                      │
    │    │ Processes with:      │                      │
    │    │ · Character persona  │                      │
    │    │ · Location context   │                      │
    │    │ · Function calling   │                      │
    │    └────────┬─────────────┘                      │
    │             │                                    │
    │             ▼                                    │
    │    Response: "Ay apo, ang Municipal Hall nasa       │
    │    Poblacion Central! 500 meters lang. Punta na tayo?"│
    │    + function_call: search_places("Municipal Hall    │
    │      General Tinio")                                 │
    │             │                                    │
    │        ┌────┴────────┐                           │
    │        ▼             ▼                           │
    │   ┌─────────┐  ┌──────────┐                     │
    │   │FUNCTION │  │CACHED TTS│                      │
    │   │EXECUTOR │  │   TTS    │                      │
    │   │         │  │          │                      │
    │   │Overpass │  │Character │                      │
    │   │search → │  │voice ID →│                      │
    │   │results  │  │audio blob│                      │
    │   │on map   │  │→ play 🔊 │                      │
    │   └─────────┘  └──────────┘                     │
    │                                                  │
    └──────────────────────────────────────────────────┘
```

> **Transport note:** all AI + TTS calls route through the FastAPI backend
> (`/api/chat`, `/api/tts`) — keys stay server-side, TTS clips are cached.
> Geo APIs (OSRM, Photon, Overpass, Nominatim) stay direct from the device.

### Navigation State Machine (Option C)

```
                    ┌──────┐
                    │ IDLE │ ← app start / nav cancelled
                    └──┬───┘
                       │ user picks destination
                       │ (search bar, voice, or chat)
                       ▼
                  ┌─────────┐
                  │ PREVIEW │ ← route shown, not tracking yet
                  └────┬────┘
                       │ user says "start" or taps "Go"
                       ▼
                 ┌────────────┐
          ┌─────►│ NAVIGATING │◄──────────────────┐
          │      └─────┬──────┘                    │
          │            │                           │
          │      GPS updates every 1-3s            │
          │            │                           │
          │      ┌─────┴─────┐                     │
          │      │           │                     │
          │  on route?   off route?                │
          │      │        (>50m from polyline)      │
          │      │           │                     │
          │      ▼           ▼                     │
          │  advance     ┌──────────┐              │
          │  instruction │REROUTING │──► new route ─┘
          │  if passed   └──────────┘
          │      │
          │      │ distance to next turn < threshold?
          │      │
          │      ├── < 200m → voice: "In 200 meters, turn right"
          │      ├── < 50m  → voice: "Turn right now"
          │      ├── < 20m  → advance to next step
          │      │
          │      │ reached final destination? (< 30m)
          │      │
          │      ▼
          │  ┌─────────┐
          └──│ ARRIVED  │ → voice: "You have arrived!"
             └─────────┘   → state resets to IDLE
```

---

## 6. Project File Structure

Fresh start — the old attempt is abandoned, we scaffold from zero in
Phase 0. Legend: ⬜ NEW = we author it, ✅ EXISTS = generated by the Phase 0
scaffold (then modified by us).

```
navbudol/
├── NAVBUDOL_PLAN.md                 ✅ EXISTS (this file)
│
├── assets/
│   └── characters/                  ✅ EXISTS (copied from Cognify:
│                                    8 portraits + voices.json holding
│                                    the 7 Fish Audio voice IDs — moves
│                                    to app/src/assets/characters/ in Phase 0)
│
├── backend/                         ⬜ NEW (Phase 0) — Python FastAPI
│   ├── main.py                      ⬜ — FastAPI app: CORS, routers, /api/health
│   ├── routers/
│   │   ├── chat.py                  ⬜ — POST /api/chat → Gemini 3.5 Flash Lite
│   │   └── tts.py                   ⬜ — POST /api/tts → Fish Audio + MP3 cache
│   ├── services/
│   │   ├── gemini_client.py         ⬜ — httpx → AI Studio, normalize response
│   │   └── fish_client.py           ⬜ — httpx → Fish Audio + sha1 MP3 cache
│   ├── cache/                       ⬜ — cached .mp3 files (gitignored)
│   ├── requirements.txt             ⬜ — fastapi, uvicorn, httpx, python-dotenv
│   └── .env.example                 ⬜ — GEMINI_API_KEY= / FISH_API_KEY=
│
└── app/                             ⬜ NEW (Phase 0 — fresh `ionic start` scaffold)
    ├── src/
    │   ├── app/
    │   │   ├── app.module.ts        ✅ EXISTS
    │   │   ├── app.component.ts     ✅ EXISTS
    │   │   ├── app-routing.module.ts ✅ EXISTS (needs rewiring)
    │   │   │
    │   │   ├── core/
    │   │   │   ├── models.ts                  ⬜ NEW — Character, NavState, RouteStep
    │   │   │   ├── geo.utils.ts               ⬜ NEW — haversine, interpolate, bearing
    │   │   │   │
    │   │   │   ├── services/
    │   │   │   │   ├── location.service.ts    ⬜ NEW — GPS watch + simulation override
    │   │   │   │   ├── places.service.ts      ⬜ NEW — Photon search + Overpass POI
    │   │   │   │   ├── routing.service.ts     ⬜ NEW — OSRM route + step parsing
    │   │   │   │   ├── navigation.service.ts  ⬜ NEW — state machine + turn monitor
    │   │   │   │   ├── simulation.service.ts  ⬜ NEW — fake GPS walk along route
    │   │   │   │   ├── gemini.service.ts      ⬜ NEW — chat via backend + function calling
    │   │   │   │   ├── speech.service.ts      ⬜ NEW — STT (native + web fallback)
    │   │   │   │   ├── tts.service.ts         ⬜ NEW — Fish Audio + browser fallback
    │   │   │   │   ├── voice-assistant.service.ts ⬜ NEW — STT→AI→TTS orchestrator
    │   │   │   │   ├── character.service.ts   ⬜ NEW — character state + selection
    │   │   │   │   └── saved-places.service.ts ⬜ NEW — localStorage favorites
    │   │   │   │
    │   │   │   └── constants/
    │   │   │       ├── characters.ts          ⬜ NEW — character definitions array
    │   │   │       └── prompts.ts             ⬜ NEW — system prompt templates
    │   │   │
    │   │   ├── map/                           ⬜ NEW — main map page
    │   │   │   ├── map.module.ts
    │   │   │   ├── map.page.ts
    │   │   │   ├── map.page.html
    │   │   │   ├── map.page.scss
    │   │   │   └── components/
    │   │   │       ├── search-bar/            ⬜ NEW — Photon autocomplete search
    │   │   │       │   ├── search-bar.component.ts
    │   │   │       │   ├── search-bar.component.html
    │   │   │       │   └── search-bar.component.scss
    │   │   │       ├── nav-banner/            ⬜ NEW — current turn instruction
    │   │   │       │   ├── nav-banner.component.ts
    │   │   │       │   ├── nav-banner.component.html
    │   │   │       │   └── nav-banner.component.scss
    │   │   │       ├── route-preview/         ⬜ NEW — distance/ETA before "Go"
    │   │   │       │   ├── route-preview.component.ts
    │   │   │       │   ├── route-preview.component.html
    │   │   │       │   └── route-preview.component.scss
    │   │   │       └── mic-fab/               ⬜ NEW — floating mic button
    │   │   │           ├── mic-fab.component.ts
    │   │   │           ├── mic-fab.component.html
    │   │   │           └── mic-fab.component.scss
    │   │   │
    │   │   ├── assistant/                     ⬜ NEW — chat bottom sheet
    │   │   │   ├── assistant.component.ts
    │   │   │   ├── assistant.component.html
    │   │   │   ├── assistant.component.scss
    │   │   │   └── components/
    │   │   │       ├── message-bubble/        ⬜ NEW
    │   │   │       └── typing-indicator/      ⬜ NEW
    │   │   │
    │   │   ├── character-select/              ⬜ NEW — character picker page
    │   │   │   ├── character-select.module.ts
    │   │   │   ├── character-select.page.ts
    │   │   │   ├── character-select.page.html
    │   │   │   └── character-select.page.scss
    │   │   │
    │   │   ├── settings/                      ⬜ NEW — settings page
    │   │   │   ├── settings.module.ts
    │   │   │   ├── settings.page.ts
    │   │   │   ├── settings.page.html
    │   │   │   └── settings.page.scss
    │   │   │
    │   │   ├── tabs/                          ✅ EXISTS — rewire to our pages
    │   │   ├── tab1/                          ✅ EXISTS — DELETE (starter junk)
    │   │   ├── tab2/                          ✅ EXISTS — DELETE
    │   │   ├── tab3/                          ✅ EXISTS — DELETE
    │   │   └── explore-container/             ✅ EXISTS — DELETE
    │   │
    │   ├── environments/
    │   │   ├── environment.ts                 ✅ EXISTS — update with new fields
    │   │   └── environment.prod.ts            ✅ EXISTS — mirror
    │   │
    │   ├── assets/
    │   │   ├── markers/                       ⬜ NEW
    │   │   │   ├── user-dot.svg               ← animated blue GPS dot
    │   │   │   ├── destination-pin.svg        ← red destination marker
    │   │   │   └── heading-arrow.svg          ← direction arrow overlay
    │   │   ├── characters/                    ⬜ NEW (moved from workspace root)
    │   │   │   └── gojo.jpg, makima.jpg, marin.jpg, ... + voices.json
    │   │   └── sounds/                        ⬜ NEW
    │   │       ├── nav-start.mp3
    │   │       └── arrived.mp3
    │   │
    │   └── theme/
    │       └── variables.scss                 ✅ EXISTS — add dark mode vars
    │
    ├── android/                               (generated by `npx cap add android`)
    ├── capacitor.config.ts                    ✅ EXISTS
    ├── angular.json                           ✅ EXISTS
    ├── package.json                           ✅ EXISTS
    └── ionic.config.json                      ✅ EXISTS
```

---

## 7. Feature Deep Dives

### 7.1 Map & GPS

**What we build:** `LocationService` — wraps `@capacitor/geolocation`, provides
`position$` BehaviorSubject and `watchPosition`.

**What we need to add:**

A Leaflet map initialized on the map page with:
- OSM tiles (light mode) + CartoDB Dark tiles (dark mode toggle)
- User position marker: animated pulsing blue dot (CSS animation)
- Heading arrow overlay showing direction of travel
- Map auto-pans to follow user during active navigation
- "Recenter" button if user manually pans away
- Tap-on-map to drop a pin and route to it

**Map init pseudocode:**
```
onPageLoad:
  map = L.map('map-container', { zoomControl: false })
  tileLayer = L.tileLayer(OSM_URL, { attribution, maxZoom: 19 })
  tileLayer.addTo(map)

  // Get initial position (default to Gen. Tinio Poblacion if GPS not ready)
  pos = await locationService.getCurrentPosition()
  map.setView([pos.lat, pos.lng], 16)

  // Create user marker (custom divIcon with CSS animation)
  userMarker = L.marker([pos.lat, pos.lng], {
    icon: L.divIcon({ className: 'user-dot-pulse', iconSize: [20, 20] })
  }).addTo(map)

  // Subscribe to GPS updates
  locationService.position$.subscribe(pos => {
    userMarker.setLatLng([pos.lat, pos.lng])
    if (isNavigating && followMode) {
      map.panTo([pos.lat, pos.lng], { animate: true })
    }
  })
```

**CSS for pulsing dot:**
```css
.user-dot-pulse {
  width: 20px;
  height: 20px;
  background: #4285F4;
  border: 3px solid white;
  border-radius: 50%;
  box-shadow: 0 0 0 rgba(66, 133, 244, 0.4);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0.4); }
  70% { box-shadow: 0 0 0 15px rgba(66, 133, 244, 0); }
  100% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0); }
}
```

**Dark mode tiles:**
```
Light: https://tile.openstreetmap.org/{z}/{x}/{y}.png
Dark:  https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png
```

---

### 7.2 Search & Geocoding

**What we build:** `PlacesService` — Photon for text search, Overpass for
nearby POI queries. (Built in Phase 2.)

**What we build on top:**

A search bar component with:
- `ion-searchbar` at top of map page
- Debounced input (400ms) → call `placesService.search(query, userPos)`
- Results shown in a dropdown `ion-list` overlaying the map
- On result tap → place destination marker → fetch route → show preview
- Clear/cancel button
- Recent searches stored in localStorage

**Reverse geocoding** for the AI context builder:
- Photon doesn't have reverse geocoding, so we use Nominatim for this
- `GET https://nominatim.openstreetmap.org/reverse?lat=X&lon=Y&format=json`
- Rate limit: 1 req/sec — only call when context needs refresh (not every GPS tick)
- Cache the last result, only re-fetch if user moved >200m since last reverse geocode

---

### 7.3 Routing & Polyline

**What we build:** `RoutingService` — OSRM routing with full instruction
parsing. Returns `RouteResult` with decoded geometry + `RouteStep[]`. (Phase 2.)

**What we build on top:**

When a route is fetched:
1. Draw polyline on map: `L.polyline(route.geometry, { color: '#4A89F3', weight: 5 })`
2. Place destination marker at endpoint
3. `map.fitBounds(polyline.getBounds(), { padding: [50, 50] })`
4. Show route preview card (distance, ETA, destination name)
5. "Go" button → starts navigation engine
6. "Cancel" → clears everything

**Polyline styling:**
```
Active route:   color #4A89F3, weight 6, opacity 1.0
Completed part: color #4A89F3, weight 6, opacity 0.3 (behind user)
```

---

### 7.4 Live Navigation Engine (Option C)

**This is the most complex service.** It's a state machine that turns
raw GPS updates into a real-time navigation experience.

#### Service: `navigation.service.ts`

```
Properties:
  navState$: BehaviorSubject<NavState>     ← UI subscribes to this
  currentStep$: Observable<RouteStep>      ← current instruction
  alerts$: Subject<string>                 ← voice alert triggers

Methods:
  previewRoute(route: RouteResult): void
    → state = PREVIEW, store route, show on map

  startNavigation(): void
    → state = NAVIGATING, subscribe to GPS, begin tracking

  stopNavigation(): void
    → state = IDLE, unsubscribe GPS, clear map overlays

  onPositionUpdate(pos: LatLng): void      ← called by GPS subscription
    → core tracking logic (see below)
```

#### Core tracking logic (runs every GPS update):

```
function onPositionUpdate(pos):

  // 1. Am I off-route?
  distToRoute = distanceToPolylineMeters(pos, route.geometry)
  if distToRoute > 50m:
    if offRouteCount++ > 3:      ← hysteresis: 3 consecutive off-route fixes
      state = REROUTING
      emit alert("Rerouting...")
      newRoute = await routingService.getRoute(pos, destination)
      replaceRoute(newRoute)
      state = NAVIGATING
      offRouteCount = 0
    return
  else:
    offRouteCount = 0

  // 2. How far am I from the NEXT step's maneuver point?
  nextStep = route.steps[currentStepIndex + 1]  // +1 because current step = what we're ON
  if !nextStep:
    // We're on the last step — check arrival
    distToDest = haversine(pos, destination)
    if distToDest < 30m:
      state = ARRIVED
      emit alert("You have arrived at your destination!")
      return

  distToManeuver = haversine(pos, {
    lat: nextStep.maneuverLat,
    lng: nextStep.maneuverLng
  })

  // 3. Proximity voice alerts
  if distToManeuver < 200m AND !alert200mFired:
    emit alert("In " + formatDistance(distToManeuver) + ", " + nextStep.instruction)
    alert200mFired = true

  if distToManeuver < 50m AND !alert50mFired:
    emit alert(nextStep.instruction + " now")
    alert50mFired = true

  // 4. Advance step if we passed it
  if distToManeuver < 20m:
    currentStepIndex++
    alert200mFired = false
    alert50mFired = false
    // Update remaining distance/duration
    remainingDistance -= currentStep.distance
    remainingDuration -= currentStep.duration

  // 5. Update observable state
  navState$.next({
    phase: 'navigating',
    route,
    currentStepIndex,
    remainingDistance,
    remainingDuration,
    distanceToNextManeuver: distToManeuver,
    nextInstruction: nextStep?.instruction ?? '',
    nextInstructionIcon: nextStep?.icon ?? '',
  })
```

---

### 7.5 AI Chatbot (Gemini via Backend)

#### Service: `gemini.service.ts`

This is where the magic happens. Gemini doesn't just chat — it **calls
functions** that control the app.

> **Transport:** the app never talks to Google directly. `gemini.service.ts`
> POSTs to our FastAPI backend (`/api/chat`), which holds the API key and
> returns a normalized response:
> `{ text: string | null, functionCalls: [{ name, args }] | null }`.
> The function-calling loop (execute → feed result → ask again) still runs
> on the device — only the device knows the GPS and map state.

```
Properties:
  history: ChatMessage[]                   ← conversation memory (last 20)
  character: Character                     ← current AI personality

Methods:
  chat(userText: string): Promise<GeminiResult>
    1. Build system prompt (character persona + location context)
    2. Send to Gemini API with function declarations
    3. If response has function_call → execute it → feed result back
    4. Return final text response + any actions taken

  buildSystemPrompt(): string
    → assembles character personality + live context

  buildContext(): string
    → gathers GPS, nav state, time, language
```

#### Gemini Function Calling (THE KEY DIFFERENTIATOR)

Instead of hacking `##ACTION:{}` into the text (fragile), we use Gemini's
native **function calling**. The AI decides when to call a function, and
we execute it and feed the result back.

**Function declarations sent to Gemini:**

```json
{
  "tools": [{
    "function_declarations": [
      {
        "name": "search_places",
        "description": "Search for a place by name or address. Use when user wants to go somewhere specific.",
        "parameters": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "Place name or address to search for"
            }
          },
          "required": ["query"]
        }
      },
      {
        "name": "find_nearby_places",
        "description": "Find nearby points of interest like restaurants, gas stations, ATMs, etc.",
        "parameters": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "Type of place to find (e.g. restaurant, gas station, pharmacy)"
            },
            "radius_meters": {
              "type": "number",
              "description": "Search radius in meters. Default 2000."
            }
          },
          "required": ["query"]
        }
      },
      {
        "name": "get_directions",
        "description": "Calculate a route to a destination and show it on the map.",
        "parameters": {
          "type": "object",
          "properties": {
            "place_name": {
              "type": "string",
              "description": "Name of the place to navigate to"
            }
          },
          "required": ["place_name"]
        }
      },
      {
        "name": "start_navigation",
        "description": "Begin turn-by-turn navigation on the currently previewed route.",
        "parameters": { "type": "object", "properties": {} }
      },
      {
        "name": "stop_navigation",
        "description": "Stop current navigation and return to idle.",
        "parameters": { "type": "object", "properties": {} }
      },
      {
        "name": "get_trip_status",
        "description": "Get remaining distance, ETA, and next instruction for the current trip.",
        "parameters": { "type": "object", "properties": {} }
      }
    ]
  }]
}
```

#### Function calling flow:

```
User: "Take me to the church"

→ Gemini receives message + function declarations + context
→ Gemini responds with:
    function_call: { name: "search_places", args: { query: "Holy Cross Parish Church General Tinio" } }

→ App executes: placesService.search("Holy Cross Parish Church General Tinio", userPos)
→ Results: [{ name: "Holy Cross Parish Church", lat: 15.352, lng: 121.064 }]

→ App feeds results back to Gemini as function response
→ Gemini responds with final text:
    "There's a church near you! Holy Cross Parish Church,
     just 500 meters away. Want me to take you there?"

→ User: "Yes, go"
→ Gemini: function_call: { name: "get_directions", args: { place_name: "Holy Cross Parish Church" } }
→ App: fetches route, shows on map
→ Gemini: "Naka-plot na ang route! 500 meters, mga 2 minutes.
           Sabihin mo lang 'start' pag ready ka na!"
```

**Why function calling > ##ACTION hack:**
- Gemini NATIVELY supports this — it's a first-class feature
- No fragile text parsing
- Gemini decides when a function is appropriate (won't call one if user is just chatting)
- Results feed back into the conversation naturally
- More reliable, less prompt engineering hacks

---

### 7.6 Voice — STT

#### Service: `speech.service.ts`

```
Properties:
  isListening: boolean
  partialResult$: Subject<string>          ← real-time transcription preview
  finalResult$: Subject<string>            ← completed transcription

Methods:
  requestPermissions(): Promise<boolean>
  startListening(lang: 'en-US'): Promise<void>
  stopListening(): Promise<void>

Platform strategy:
  if (Capacitor.isNativePlatform()):
    use @capacitor-community/speech-recognition
    → Native Android SpeechRecognizer (Google's engine)
  else:
    use Web Speech API (webkitSpeechRecognition)
    → works in Chrome for dev/demo

Android permissions needed:
  RECORD_AUDIO in AndroidManifest.xml
```

**Key UX detail:** While listening, show partial results in real-time
so the user can see what the app is hearing. This builds trust and
lets them correct if the STT misheard.

---

### 7.7 Voice — TTS (Fish Audio)

#### Service: `tts.service.ts`

```
Properties:
  isSpeaking: boolean
  queue: string[]                          ← pending utterances

Methods:
  speak(text: string, voiceId: string): Promise<void>
    1. POST to our backend /api/tts with text + character's voice ID
    2. Backend checks its MP3 cache (sha1 of text|voiceId)
       → hit: returns instantly, no Fish Audio call
    3. Miss → backend calls Fish Audio, caches the MP3, returns
       { audioBase64, cached }
    4. App decodes base64 → Blob → Object URL → HTMLAudioElement
    5. Apply character.gainDb via Web Audio GainNode (Makima: +16 dB)
    6. Play audio, wait for 'ended' → resolve → process next in queue

  stop(): void
    → pause current audio, clear queue

  speakWithFallback(text: string, voiceId: string): Promise<void>
    → try Fish Audio first
    → if fails (network, quota, etc.), fall back to browser speechSynthesis

Backend endpoint (the app only ever sees this — Fish key never ships in the APK):
  POST http://localhost:8000/api/tts
    (Android device: same URL via `adb reverse tcp:8000 tcp:8000`)
  Body:
    {
      "text": "Turn right onto Bonifacio Street",
      "reference_id": "<character_fish_voice_id>"
    }
  Response:
    { "audioBase64": "<mp3 bytes, base64>", "cached": true|false }

  Both platforms:
    audioBase64 → atob() → Uint8Array → Blob('audio/mpeg')
    → Object URL → Audio.play() through a GainNode set to character.gainDb

  (What the backend does on a cache miss — the raw Fish Audio call — is
   documented in §8. Cognify's proven client sent only text / reference_id /
   format: 'mp3'; start with that exact body.)
```

**Audio queue logic:**
Navigation can trigger rapid-fire alerts ("In 200 meters, turn right"
followed quickly by "Turn right now"). We queue them and play one at a
time. If the user taps the mic (starts STT), we immediately stop TTS
and clear the queue.

**Fallback:** If Fish Audio fails for any reason, use the browser's
built-in `speechSynthesis`. It sounds robotic but it works offline and
instantly. Demo-day insurance.

---

### 7.8 Voice Assistant Orchestrator

#### Service: `voice-assistant.service.ts`

This is the conductor that wires STT → Gemini → TTS together.

```
State machine:
  IDLE → LISTENING → PROCESSING → SPEAKING → IDLE

Properties:
  state$: BehaviorSubject<'idle'|'listening'|'processing'|'speaking'>

Methods:
  activate(): void
    → if SPEAKING: stop TTS, then start listening
    → if IDLE: start listening
    → state = LISTENING

  deactivate(): void
    → stop everything, state = IDLE

Flow (when user taps mic):
  1. state = LISTENING
  2. speechService.startListening()
  3. Show partial transcription in UI
  4. On final result:
     state = PROCESSING
     text = finalResult
  5. response = await geminiService.chat(text)
  6. (Gemini may call functions — those execute during chat())
  7. state = SPEAKING
  8. await ttsService.speak(response.text, character.voiceId)
  9. state = IDLE

Navigation alerts (from navigation.service.ts alerts$):
  → these bypass the chat — go straight to TTS
  → queue behind any current speech
  → use short, direct text ("Turn right in 200 meters")
```

---

### 7.9 Character System

#### Service: `character.service.ts`

```
Properties:
  characters: Character[]                  ← loaded from constants/characters.ts
  selected$: BehaviorSubject<Character>    ← current character
  selectedId: string                       ← persisted in localStorage

Methods:
  getAll(): Character[]
  select(id: string): void                 ← updates selected$, saves to localStorage
  getSelected(): Character

Model:
  interface Character {
    id: string
    name: string             // display name ("Gojo")
    fullName: string         // "Gojo Satoru" — goes into the prompt
    series: string           // "Jujutsu Kaisen" — goes into the prompt
    avatar: string           // asset path
    fishVoiceId: string      // Fish Audio reference_id
    gainDb: number           // playback volume correction (0 for most)
    tagline: string          // one-line vibe for the picker card
    greeting: string         // first chat message
    isDefault?: boolean      // NavBuddy only
  }
```

#### The Roster (voice IDs are REAL — lifted from Cognify's Fish Audio setup)

Portraits + `voices.json` already sit in `assets/characters/` at the
workspace root — they move to `app/src/assets/characters/` in Phase 0.

```typescript
// core/constants/characters.ts

export const CHARACTERS: Character[] = [
  {
    id: 'buddy',
    name: 'NavBuddy',
    fullName: 'NavBuddy',
    series: '',
    avatar: 'assets/characters/buddy.png',
    fishVoiceId: '', // left empty for now — NavBuddy uses system TTS fallback
    gainDb: 0,
    tagline: 'Chill co-pilot — our own character',
    greeting: "Yo! I'm NavBuddy. Where are we going today?",
    isDefault: true,
  },
  {
    id: 'gojo',
    name: 'Gojo',
    fullName: 'Gojo Satoru',
    series: 'Jujutsu Kaisen',
    avatar: 'assets/characters/gojo.jpg',
    fishVoiceId: 'c85fb11f91f84312a4bd16756f298ae2', // 601 likes on fish.audio
    gainDb: 0,
    tagline: 'Confident, playful, teasing',
    greeting: 'Yo~ The strongest navigator has arrived. Where to?',
  },
  {
    id: 'makima',
    name: 'Makima',
    fullName: 'Makima',
    series: 'Chainsaw Man',
    avatar: 'assets/characters/makima.jpg',
    fishVoiceId: '0c03219a981c4570a1b23a15b4107f30',
    gainDb: 16, // her raw output is quiet — boost on playback (from Cognify)
    tagline: 'Calm, composed, commanding',
    greeting: 'Good. You have a destination. Tell me what it is.',
  },
  {
    id: 'marin',
    name: 'Marin',
    fullName: 'Marin Kitagawa',
    series: 'My Dress-Up Darling',
    avatar: 'assets/characters/marin.jpg',
    fishVoiceId: '72c3988b410f43c9b0905521135ff010',
    gainDb: 0,
    tagline: 'Energetic, bubbly, total hype',
    greeting: "Hiii! Okay okay, where are we going today?! I'm so excited!",
  },
  {
    id: 'toji',
    name: 'Toji',
    fullName: 'Toji Fushiguro',
    series: 'Jujutsu Kaisen',
    avatar: 'assets/characters/toji.jpg',
    fishVoiceId: 'b1d5b2071ce3450b8f497cca90b78061',
    gainDb: 0,
    tagline: 'Dry, blunt, zero-effort energy',
    greeting: 'Where to. Make it quick.',
  },
  {
    id: 'miku',
    name: 'Miku',
    fullName: 'Miku Nakano',
    series: 'The Quintessential Quintuplets',
    avatar: 'assets/characters/miku_nakano.jpg',
    fishVoiceId: 'ba9fccd271b24b6aaf7eb58e1f1c858a',
    gainDb: 0,
    tagline: 'Warm, gentle, a little shy',
    greeting: "Um... where do you want to go? I'll look it up for you!",
  },
  {
    id: 'reze',
    name: 'Reze',
    fullName: 'Reze',
    series: 'Chainsaw Man',
    avatar: 'assets/characters/reze.jpg',
    fishVoiceId: '7e9fe06681074145b0227d3685b3b570',
    gainDb: 0,
    tagline: 'Soft-spoken, sweet, a little wistful',
    greeting: "Anywhere you want to go... I'll walk with you.",
  },
  {
    id: 'horikita',
    name: 'Horikita',
    fullName: 'Horikita Suzune',
    series: 'Classroom of the Elite',
    avatar: 'assets/characters/horikita.jpg',
    fishVoiceId: '4371047e054b4bd28073cd643f5077ff',
    gainDb: 0,
    tagline: 'Cool, precise, efficient',
    greeting: "State the destination. I'll calculate the optimal route.",
  },
];
```

Shinobu's portrait was also copied (`shinobu.jpg`) but Cognify never gave
her a voice ID — she's not in the roster unless we find her a voice later.

#### How personality works now

The anime characters are famous — the LLM already knows exactly how they
talk. No persona essays needed. The system prompt just says:

```
Act like {fullName} from {series}. ({tagline})
```

NavBuddy is ours, so he keeps a written persona (see §9).

#### How character affects the AI:

Same question, eight completely different vibes (voice + personality
switch together):

```
User: "How far are we?"

NavBuddy:  "About 500 meters out, 2 more minutes. We're good!"
Gojo:      "Only 500 meters~ Two minutes. Try to keep up."
Makima:    "500 meters remain. Two minutes. Maintain pace."
Toji:      "500 meters. Two minutes, if you stop dragging your feet."
Marin:     "500 meters?! That's literally two minutes — LET'S GOOO!"
Miku:      "Um... about 500 meters left. Two minutes... you're doing great!"
Reze:      "500 meters. Two minutes. I like walks like this."
Horikita:  "Remaining distance: 500 meters. ETA: two minutes."
```

---

### 7.10 Simulated Walk Mode

#### Service: `simulation.service.ts`

For demoing indoors where real GPS movement isn't possible.

```
Properties:
  isSimulating: boolean
  speed: number                            ← meters per second
  speedMultiplier: number                  ← 1x, 2x, 5x, 10x
  progress: number                         ← 0.0 to 1.0

Methods:
  start(route: RouteResult, speedMs: number): void
  pause(): void
  resume(): void
  stop(): void
  setSpeedMultiplier(x: number): void

Algorithm:
  1. Take route.geometry (array of [lat,lng] pairs)
  2. Calculate cumulative distances between each pair
  3. totalDistance = sum of all segment distances
  4. Start interval timer (every 500ms):
     a. distanceTraveled += speed * multiplier * 0.5
     b. Find which segment distanceTraveled falls on
     c. Interpolate exact position within that segment
     d. Add tiny random jitter (±0.00002° ≈ ±2m) for realism
     e. Feed position to locationService (override real GPS)
  5. When distanceTraveled >= totalDistance → stop

Integration with LocationService:
  When simulation is active, LocationService should emit
  simulated positions instead of (or merged with) real GPS.

  Approach: SimulationService directly calls
  locationService.injectPosition(pos) which pushes to
  the same positionSubject. The rest of the app doesn't
  know the difference.
```

**UI:** Toggle in settings page or a small debug FAB on map page.
When active, show a subtle banner: "🔄 Simulated • 2x speed".

---

### 7.11 UI / Screens

#### Tab Structure (rewired from starter)

```
Tab 1: Map (main) ← the star of the show
Tab 2: Chat History ← full conversation log with NavBudol
Tab 3: Settings ← character select, dark mode, sim mode, language
```

#### Map Page — Idle State

```
┌─────────────────────────────────────┐
│  🔍 Search a place...          ⚙️   │  ← search bar + settings gear
├─────────────────────────────────────┤
│                                     │
│                                     │
│            🗺️ LEAFLET MAP           │
│           (full screen)             │
│                                     │
│              💙                     │  ← pulsing blue dot (you)
│                                     │
│                                     │
│                                     │
│                          ◎ ← recenter button
├─────────────────────────────────────┤
│  🤖 "Where to today?"    ▲ expand  │  ← mini chat preview
├─────────────────────────────────────┤
│        🎙️ Talk to NavBudol         │  ← big mic button
└─────────────────────────────────────┘
```

#### Map Page — Route Preview State

```
┌─────────────────────────────────────┐
│  🔍 NEUST Gen. Tinio        ✕ clear │
├─────────────────────────────────────┤
│                                     │
│      💙 ───────── 📌               │  ← route polyline shown
│            MAP                      │
│     (zoomed to fit route)           │
│                                     │
├─────────────────────────────────────┤
│  📍 NEUST Gen. Tinio Campus         │
│  📏 1.8 km  •  ⏱️ 6 min            │
│                                     │
│  ┌────────────────────────────────┐ │
│  │        🟢  START NAV           │ │  ← big green button
│  └────────────────────────────────┘ │
├─────────────────────────────────────┤
│        🎙️ Talk to NavBudol         │
└─────────────────────────────────────┘
```

#### Map Page — Active Navigation State

```
┌─────────────────────────────────────┐
│  ↗️  TURN RIGHT                     │
│  onto Bonifacio Street              │  ← big bold instruction
│  ──────────────────── in 150 m      │
├─────────────────────────────────────┤
│                                     │
│          MAP (auto-following)       │
│             💙                      │  ← user moving
│              \                      │
│               \ (route line)        │
│                \                    │
│                 📌                  │
│                                     │
├─────────────────────────────────────┤
│  📏 1.2 km left  •  ⏱️ 4 min       │
│  Arrive ≈ 5:42 PM                  │
├─────────────────────────────────────┤
│ 🎙️ Talk │ 💬 Chat │ 📋 Steps │ ✕  │
└─────────────────────────────────────┘
```

#### Chat Sheet (slides up from bottom)

```
┌─────────────────────────────────────┐
│  Gojo 😎                     ▼ hide │
├─────────────────────────────────────┤
│                                     │
│  😎 Yo~ Strongest navigator here.  │
│     Where to?                      │
│                                     │
│               Take me to the  👤   │
│               church               │
│                                     │
│  😎 Holy Cross Parish? Easy~       │
│     500 m away. Say the word.      │
│                                     │
│                        Yes, go  👤   │
│                                     │
│  😎 Route plotted. 500 meters,     │
│     2 minutes. Just say 'start'~   │
│                                     │
├─────────────────────────────────────┤
│  🎙️ │ Type a message...     │ Send │
└─────────────────────────────────────┘
```

#### Mic Button States

```
IDLE:        🔵 blue circle, mic icon
             label: "Talk to NavBudol"

LISTENING:   🔴 red pulsing circle, mic icon
             label shows partial transcription
             "take me to the..."

PROCESSING:  ⚪ gray circle, spinner
             label: "Thinking..."

SPEAKING:    🟣 purple circle, speaker icon
             label: "Speaking..."
             (tap to interrupt)
```

#### Character Select Page

```
┌─────────────────────────────────────┐
│  ← Back    Pick Your Co-Pilot 🎭   │
├─────────────────────────────────────┤
│  (cards use the real portraits      │
│   copied from Cognify)              │
│                                     │
│  ┌───────────┐  ┌───────────┐      │
│  │  buddy.png│  │  gojo.jpg │      │
│  │ NavBuddy  │  │   Gojo    │      │
│  │ "Chill    │  │ "The      │      │
│  │  friend"  │  │ strongest"│      │
│  │ [✅Active] │  │ [Select]  │      │
│  └───────────┘  └───────────┘      │
│                                     │
│  ┌───────────┐  ┌───────────┐      │
│  │ makima.jpg│  │  toji.jpg │      │
│  │  Makima   │  │   Toji    │      │
│  │ "Command- │  │ "Dry &    │      │
│  │   ing"    │  │  blunt"   │      │
│  │ [Select]  │  │ [Select]  │      │
│  └───────────┘  └───────────┘      │
│                                     │
│  ┌───────────┐  ┌───────────┐      │
│  │  marin.jpg│  │  miku.jpg │      │
│  │   Marin   │  │   Miku    │      │
│  │ "Hype     │  │ "Soft &   │      │
│  │  girl"    │  │  shy"     │      │
│  │ [Select]  │  │ [Select]  │      │
│  └───────────┘  └───────────┘      │
│                                     │
│  ┌───────────┐  ┌───────────┐      │
│  │  reze.jpg │  │horikita   │      │
│  │   Reze    │  │  Horikita │      │
│  │ "Sweet &  │  │ "Cool &   │      │
│  │  wistful" │  │  precise" │      │
│  │ [Select]  │  │ [Select]  │      │
│  └───────────┘  └───────────┘      │
│                                     │
│  🔊 [Preview Voice]                │
│  Currently selected: NavBuddy ✅    │
└─────────────────────────────────────┘
```

#### Settings Page

```
┌─────────────────────────────────────┐
│  ← Back         Settings ⚙️        │
├─────────────────────────────────────┤
│                                     │
│  CHARACTER                          │
│  ┌─────────────────────────────┐   │
│  │ 😎 Gojo (current)      ▶   │   │  ← tap → character select
│  └─────────────────────────────┘   │
│                                     │
│  APPEARANCE                         │
│  ┌─────────────────────────────┐   │
│  │ 🌙 Dark Mode        [🔘]   │   │
│  └─────────────────────────────┘   │
│                                     │
│  NAVIGATION                         │
│  ┌─────────────────────────────┐   │
│  │ 🚗 Profile: Driving    ▶   │   │
│  └─────────────────────────────┘   │
│                                     │
│  DEVELOPER                          │
│  ┌─────────────────────────────┐   │
│  │ 🔄 Simulation Mode  [🔘]   │   │
│  │ ⚡ Sim Speed: [1x▼]        │   │
│  └─────────────────────────────┘   │
│                                     │
│  ABOUT                              │
│  NavBudol v1.0                     │
│  Made with 💀 by [your names]      │
│  Ionic + Capacitor + Gemini + Fish │
└─────────────────────────────────────┘
```

---

## 8. API Reference Cheat Sheet

### NavBudol Backend — FastAPI (local, built in Phase 0)

```
Base URL (app → backend):
  Browser dev:      http://localhost:8000
  Android device:   http://localhost:8000  via `adb reverse tcp:8000 tcp:8000`
  Android emulator: http://10.0.2.2:8000

POST /api/chat
  Body: {
    "system": "<system prompt>",
    "contents": [ { "role": "user"|"model"|"function", "parts": [...] } ],
    "tools": [ { "function_declarations": [...] } ]        ← optional
  }
  → forwards to Gemini 3.5 Flash Lite, normalizes the response:
  { "text": "..." | null, "functionCalls": [ { "name": "...", "args": {...} } ] | null }

POST /api/tts
  Body: { "text": "...", "reference_id": "<voice_id>" }
  → cache lookup sha1(text + "|" + voice_id) in backend/cache/
  → miss: forwards to Fish Audio, saves the MP3
  → returns: { "audioBase64": "...", "cached": false }

GET /api/health → { "ok": true }
  App pings this on startup. If unreachable, show a persistent banner:
  "Backend offline — start uvicorn + adb reverse" (demo-day insurance).

Keys live ONLY in backend/.env — never in environment.ts, never in the APK.
```

### OSRM — Routing (free, no key)

```
GET https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}
    ?steps=true&geometries=geojson&overview=full

Response → route.geometry.coordinates → swap [lng,lat] to [lat,lng]
Response → route.legs[0].steps → parse into RouteStep[]

No API key needed. Fair-use rate limit (fine for demo).
```

### Photon — Place Search (free, no key)

```
GET https://photon.komoot.io/api/?q={query}&lat={lat}&lon={lng}&limit=5

Response → features[] → each has geometry.coordinates + properties.name

No API key needed. Fast. CORS-friendly.
```

### Overpass — Nearby POI (free, no key)

```
POST https://overpass-api.de/api/interpreter
Body: data=[out:json][timeout:20];(nwr["name"~"church",i](around:2000,15.35,121.06););out center 8;

Response → elements[] → each has lat/lon + tags.name

No API key needed. Powerful OSM queries.
```

### Nominatim — Reverse Geocode (NEW — for AI context)

```
GET https://nominatim.openstreetmap.org/reverse
    ?lat={lat}&lon={lng}&format=json&zoom=18

Headers: User-Agent: NavBudol/1.0

Response → display_name: "Rizal Park, Ermita, Manila, Metro Manila, Philippines"
Response → address.road, address.suburb, address.city

Rate limit: 1 request per second. MUST include User-Agent.
Cache results. Only re-fetch when user moves >200m.
```

### Gemini — AI Chat + Function Calling (backend-side only)

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent
    (called by the BACKEND only — key comes from backend/.env)

Headers:
  Content-Type: application/json
  x-goog-api-key: {GEMINI_API_KEY}

Body:
{
  "system_instruction": { "parts": [{ "text": "{system prompt}" }] },
  "contents": [
    { "role": "user", "parts": [{ "text": "message" }] },
    { "role": "model", "parts": [{ "text": "response" }] },
    ...conversation history...
  ],
  "tools": [{ "function_declarations": [...] }],
  "generationConfig": {
    "temperature": 0.8,
    "maxOutputTokens": 250,
    "topP": 0.95
  }
}

Response cases:

  Case 1 — Plain text response:
    candidates[0].content.parts[0].text = "response text"

  Case 2 — Function call:
    candidates[0].content.parts[0].functionCall = {
      "name": "search_places",
      "args": { "query": "Jollibee" }
    }
    → Execute function
    → Send result back as:
      { "role": "function", "parts": [{ "functionResponse": {
        "name": "search_places",
        "response": { "results": [...] }
      }}]}
    → Get final text response

Model: gemini-3.5-flash-lite — confirm the exact ID in AI Studio when the
  key is created (preview variants can carry a -preview suffix).
⚠ gemini-2.0-flash-lite was RETIRED on June 1, 2026 — never use it.
Free tier: verify at ai.google.dev/gemini-api/docs/rate-limits when the key
  is created. Flash-Lite class ≈ 15 RPM / ~1,000 requests per day as of
  Sept 2026 — plenty for a demo with 1–3 sentence replies and capped history.
```

### Fish Audio — TTS (backend-side only, with MP3 cache)

```
POST https://api.fish.audio/v1/tts

Headers:
  Authorization: Bearer {FISH_API_KEY}
  Content-Type: application/json

Body (exactly what Cognify's proven client sent):
{
  "text": "Turn right onto Bonifacio Street",
  "reference_id": "{character_fish_voice_id}",
  "format": "mp3"
}

Response: raw audio/mpeg binary — the BACKEND receives this, caches it to
  backend/cache/{sha1(text|voice)}.mp3, and returns base64 JSON to the app.
  The app never calls Fish Audio directly.

Per-character gain (from Cognify): Makima's raw output is quiet —
  gainDb: 16. Applied at playback via a Web Audio GainNode, not by
  mutating the cached MP3.
```

---

## 9. System Prompt Engineering

This is the exact system prompt template sent to Gemini before every chat.

```
You are {character.name}, the AI navigation co-pilot in the NavBudol app.

=== WHO YOU ARE ===
{if anime character:}
Act like {character.fullName} from {character.series}. ({character.tagline})
Stay in character — you are a navigation companion, not a chatbot.
{else (NavBuddy — our own character):}
You are NavBuddy: friendly, chill, supportive. Like a smart friend riding
shotgun. Casual language, occasional humor. Gender-neutral.
{/if}

=== CURRENT SITUATION ===
Time: {currentTime} ({dayOfWeek})
User location: {lat}, {lng}
Address: {reverseGeocodedAddress}
Navigation status: {navPhase}
{if navigating:}
  Destination: {destination.name}
  Remaining: {remainingDistance} ({remainingDuration})
  Next turn: {nextInstruction} in {distanceToNextTurn}
{/if}
Language preference: {languagePref}

=== RULES ===
1. Keep responses SHORT — 1-3 sentences max. This is spoken aloud via TTS.
   Long responses are annoying to listen to.
2. Reply in English. Keep the tone casual and warm.
3. You can use the provided functions to search places, get directions,
   start/stop navigation, and check trip status. Use them when appropriate.
4. Be helpful and in-character. Don't break character.
5. Don't mention that you're an AI, a language model, or Gemini.
   You are {character.name}.
6. When reporting distances, use simple terms ("mga 2 kilometro" or "about 2 km").
7. If the user just wants to chat (not navigate), that's fine — stay in character
   and be conversational. But always be ready to help with navigation.
8. You have real-time access to the user's GPS location and navigation state
   through the context above. Use this information to give relevant answers.
```

---

## 10. Implementation Phases

### Phase 0: Scaffold Everything Fresh (Day 0 — half day)

**Goal:** Clean slate — new Ionic app, working backend skeleton, APK smoke test.

```
Tasks:
[ ] ionic start navbudol tabs --type=angular --capacitor  (creates app/)
[ ] Move assets/characters/ (portraits + voices.json) → app/src/assets/characters/
[ ] npx cap add android + first APK build smoke test (fail early, not Day 15)
[ ] Delete starter tab pages (tab1, tab2, tab3, explore-container)
[ ] backend/: python venv + pip install fastapi uvicorn[standard] httpx python-dotenv
[ ] backend/main.py with GET /api/health + CORS for localhost + capacitor origins
[ ] backend/.env with GEMINI_API_KEY + FISH_API_KEY
[ ] Verify: ionic serve shows tabs; curl localhost:8000/api/health → {"ok": true}

Deliverable: Empty-but-running app + backend. No legacy code.
```

### Phase 1: Map Page + Leaflet + GPS (Day 1-2)

**Goal:** App opens → you see a map → your blue dot is on it.

```
Tasks:
[ ] Delete starter tabs (tab1, tab2, tab3, explore-container)
[ ] Create map/ page + module
[ ] Rewire tabs to: Map | Chat | Settings
[ ] Initialize Leaflet on map page
    - OSM tile layer
    - Set default center (Gen. Tinio Poblacion) until GPS kicks in
[ ] Subscribe to LocationService.position$
[ ] Show animated pulsing blue dot at user position
[ ] Add "recenter" FAB button
[ ] Add dark mode tile layer toggle
[ ] Test in browser with Chrome location override

Deliverable: Map with your live blue dot. That's it. Clean.
```

### Phase 2: Search + Routing + Route Display (Day 3-4)

**Goal:** Search "NEUST Gen. Tinio" → route draws on map with instructions.

```
Tasks:
[ ] Build search-bar component
    - ion-searchbar with debounce
    - Photon autocomplete dropdown
    - On select → place destination marker
[ ] On destination selected → call RoutingService.getRoute()
[ ] Draw route polyline on map (blue, weight 6)
[ ] Place red destination pin
[ ] fitBounds() to show full route
[ ] Build route-preview component
    - Show: destination name, distance, ETA
    - "Start Navigation" button
    - "Cancel" button
[ ] Clear route when cancelled
[ ] Tap on map → drop pin → route to it (nice-to-have)

Deliverable: Search → see route → ready to navigate.
```

### Phase 3: Navigation Engine (Day 5-6)

**Goal:** Full Waze-style live navigation with voice turn alerts.

```
Tasks:
[ ] Build navigation.service.ts
    - State machine: idle → preview → navigating → rerouting → arrived
    - Subscribe to GPS updates when navigating
    - Track current step index
    - Proximity detection (200m, 50m, 20m thresholds)
    - Off-route detection (>50m from polyline, 3x hysteresis)
    - Auto-reroute when deviated
    - Arrival detection (<30m from destination)
    - Emit alerts$ for voice announcements
[ ] Build nav-banner component
    - Big instruction text + icon
    - Distance to next turn
    - Remaining distance + ETA
[ ] Map auto-follows user during navigation
[ ] Build simulation.service.ts
    - Interpolate position along route geometry
    - Configurable speed + multiplier
    - Inject into LocationService
[ ] Wire alerts$ to browser speechSynthesis (temporary TTS)
[ ] Test full nav flow with simulated walk

Deliverable: Start nav → simulated walk → turns announced →
instructions advance → "You have arrived!"
```

### Phase 4: AI Chatbot + Gemini (Day 7-8)

**Goal:** Chat with Gemini, it controls the map.

```
Tasks:
[ ] Build gemini.service.ts
    - System prompt builder with context injection
    - Conversation history management (cap at 20)
    - Function calling declarations
    - Function execution + result feeding
    - Character personality injection ("Act like {fullName} from {series}")
    - All HTTP to OUR BACKEND /api/chat — never call Google directly
[ ] Add Nominatim reverse geocoding for context
[ ] Build assistant chat sheet component
    - Slides up from bottom (Ionic modal or custom)
    - Message bubbles (user right, AI left with avatar)
    - Text input + send button
    - Typing indicator (animated dots)
    - Auto-scroll to latest
[ ] Build message-bubble component
[ ] Wire function calls to actual services:
    - search_places → PlacesService.search()
    - find_nearby_places → PlacesService.nearby()
    - get_directions → RoutingService.getRoute() → show route
    - start_navigation → NavigationService.startNavigation()
    - stop_navigation → NavigationService.stopNavigation()
    - get_trip_status → NavigationService.navState$
[ ] Test: type "take me to the municipal hall" → route appears

Deliverable: Chat with AI → it finds places, sets routes,
starts nav. All through natural conversation.
```

### Phase 5: Voice — STT + Fish Audio TTS (Day 9-10)

**Goal:** Talk to the app, it talks back with a natural voice.

```
Tasks:
[ ] Install @capacitor-community/speech-recognition
    npm install @capacitor-community/speech-recognition
    npx cap sync
[ ] Build speech.service.ts
    - Native plugin on device
    - Web Speech API fallback in browser
    - Partial result streaming
    - Language: en-US
[ ] Build tts.service.ts
    - Backend /api/tts integration (cached MP3s)
    - Audio playback (base64 → Blob → GainNode with per-character gain)
    - Queue management
    - Browser speechSynthesis fallback
[ ] Build voice-assistant.service.ts
    - Orchestrates: mic tap → STT → Gemini → TTS
    - State management: idle/listening/processing/speaking
    - Interrupt: tap mic while speaking → stop TTS, start listening
[ ] Build mic-fab component
    - Visual states (blue/red/gray/purple)
    - Partial transcription display
    - Press to toggle listening
[ ] Replace navigation alert speechSynthesis with Fish Audio
[ ] Test each character voice with a sample line (pronunciation check —
    these voices lean Japanese/English)
[ ] NavBuddy voice stays empty for now — verify his system-TTS fallback works
[ ] Test full voice loop end-to-end

Deliverable: Tap mic → "Take me to NEUST" → AI responds with
Fish Audio voice → route appears. Full voice loop working.
```

### Phase 6: Character System (Day 11-12)

**Goal:** Pick a character, AI personality + voice changes.

```
Tasks:
[ ] Build character.service.ts
    - Character list from constants
    - Selection persisted in localStorage
    - Observable for character changes
[ ] Build characters.ts roster from voices.json
    (NavBuddy + 7 anime characters, real voice IDs from day one)
[ ] Build character-select page
    - Grid of character cards
    - Avatar + name + tagline
    - "Preview Voice" button (short TTS sample)
    - Selected state indicator
[ ] Wire character to gemini.service.ts
    - System prompt uses "Act like {fullName} from {series}"
[ ] Wire character to tts.service.ts
    - TTS uses selected character's fishVoiceId
[ ] Wire character to assistant chat
    - Avatar shows in message bubbles
    - Character greeting on selection
[ ] Verify all 7 voice IDs via Preview Voice (they're real from day one)

Deliverable: Switch characters → different personality + voice.
```

### Phase 7: Polish & Ship (Day 13-15)

**Goal:** Demo-ready, professor-shock-ready.

```
Tasks:
[ ] Dark mode (CSS variables + dark map tiles)
[ ] Quick-action chips on map: 🍔 Food, ⛽ Gas, 🏧 ATM
    → search_nearby → show results on map
[ ] Error handling everywhere:
    - GPS denied → show message + manual pin drop
    - No internet → toast message
    - API error → fallback gracefully
    - Backend unreachable → banner: "start uvicorn + adb reverse"
    - TTS error → browser speechSynthesis
[ ] Loading states (skeletons, spinners, typing indicator)
[ ] Saved places feature (localStorage)
    - "Take me home" → saved place
[ ] Settings page buildout
[ ] App icon + splash screen
[ ] Android build (already scaffolded in Phase 0):
    npx cap sync
    → open Android Studio → Build APK
[ ] Demo-day backend checklist: start uvicorn, adb reverse tcp:8000 tcp:8000,
    verify /api/health
[ ] Test on real Android device
[ ] Record backup demo video
[ ] Practice demo script

Deliverable: APK on phone. Demo script rehearsed. Video backup ready.
```

---

## 11. Environment & Config

### environment.ts (updated)

```typescript
export const environment = {
  production: false,

  // === Backend (the ONLY private API surface) ===
  // Keys live in backend/.env — GEMINI_API_KEY + FISH_API_KEY. Never here.
  backendBaseUrl: 'http://localhost:8000',
  // Android device: same URL thanks to `adb reverse tcp:8000 tcp:8000`
  // Android emulator: 'http://10.0.2.2:8000'

  // === Free geo stack (no keys) ===
  osrmBaseUrl: 'https://router.project-osrm.org',
  photonBaseUrl: 'https://photon.komoot.io',
  overpassUrl: 'https://overpass-api.de/api/interpreter',
  nominatimUrl: 'https://nominatim.openstreetmap.org',

  // === Map ===
  osmTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  darkTileUrl: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  defaultCenter: { lat: 15.3519, lng: 121.0633 }, // Gen. Tinio (Papaya) Poblacion, Nueva Ecija
  defaultZoom: 15,

  // === Navigation thresholds ===
  offRouteThresholdM: 50,
  offRouteHysteresis: 3,        // consecutive off-route fixes before reroute
  alertDistance1M: 200,          // first voice alert
  alertDistance2M: 50,           // second voice alert
  stepAdvanceM: 20,             // advance to next step
  arrivalThresholdM: 30,        // "you have arrived"

  // === Simulation ===
  simSpeedWalkingMs: 1.4,       // walking m/s
  simSpeedDrivingMs: 11.0,      // driving m/s (~40 km/h)
  simTickMs: 500,               // position update interval

  // === Voice ===
  sttLanguages: ['en-US'],
  maxChatHistory: 20,
};
```

### backend/.env (keys live HERE — real file gitignored, commit only .env.example)

```
GEMINI_API_KEY=...   ← from AI Studio (getting it)
FISH_API_KEY=...     ← have it
```

### capacitor.config.ts

```typescript
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.navbudol.app',
  appName: 'NavBudol',
  webDir: 'www',
  server: { androidScheme: 'https' }
};

export default config;
```

### Android Permissions

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
```

### Prerequisites

```
Required before starting:
[ ] Python 3.11+           ← for the backend
[x] Node.js 22             ← already installed
[x] Ionic CLI              ← already installed
[x] Angular CLI            ← already installed
[x] Android Studio         ← already installed
[x] Android SDK            ← already installed
[ ] GEMINI_API_KEY         ← AI Studio (getting it) → backend/.env
[ ] FISH_API_KEY           ← have it → backend/.env
[x] 7 anime voice IDs      ← in assets/characters/voices.json (done)
[ ] NavBuddy voice ID      ← intentionally empty for now — system TTS fallback
[ ] @capacitor-community/speech-recognition ← install in Phase 5
```

---

## 12. Android Build Checklist

When it's time to build the APK:

```
1. Build the Angular app for production:
   ionic build --prod

2. Sync with Capacitor:
   npx cap sync android

3. Start the backend (needed for chat + voice):
   cd ../backend && uvicorn main:app --port 8000
   adb reverse tcp:8000 tcp:8000   ← phone reaches laptop's backend over USB,
                                     no WiFi required

4. Open in Android Studio:
   npx cap open android

5. In Android Studio:
   - Wait for Gradle sync to finish
   - Build → Build Bundle(s) / APK(s) → Build APK(s)
   - OR for signed: Build → Generate Signed Bundle / APK

6. APK location:
   android/app/build/outputs/apk/debug/app-debug.apk

7. Install on phone:
   adb install app-debug.apk
   OR just transfer the APK file and open it on the phone

8. Test:
   - GPS permission prompt → allow
   - Mic permission prompt → allow
   - Map loads → blue dot appears
   - Backend banner absent (means /api/health is reachable)
   - Full voice loop works
```

---

## 13. Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | **Web Speech API doesn't work in Android WebView** | 🔴 Critical | Use native `@capacitor-community/speech-recognition`. Already planned. |
| 2 | **Fish Audio latency (2-5 sec)** | 🟡 Medium | Show text immediately in chat. Play audio when ready. Keep responses SHORT (1-3 sentences). Backend caches MP3s server-side — repeat phrases play instantly. |
| 3 | **GPS doesn't work indoors** | 🟡 Medium | Simulated walk mode. Also works with Chrome DevTools location override for browser demo. |
| 4 | **Nominatim rate limit (1/sec)** | 🟢 Low | Only used for reverse geocode in AI context. Cache aggressively. Only re-fetch when user moves >200m. |
| 5 | **OSRM demo server rate limits** | 🟢 Low | Fine for demo. If issues, switch to OpenRouteService (free key, 2K/day). |
| 6 | **Gemini function calling returns unexpected format** | 🟡 Medium | Wrap in try/catch. If function call fails, tell user "Sorry, try again." Log errors. |
| 7 | **API keys in the APK** | ✅ Solved | Keys live in `backend/.env` — the app only talks to our FastAPI proxy. Now a talking point for the defense, not a risk. |
| 8 | **Android build fails** | 🟡 Medium | Build APK early (Phase 1). Don't wait until last day. Keep Android Studio updated. |
| 9 | **Demo venue has bad WiFi** | 🟡 Medium | Pre-record a backup video. Use phone data as hotspot. Sim mode doesn't need internet for GPS. |
| 10 | **Fish Audio quota exceeded** | 🟢 Low | Fallback to browser `speechSynthesis`. Ugly but functional. Demo-day insurance. |
| 11 | **STT accuracy for place names** | 🟡 Medium | Show transcription for verification. Allow text input fallback. Capture the actual spoken name when it fails. |
| 12 | **NavBuddy has no Fish voice for now** | 🟢 Low | Intentional — voice ID left empty. He uses system speechSynthesis; the anime cast carries the natural voices. |
| 13 | **Gemini free tier tighter than the old 500 RPM claim** | 🟡 Medium | Verify limits when the key is created. Short replies, 20-message history cap, cached TTS. ~1,000 req/day is plenty for a demo. |
| 14 | **Backend unreachable during demo** | 🟡 Medium | In-app banner via /api/health. `adb reverse` over USB = no WiFi needed. Backend is one command on the demo laptop. |
| 15 | **Anime voices on unfamiliar place names** | 🟡 Medium | These voices lean Japanese/English. Test each with a local place name in Phase 5; keep turn-by-turn alerts short and simple. |

---

## 14. Demo Day Script

### Pre-Demo Setup (5 min before)

```
1. Start backend: cd backend && uvicorn main:app --port 8000
2. adb reverse tcp:8000 tcp:8000 (USB cable to laptop — no WiFi needed)
3. Open NavBudol on Android phone (or browser backup)
4. Confirm GPS is working (blue dot on map)
5. Set simulation mode ON (in case demo is indoors)
6. Select the most entertaining character (Gojo?)
7. Have a pre-planned destination in mind
8. Phone volume UP
9. Phone screen brightness UP
```

### The 5-Minute Demo

```
[0:00] HOOK — Show the app
  "This is NavBudol, our AI-powered voice navigation assistant."
  → Show the map. Blue dot pulsing. Clean UI. Dark mode for drip.
  
  "It's like Waze, but you can actually TALK to it."

[0:30] SEARCH — Normal search first
  → Type "Minalungao National Park" in search bar
  → Route draws on map
  → "Here we see the route — 12 km, 28 minutes, with turn-by-turn."
  → Show instructions panel

[1:00] THE MOMENT — Voice interaction
  → Tap 🎙️ mic button (turns red, pulsing)
  → Say: "Gojo, take me to the municipal hall"
  → Screen shows real-time transcription
  → Gojo responds (Fish Audio voice):
    "Municipal Hall? Poblacion Central, 500 meters. Say the word~"
  → Route to Municipal Hall appears on map

  (This is the "shock" moment. The AI understood the spoken request,
   found a real nearby place, plotted the route, and spoke
   back in a natural voice with personality.)

[2:00] NAVIGATION — Watch it work
  → Say: "Start"
  → Navigation begins. Map follows the blue dot.
  → Simulated walk moves along the route.
  → Voice announces: "In 200 meters, turn right"
  → Instruction banner updates live

[3:00] MID-TRIP CHAT — Show context awareness
  → Tap mic: "Gojo, gaano pa kalayo?"
  → Gojo: "Mga 800 meters na lang~ 3 minutes. Keep up, yeah!"
  
  (He KNOWS the exact distance because the AI has live context.)

[3:30] CHARACTER SWITCH — Show personality system
  → Open settings → change character to "Makima"
  → Ask: "How far?"
  → Makima: "800 meters. Three minutes. Maintain course."
  
  (Same question, completely different vibe. Voice is different too.)

[4:00] ARRIVAL
  → Simulated walk reaches destination
  → Voice: "You have arrived at your destination!"
  → State resets to idle

[4:30] CLOSING
  → "Everything you just saw uses free, open-source APIs."
  → "OpenStreetMap for the map. OSRM for routing. Gemini for AI.
     Fish Audio for the voice. Total cost: zero."
  → "Built with Ionic and Capacitor. Runs on Android and browser."
  → "We wrote our own FastAPI backend — it keeps the API keys safe
     server-side and caches voice clips so repeated phrases play instantly."
  → "The AI has function calling — it doesn't just chat, it actually
     controls the navigation."
```

---

## 15. What to Say When the Professor Asks Questions

```
Q: "What frameworks did you use?"
A: "Ionic with Angular for the UI, Capacitor for native device access
   like GPS and microphone. The map is Leaflet with OpenStreetMap tiles."

Q: "Is the AI just a wrapper?"
A: "No — the AI uses Gemini's function calling feature. It can actually
   execute actions like searching for places, plotting routes, and
   starting navigation. It's not just chatting — it controls the app."

Q: "How does the voice work?"
A: "Speech-to-text uses the device's native speech recognizer — Google's
   engine on Android. Text-to-speech uses Fish Audio, which produces
   natural-sounding voices. Each character has a different voice, and
   our backend caches clips so repeated phrases play instantly."

Q: "Can it work offline?"
A: "The speech recognition can work offline on newer Android devices.
   The map, routing, and AI require internet. We'd add offline map tiles
   as a future enhancement."

Q: "How much did the APIs cost?"
A: "Zero. Everything uses free tiers — OpenStreetMap, OSRM, Photon,
   Overpass, Gemini's free tier, Fish Audio's free tier. Our backend
   runs free on our own laptop. No credit card required."

Q: "Did you build this from scratch?"
A: "Yes. We scaffolded with Ionic's starter template, then replaced
   everything with our own architecture — services, map integration,
   AI pipeline, voice system. No templates or pre-built navigation
   components."

Q: "What about security? API keys in the app?"
A: "No — we wrote a FastAPI backend that proxies the AI and TTS calls.
   The Gemini and Fish Audio keys live only in the backend's .env file;
   they never ship inside the APK. The backend also caches repeated
   voice clips for instant playback."

Q: "Doesn't routing through your backend add latency?"
A: "The extra hop is phone-to-laptop — a few milliseconds over USB. TTS
   synthesis itself takes seconds. And because the backend caches audio,
   repeated phrases skip the internet entirely and play in milliseconds —
   faster than calling the API directly every time. It also keeps the
   API keys off the device."

Q: "What makes this different from Google Maps?"
A: "Google Maps is a global index of places. Ours is a local index of
   knowledge Google structurally can't hold — a farm, a house, a waiting
   shed — plus facts that expire: this road floods, there's a checkpoint
   at the bridge, the tricycle to the market is ₱15. Google's place policy
   rejects non-public places, and their moderation is centralized, so a
   barangay's informal layer will never be in their index. Then the AI
   reads those reports and makes the call — mention it, suggest another
   route, or actually route around it. Google shows you a pin and leaves
   the decision to you."

Q: "Isn't this just Waze? Community reports and confirmations are old."
A: "Waze proved the loop works — community reports with thumbs-up confirms
   and automatic expiry — and that's exactly why we're confident in it
   instead of claiming it as new. What Waze doesn't do is reason over the
   reports: it puts an icon on the map and leaves you to decide while
   driving. Ours weights confirmations by whether the person was
   physically there, and the AI combines the reports with your request,
   the weather, and your route to make a recommendation. Waze also only
   covers roads; ours attaches knowledge to places — cheap, has aircon,
   sells imported ramen — which no filter UI can express. Filters are
   finite; conversation isn't."
```

---

## 16. Community Layer — Places & Reports

**Implemented at case-study scope.** Full plan and decision record: [COMMUNITY_REPORTS_PLAN.md](./COMMUNITY_REPORTS_PLAN.md).

The differentiator this project actually owns. The map, the routing, and the model are
all rented from free tiers — Google rents the same model — so the only defensible asset
is local knowledge a global index cannot hold, and the AI is what makes it usable.

- **A place is a noun. A report is a sentence with a timestamp.** One record shape,
  two flavors, one add flow. Shelf life is a field: a flood report lasts hours, a
  "₱15 tricycle fare" lasts months.
- **Confirmations are weighted by physical presence** ("my GPS was there"), not by
  likes. Popularity is not truth.
- **The AI retrieves, then decides:** mention it, suggest an alternative, or reroute
  around it (ORS `avoid_polygons`). It may only *reroute* on a presence-confirmed
  report — a single unverified note must never change someone's route.
- **Hard limit:** attributes of a *place* are open season; accusations about *people*
  are not. Defamation risk is real in a town this size, and an AI repeating a claim
  makes the app the speaker.

Honest framing for the defense: community reporting is not new (Waze ~2010, OSM Notes
2013, Foursquare Tips). What is new is the AI *reasoning over* perishable local reports
instead of dropping a pin and leaving the decision to the driver.

---

## Summary

```
NavBudol = Map + Navigation + AI + Voice + Characters

Map:        Leaflet + OpenStreetMap (free)
Navigation: OSRM routing + custom state machine + turn alerts
AI:         Gemini 3.5 Flash Lite with function calling (via our backend)
Backend:    FastAPI (local) — key vault, /api/chat, /api/tts + MP3 cache
Voice In:   Native speech recognition (Android/iOS)
Voice Out:  Fish Audio TTS — 7 anime voices (IDs ready); NavBuddy on system TTS for now
Characters: "Act like {character} from {series}" — the LLM knows them
Community:  Places + expiring reports, presence-weighted confirms (COMMUNITY_REPORTS_PLAN.md)
Demo:       Simulated walk mode for indoor presentation
Cost:       ₱0

8 phases (0-7) × ~2 days each = ~16 days to ship

When we're done, say the word and I build it. Phase by phase.
One command at a time. No shortcuts.
```
