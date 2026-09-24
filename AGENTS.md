# NavBudol agent notes

## Source of truth

- This repository is two independent apps: `app/` is the Angular/Ionic/Capacitor client and `backend/` is a FastAPI service. There is no root package, workspace, task runner, CI workflow, or shared test command; run commands from the owning directory.
- Treat `README.md` and `NAVBUDOL_PLAN.md` as intent/history, not current architecture. Verify versions, routes, data contracts, and rosters in `app/package.json`, `app/angular.json`, and source. The docs already drift (for example, the README says Ionic 8 while the manifest is Ionic 9, and its roster does not match `app/src/app/core/constants/characters.ts`).
- `COMMUNITY_REPORTS_PLAN.md` is a **design document**, not a description of built behavior. Only the shared-location half exists (`backend/routers/locations.py`, `app/src/app/core/service-area.ts`, `PlacesService.addSharedLocation`); reports, expiry, presence-weighted confirms, and report-aware rerouting are unimplemented. Do not infer those features from the plan when reading the code.

## Toolchain and verification

- The repository-local Node runtime is required: Angular CLI 22.1.8 rejects the system Node 22.19. From the repository root, run `$env:Path = "$PWD\.tooling\node22;$env:Path"` before frontend commands. The local runtime is Node 22.23.2.
- Backend setup/run (from `backend/`):
  ```powershell
  python -m venv venv
  .\venv\Scripts\python.exe -m pip install -r requirements.txt
  .\venv\Scripts\python.exe -m uvicorn main:app --port 8000
  ```
  Run it from `backend/`: `main.py` uses top-level imports (`routers` and `services`).
- Frontend setup and checks (from `app/`): `npm install` (or lockfile-based `npm ci`), `npx ng serve --port 8300`, `npm run lint`, `npm test -- --watch=false`, and `npx tsc --noEmit -p tsconfig.app.json`. There is no `typecheck`, formatter, or backend-test script; use the explicit commands instead.
- The lint command currently has a pre-existing non-green baseline (legacy NgModule/injection/structural-directive rules), so compare a focused run with the baseline before treating errors as regressions. No application spec files currently exist, and the normal test command exits with “No tests found”; use `npx ng test --list-tests --watch=false` to inspect, then focused tests use `npm test -- --watch=false --include=src/path/to/file.spec.ts` or `--filter='^SuiteName'`.
- `npm run build` writes `app/www` and uses the production configuration by default. For native work use the explicit order: `npx ng build --configuration production`, `npx cap sync android`, then `npx cap open android`.

## Runtime architecture

- `app/src/main.ts` bootstraps `AppModule`; the app is explicitly NgModule-based (`standalone: false` in schematics/components), and the default route is `/tabs/map`. Keep feature changes in the existing lazy feature modules under `app/src/app/`.
- Change detection is zoneless: `angular.json` has no polyfills and async UI updates use `NgZone.run(...)` or `ChangeDetectorRef.markForCheck()`. Preserve that pattern for asynchronous state.
- The Gemini function-calling loop lives on the device in `app/src/app/core/services/gemini.service.ts`; `backend/services/gemini_client.py` is a stateless proxy. Do not move tool execution into the backend.
- Gemini `contents` and raw `parts` are passed through intentionally. Preserve unknown fields such as `thoughtSignature` and IDs when round-tripping model responses.
- Provider data uses different coordinate orders. The backend converts ORS geometry to `[lat, lng]` for the app; OSRM/GeoJSON input is `[lng, lat]`. Keep those conversions localized and tested when touching routing or geo code.
- The backend URL is hard-coded as `http://localhost:8000` in both `environment.ts` and `environment.prod.ts`. Browser requests use `fetch`; native requests use `CapacitorHttp`. For a USB device run `adb reverse tcp:8000 tcp:8000`; update both environment files if the backend address changes.

## Data, keys, and native files

- `backend/data/places_final.json` is the serving source for `/api/localpois`; the app stores a date/versioned copy in browser `localStorage`. If the dataset is regenerated, change the cache version or clear the old key before testing.
- The rebuild pipeline is `fetch_localpois.py` -> `enrich_localpois.py`; Foursquare extraction -> `filter_foursquare_boundary.py`; `overture_fetch.py`; then `merge_final.py`. The Foursquare/Overture scripts require `fsspec`/`pyarrow` and `duckdb`, which are not in `backend/requirements.txt`; install and verify them separately before running those network/data jobs. `merge_final.py` currently rewrites merged details to `kind · General Tinio`, so do not assume enrichment labels survive the merge.
- Keep private Gemini/Fish and geo-provider keys in `backend/.env` (never in the app or committed files). The `.env.example` lists only Gemini/Fish; geo routes separately require `ORS_API_KEY`, `OWM_API_KEY`, and `GEOAPIFY_KEY`. `/api/health` reports only Gemini/Fish readiness, not geo-provider readiness. The backend is a local demo proxy with wildcard CORS and no authentication; do not expose it as-is.
- `app/src/app/core/constants/characters.ts` is the runtime character source of truth; do not infer the active roster from README text or `assets/characters/voices.json` without checking the import.
- Capacitor uses `webDir: 'www'`. Do not hand-edit generated `app/android/capacitor.settings.gradle`; regenerate with `cap sync`. The Android project and its starter tests are not an application test suite.
