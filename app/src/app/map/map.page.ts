import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, inject, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, map, Subscription } from 'rxjs';
import maplibregl, { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import type { Feature } from 'geojson';
import { ActionSheetController, ToastController } from '@ionic/angular/lazy';

import { environment } from '../../environments/environment';
import { GpsPosition, MapEvent, NavState, PlaceResult, RouteProfile } from '../core/models';
import { LocationService } from '../core/services/location.service';
import { NavigationService } from '../core/services/navigation.service';
import { RoutingService } from '../core/services/routing.service';
import { GeminiService } from '../core/services/gemini.service';
import { SimulationService } from '../core/services/simulation.service';
import { SettingsService } from '../core/services/settings.service';
import { BackendApiService, HealthResponse } from '../core/services/backend-api.service';
import { CharacterService } from '../core/services/character.service';
import { VoiceAssistantService } from '../core/services/voice-assistant.service';
import { ChatActionsService } from '../core/services/chat-actions.service';
import { CommunityPlacesService } from '../core/services/community-places.service';
import { placeIconDef } from '../core/constants/place-icons';
import { distanceFromGeneralTinio, isWithinGeneralTinioServiceArea } from '../core/service-area';
import { formatDistance, haversineM, snapToSegment } from '../core/geo.utils';

interface WeatherInfo {
  temp: number;
  description: string;
}

/**
 * MapLibre GL + MapTiler VECTOR styles (same key as the old raster setup —
 * vector tiles render GPU-side: smooth zoom, 3D terrain + hillshade, building
 * extrusions, globe projection when zoomed out). All the smart features (ORS
 * routes with elevation, Geoapify search, weather) come from our backend.
 *
 * Community places render as teardrop icon pins up close and circle chips
 * when zoomed out. The user dot only appears after a REAL GPS fix (or a
 * simulated one) — the app never pretends to know where you are.
 */
@Component({
  selector: 'app-map',
  templateUrl: './map.page.html',
  styleUrls: ['./map.page.scss'],
  standalone: false,
})
export class MapPage implements AfterViewInit, OnDestroy {
  @ViewChild('mapDiv', { static: true }) mapDiv!: ElementRef<HTMLDivElement>;

  readonly navState$ = this.nav.navState$;
  readonly simulating$ = this.sim.isSimulating$;
  readonly hasFix$ = this.location.position$.pipe(map((p) => p !== null));
  readonly character = this.characters.getSelected();
  readonly weather$ = new BehaviorSubject<WeatherInfo | null>(null);
  /** True while a route is being calculated — shown as a "finding route" pill. */
  readonly routing$ = new BehaviorSubject(false);
  chatOpen = false;
  backendOk: boolean | null = null;

  get isTraveling(): boolean {
    return this.nav.phase === 'navigating' || this.nav.phase === 'rerouting';
  }

  get aiThinking(): boolean {
    return this.gemini.thinking$.value;
  }

  get chatLocked(): boolean {
    // Chat stays available DURING navigation on purpose — the copilot can
    // find detours, answer questions, and converse mid-trip.
    return this.aiThinking;
  }

  private map: MlMap | null = null;
  private userMarker: Marker | null = null;
  private destMarker: Marker | null = null;
  private placeMarkers: Marker[] = [];
  private communityMarkers: Marker[] = [];
  private routeCoords: [number, number][] | null = null;
  private styleReady = false;
  private pitched = false;
  private follow = true;
  private gotFirstFix = false;
  private subs: Subscription[] = [];
  /** Keeps the GL canvas in sync with the container through layout races. */
  private resizeObserver: ResizeObserver | null = null;

  // Progressive route trimming: the passed part of the line disappears.
  private routePoints: { lat: number; lng: number }[] | null = null;
  private trimIndex = 0;

  constructor(
    private location: LocationService,
    private nav: NavigationService,
    private routing: RoutingService,
    private gemini: GeminiService,
    private sim: SimulationService,
    private settings: SettingsService,
    private api: BackendApiService,
    private characters: CharacterService,
    private voice: VoiceAssistantService,
    private chatActions: ChatActionsService,
    private community: CommunityPlacesService,
    private router: Router,
    private zone: NgZone,
    private cdr: ChangeDetectorRef,
    private toastCtrl: ToastController
  ) {}

  // --- lifecycle -----------------------------------------------------------

  ngAfterViewInit(): void {
    this.initMap();
    this.subs.push(
      this.location.position$.subscribe((pos) => this.zone.run(() => this.onPosition(pos))),
      this.nav.navState$.subscribe((state) => this.zone.run(() => this.onNavState(state))),
      this.gemini.mapEvents$.subscribe((ev) => this.zone.run(() => this.onMapEvent(ev))),
      this.settings.dark$.subscribe(() => this.zone.run(() => this.applyStyle())),
      this.settings.satellite$.subscribe(() => this.zone.run(() => this.applyStyle())),
      this.community.nearby$.subscribe(() =>
        this.zone.run(() => this.map && this.renderCommunityPins(this.map.getZoom()))
      ),
      // Arriving at a community place = a GPS-verified visit. arrived$ emits
      // before stopNavigation() clears the route, so the destination is still
      // readable from nav state here.
      this.nav.arrived$.subscribe(() => {
        const destination = this.nav.navState$.value.route?.destination;
        if (destination) void this.recordArrivalVisit(destination);
      })
    );
  }

  ionViewDidEnter(): void {
    setTimeout(() => this.map?.resize(), 60);
    void this.location.startWatch();
    void this.checkBackend();
    void this.loadWeather();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.map?.remove();
    this.map = null;
  }

  // --- map init -------------------------------------------------------------

  private styleUrl(): string {
    const base = environment.maptilerStyles[this.settings.mapStyle];
    return `${base}/style.json?key=${environment.maptilerKey}`;
  }

  private initMap(): void {
    this.map = new maplibregl.Map({
      container: this.mapDiv.nativeElement,
      style: this.styleUrl(),
      center: [environment.defaultCenter.lng, environment.defaultCenter.lat],
      zoom: environment.defaultZoom,
      maxZoom: 19,
      attributionControl: false,
    });
    // TEMP DEBUG: capture maplibre's internal errors for live diagnosis.
    (window as unknown as { __mapErrors: string[] }).__mapErrors = [];
    this.map.on('error', (e) => {
      const bag = (window as unknown as { __mapErrors: string[] }).__mapErrors;
      if (bag.length < 20) bag.push(String(e.error?.message ?? e).slice(0, 200));
    });
    // The vector style carries its own MapTiler/OSM attribution; render it
    // compact so it reads as a small pill like the Leaflet one did.
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    // The GL canvas locks to the container size at creation — if the view
    // hadn't laid out yet it stays 400x300 forever. Observe and resize.
    this.resizeObserver = new ResizeObserver(() => this.map?.resize());
    this.resizeObserver.observe(this.mapDiv.nativeElement);

    // Re-add our custom sources/layers after every style (re)load — setStyle
    // wipes them (this also fires once after the initial load).
    this.map.on('style.load', () => this.enhanceStyle());
    // 'moveend' doesn't fire on the initial load — fetch community pins once
    // the map is ready too.
    this.map.on('load', () => this.zone.run(() => void this.onCameraIdle()));
    this.map.on('dragstart', () => this.zone.run(() => (this.follow = false)));
    this.map.on('moveend', () => this.zone.run(() => void this.onCameraIdle()));
    this.map.on('click', (e) =>
      this.zone.run(() => void this.onMapTap({ lat: e.lngLat.lat, lng: e.lngLat.lng }))
    );
  }

  /** Every camera rest: refresh community pins around the visible area. */
  private async onCameraIdle(): Promise<void> {
    const map = this.map;
    if (!map) return;
    const zoom = map.getZoom();
    this.renderCommunityPins(zoom);
    const center = map.getCenter();
    const radius = zoom >= 14 ? 3000 : zoom >= 12 ? 10000 : 25000;
    await this.community.refreshNearby(center.lat, center.lng, radius);
  }

  /** Teardrop icon pins up close; small circle chips when zoomed out. */
  private renderCommunityPins(zoom: number): void {
    const map = this.map;
    if (!map) return;
    this.communityMarkers.forEach((m) => m.remove());
    this.communityMarkers = [];
    for (const place of this.community.nearby$.value) {
      const icon = placeIconDef(place.icon)?.key ?? 'location_on';
      const el = document.createElement('div');
      if (zoom >= 14) {
        el.className = 'community-pin';
        el.innerHTML = `<span class="material-symbols-rounded">${icon}</span>`;
      } else {
        el.className = 'community-chip';
        el.innerHTML = `<span class="material-symbols-rounded">${icon}</span>`;
      }
      el.title = place.name;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.router.navigateByUrl(`/place/${place.id}`);
      });
      this.communityMarkers.push(
        new maplibregl.Marker({ element: el, anchor: zoom >= 14 ? 'bottom' : 'center' })
          .setLngLat([place.lng, place.lat])
          .addTo(map)
      );
    }
  }

  private async recordArrivalVisit(destination: PlaceResult): Promise<void> {
    if (!destination.communityPlaceId) return;
    const pos = this.location.position;
    if (!pos) return;
    try {
      await this.community.recordVisit(destination.communityPlaceId, { lat: pos.lat, lng: pos.lng });
      await this.toast(`Visit verified at ${destination.name} — your comments here now carry the badge.`);
    } catch {
      /* distance proof failed — no badge, no drama */
    }
  }

  /** Dark / light / satellite switch — style.load re-applies the 3D layers. */
  private applyStyle(): void {
    if (!this.map) return;
    this.styleReady = false;
    this.map.setStyle(this.styleUrl());
  }

  /**
   * The wow layer: 3D terrain + hillshade (MapTiler DEM), building
   * extrusions from the style's own OpenMapTiles source, globe projection,
   * and the Waze-style route source. Idempotent — runs on every style.load.
   */
  private enhanceStyle(): void {
    const map = this.map;
    if (!map) return;
    this.styleReady = true;
    try {
      if (!map.getSource('nb-terrain')) {
        map.addSource('nb-terrain', {
          type: 'raster-dem',
          tileSize: 256,
          maxzoom: 12,
          attribution: '© MapTiler',
          tiles: [
            `https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${environment.maptilerKey}`,
          ],
        });
      }
      if (!map.getTerrain()) map.setTerrain({ source: 'nb-terrain', exaggeration: 1.35 });
      if (!map.getLayer('nb-hillshade')) {
        map.addLayer({
          id: 'nb-hillshade',
          type: 'hillshade',
          source: 'nb-terrain',
          paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#26343f' },
        });
      }

      const style = map.getStyle();
      if (style.sources['openmaptiles'] && !map.getLayer('nb-3d-buildings')) {
        map.addLayer({
          id: 'nb-3d-buildings',
          type: 'fill-extrusion',
          source: 'openmaptiles',
          'source-layer': 'building',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#9aa7b8',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 5],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.5,
          },
        });
      }

      if (!map.getSource('nb-route')) {
        map.addSource('nb-route', { type: 'geojson', data: this.routeFeature() });
        map.addLayer({
          id: 'nb-route-casing',
          type: 'line',
          source: 'nb-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.7 },
        });
        map.addLayer({
          id: 'nb-route-line',
          type: 'line',
          source: 'nb-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#007aff', 'line-width': 5.5, 'line-opacity': 0.95 },
        });
      }

      // Globe projection — the Google-Earth look when zoomed way out.
      map.setProjection({ type: 'globe' });

      // A style switch mid-navigation must not lose the drawn route.
      if (this.routeCoords) this.pushRouteData();
    } catch (e) {
      console.warn('map style enhancement failed', e);
    }
  }

  private routeFeature(): Feature {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: this.routeCoords ?? [] },
    };
  }

  private pushRouteData(): void {
    const source = this.map?.getSource('nb-route') as GeoJSONSource | undefined;
    source?.setData(this.routeFeature());
  }

  // --- streams ---------------------------------------------------------------

  private onPosition(pos: GpsPosition | null): void {
    if (!this.map) return;
    if (!pos) return;
    if (!this.userMarker) {
      const el = document.createElement('div');
      el.className = 'user-dot';
      el.style.width = '24px';
      el.style.height = '24px';
      el.innerHTML = '<div class="nb-halo"></div><div class="nb-dot"></div>';
      this.userMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([pos.lng, pos.lat])
        .addTo(this.map);
    } else {
      this.userMarker.setLngLat([pos.lng, pos.lat]);
    }

    if (!this.gotFirstFix) {
      this.gotFirstFix = true;
      this.follow = true;
      this.map.jumpTo({ center: [pos.lng, pos.lat], zoom: 16 });
    } else if (
      this.follow &&
      (this.navState$.value.phase === 'navigating' || this.navState$.value.phase === 'rerouting')
    ) {
      this.map.easeTo({ center: [pos.lng, pos.lat], duration: 500 });
    }

    // While moving, swallow the part of the route already traveled.
    if (this.navState$.value.phase === 'navigating') this.trimRouteBehind(pos);
  }

  private onNavState(state: NavState): void {
    if (state.phase === 'navigating' || state.phase === 'rerouting') {
      this.chatOpen = false;
      if (this.voice.state === 'listening') this.voice.deactivate();
    }
    try {
      if (!this.map) return;

      const moving = state.phase === 'navigating' || state.phase === 'rerouting';
      // Tilt into a Waze-style 3D view while driving, flatten when done.
      if (moving && !this.pitched && this.styleReady) {
        this.pitched = true;
        this.map.easeTo({ pitch: 45, duration: 800 });
      } else if (!moving && this.pitched) {
        this.pitched = false;
        this.map.easeTo({ pitch: 0, duration: 600 });
      }

      if (state.route && state.phase !== 'idle') {
        this.drawRoute(state);
        if (state.phase === 'preview' && this.routeCoords && this.routeCoords.length > 1) {
          this.follow = false;
          const lons = this.routeCoords.map((c) => c[0]);
          const lats = this.routeCoords.map((c) => c[1]);
          this.map.fitBounds(
            [
              [Math.min(...lons), Math.min(...lats)],
              [Math.max(...lons), Math.max(...lats)],
            ],
            { padding: { top: 60, bottom: 60, left: 60, right: 120 }, duration: 800 }
          );
        }
      } else {
        this.clearRoute();
      }
    } catch (e) {
      console.warn('onNavState draw failed', e);
    }
  }

  private drawRoute(state: NavState): void {
    if (!this.map || !state.route) return;

    // The nav state re-emits on every GPS tick — only rebuild the line when
    // the route itself changed, otherwise the progressive trim gets undone.
    if (this.routePoints !== state.route.geometry) {
      this.routePoints = state.route.geometry;
      this.trimIndex = 0;
      this.routeCoords = this.routePoints.map((p) => [p.lng, p.lat] as [number, number]);
      this.pushRouteData();
    }

    const dest = state.route.destination;
    if (!this.destMarker) {
      const el = document.createElement('div');
      el.className = 'dest-pin';
      el.style.width = '26px';
      el.style.height = '34px';
      el.innerHTML = '<div class="nb-pin"></div>';
      this.destMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([dest.lng, dest.lat])
        .addTo(this.map);
    } else {
      this.destMarker.setLngLat([dest.lng, dest.lat]);
    }
  }

  /** Drop every vertex the user has already passed, Waze-style. */
  private trimRouteBehind(pos: GpsPosition): void {
    const pts = this.routePoints;
    if (!pts || !this.routeCoords || pts.length < 2) return;

    // Nearest vertex from the cursor onward (never moves backwards, so a
    // route that doubles back near the start can't stall the trim).
    let best = this.trimIndex;
    let bestD = Infinity;
    for (let i = this.trimIndex; i < pts.length; i++) {
      const d = haversineM(pos, pts[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.trimIndex = best;

    // The line now starts at the point on the incoming segment closest to us.
    const snapped =
      best > 0 ? snapToSegment(pos, pts[best - 1], pts[best]) : snapToSegment(pos, pts[0], pts[1]);
    this.routeCoords = [
      [snapped.lng, snapped.lat],
      ...pts.slice(best + 1).map((p) => [p.lng, p.lat] as [number, number]),
    ];
    this.pushRouteData();
  }

  private clearRoute(): void {
    this.routeCoords = null;
    this.pushRouteData();
    this.destMarker?.remove();
    this.destMarker = null;
    this.routePoints = null;
    this.trimIndex = 0;
  }

  private onMapEvent(ev: MapEvent): void {
    if (!this.map) return;
    this.placeMarkers.forEach((m) => m.remove());
    this.placeMarkers = [];
    if (ev.type === 'clear-places') return;
    if (ev.type === 'places') {
      const bounds: [number, number][] = [];
      for (const p of ev.places) {
        const el = document.createElement('div');
        el.className = 'place-dot';
        el.style.width = '16px';
        el.style.height = '16px';
        el.innerHTML = `<div class="nb-place"></div><div class="nb-place-label">${p.name}</div>`;
        this.placeMarkers.push(
          new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(this.map)
        );
        bounds.push([p.lng, p.lat]);
      }
      if (bounds.length === 1) {
        this.map.easeTo({ center: bounds[0], zoom: 16, duration: 600 });
      } else if (bounds.length > 1) {
        const lons = bounds.map((c) => c[0]);
        const lats = bounds.map((c) => c[1]);
        this.map.fitBounds(
          [
            [Math.min(...lons), Math.min(...lats)],
            [Math.max(...lons), Math.max(...lats)],
          ],
          { padding: 70, duration: 800, maxZoom: 16 }
        );
      }
    }
  }

  // --- actions -----------------------------------------------------------------

  async onPlaceSelected(place: PlaceResult): Promise<void> {
    await this.routeTo(place);
  }

  recenter(): void {
    const pos = this.location.position;
    if (!pos || !this.map) return;
    this.follow = true;
    this.map.easeTo({ center: [pos.lng, pos.lat], zoom: Math.max(this.map.getZoom(), 15), duration: 500 });
  }

  openChat(): void {
    if (this.chatLocked) return;
    this.chatOpen = true;
  }

  onMicToggle(): void {
    if (this.chatLocked) return;
    if (this.voice.state === 'listening') {
      void this.voice.stopTapToTalk();
      return;
    }
    this.chatOpen = true;
    void this.voice.startTapToTalk();
  }

  onChatClosed(): void {
    this.chatOpen = false;
  }

  /** Ask the OS for a GPS fix — shown when we have none. */
  enableLocation(): void {
    void this.location.startWatch();
  }

  async onStartNav(): Promise<void> {
    // Shared with the chat's Start button: sim drives the dot itself,
    // real navigation needs a fix.
    this.chatOpen = false;
    await this.chatActions.startPreviewedRoute();
  }

  onCancelNav(): void {
    this.voice.deactivate();
    this.sim.stop();
    this.nav.stopNavigation();
    this.follow = true;
  }

  private async onMapTap(at: { lat: number; lng: number }): Promise<void> {
    if (this.navState$.value.phase !== 'idle') return;
    if (!this.location.hasFix) {
      this.toast('Turn on your location to get a route there.');
      return;
    }
    await this.routeTo({ name: 'Dropped pin', detail: 'Tap on map', lat: at.lat, lng: at.lng });
  }

  private async routeTo(place: PlaceResult): Promise<void> {
    if (!this.location.hasFix) {
      await this.toast('Turn on your location to get a route there.');
      return;
    }
    if (!isWithinGeneralTinioServiceArea(place)) {
      await this.toast(
        `That place is ${formatDistance(distanceFromGeneralTinio(place))} from General Tinio — outside the service area.`
      );
      return;
    }
    const from = this.location.position!;
    try {
      this.routing$.next(true);
      const profile: RouteProfile = this.settings.profile;
      const route = await this.routing.getRoute(from, place, profile);
      this.nav.previewRoute(route);
    } catch (e) {
      this.toast(e instanceof Error ? e.message : 'Could not find a route there.');
    } finally {
      this.routing$.next(false);
    }
  }

  // --- community places ---------------------------------------------------------

  private async checkBackend(): Promise<void> {
    try {
      const health = await this.api.get<HealthResponse>('/api/health', 5000);
      this.backendOk = health.ok === true;
    } catch {
      this.backendOk = false;
    }
    this.cdr.markForCheck(); // zoneless: show/hide the backend warning banner
  }

  private async loadWeather(): Promise<void> {
    try {
      const pos = this.location.positionOrTownCenter;
      const w = await this.api.getParams<WeatherInfo & { city: string }>(
        '/api/weather',
        { lat: pos.lat.toFixed(5), lon: pos.lng.toFixed(5) },
        8000
      );
      this.weather$.next({ temp: w.temp, description: w.description });
    } catch {
      this.weather$.next(null);
    }
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2600,
      position: 'top',
      cssClass: 'nb-toast',
    });
    await t.present();
  }
}
