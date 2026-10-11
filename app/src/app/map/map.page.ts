import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  NgZone,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { BehaviorSubject, map, Subscription } from 'rxjs';
import * as L from 'leaflet';
import { ActionSheetController, ToastController } from '@ionic/angular/lazy';
import { environment } from '../../environments/environment';
import { CommunityReport, GpsPosition, MapEvent, NavState, PlaceResult, RouteProfile } from '../core/models';
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
import { ReportsService } from '../core/services/reports.service';
import { distanceFromGeneralTinio, isWithinGeneralTinioServiceArea } from '../core/service-area';
import { formatDistance, haversineM, snapToSegment } from '../core/geo.utils';

interface WeatherInfo {
  temp: number;
  description: string;
}

/**
 * Leaflet map + MapTiler raster tiles @2x (crisp, keyless-free rendering —
 * no webview worker pipelines involved). All the smart features (ORS
 * routes with elevation, Geoapify search, weather) come from our backend.
 *
 * The user dot only appears after a REAL GPS fix (or a simulated one) —
 * the app never pretends to know where you are.
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
  /** Rain + a flood report nearby → one-tap "still flooded?" (null = hidden). */
  floodPrompt: (CommunityReport & { distanceM: number }) | null = null;
  private dismissedFloodIds = new Set<string>();
  /** Field-injected so existing constructor-injection files gain this without
   *  adding new prefer-inject lint errors to the baseline. */
  private reports = inject(ReportsService);
  private actionSheetCtrl = inject(ActionSheetController);

  get isTraveling(): boolean {
    return this.nav.phase === 'navigating' || this.nav.phase === 'rerouting';
  }

  get aiThinking(): boolean {
    return this.gemini.thinking$.value;
  }

  get chatLocked(): boolean {
    return this.isTraveling || this.aiThinking;
  }

  private map: L.Map | null = null;
  private userMarker: L.Marker | null = null;
  private destMarker: L.Marker | null = null;
  private routeLine: L.Polyline | null = null;
  private placesLayer: L.LayerGroup | null = null;
  private reportsLayer: L.LayerGroup | null = null;
  private tileLayer: L.TileLayer | null = null;
  private follow = true;
  private gotFirstFix = false;
  private subs: Subscription[] = [];

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
      this.settings.dark$.subscribe(() => this.zone.run(() => this.applyTiles())),
      this.settings.satellite$.subscribe(() => this.zone.run(() => this.applyTiles())),
      this.reports.reports$.subscribe(() => this.renderReports())
    );
  }

  ionViewDidEnter(): void {
    setTimeout(() => this.map?.invalidateSize(), 60);
    void this.location.startWatch();
    void this.checkBackend();
    void this.loadWeather();
    void this.reports.ensureReports(true);
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
    this.map?.remove();
    this.map = null;
  }

  // --- map init -------------------------------------------------------------

  private tileUrl(): string {
    const base = environment.maptilerStyles[this.settings.mapStyle];
    return `${base}/{z}/{x}/{y}@2x.png?key=${environment.maptilerKey}`;
  }

  private initMap(): void {
    this.map = L.map(this.mapDiv.nativeElement, {
      zoomControl: false,
      attributionControl: true,
    });
    this.tileLayer = L.tileLayer(this.tileUrl(), {
      attribution: '© <a href="https://www.maptiler.com/">MapTiler</a> © OpenStreetMap contributors',
      maxZoom: 19,
    });
    this.tileLayer.addTo(this.map);
    this.map.setView([environment.defaultCenter.lat, environment.defaultCenter.lng], environment.defaultZoom);

    // No user marker until a real fix arrives (see onPosition).

    this.placesLayer = L.layerGroup().addTo(this.map);
    this.reportsLayer = L.layerGroup().addTo(this.map);

    this.map.on('dragstart', () => this.zone.run(() => (this.follow = false)));
    this.map.on('click', (e: L.LeafletMouseEvent) =>
      this.zone.run(() => void this.onMapTap({ lat: e.latlng.lat, lng: e.latlng.lng }))
    );
  }

  private applyTiles(): void {
    if (!this.map || !this.tileLayer) return;
    this.tileLayer.setUrl(this.tileUrl());
  }

  // --- streams ---------------------------------------------------------------

  private onPosition(pos: GpsPosition | null): void {
    if (!this.map) return;
    if (!pos) return;
    if (!this.userMarker) {
      this.userMarker = L.marker([pos.lat, pos.lng], {
        icon: L.divIcon({
          className: 'user-dot',
          html: '<div class="nb-halo"></div><div class="nb-dot"></div>',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(this.map);
    }
    this.userMarker.setLatLng([pos.lat, pos.lng]);

    if (!this.gotFirstFix) {
      this.gotFirstFix = true;
      this.follow = true;
      this.map.setView([pos.lat, pos.lng], 16);
    } else if (this.follow && (this.navState$.value.phase === 'navigating' || this.navState$.value.phase === 'rerouting')) {
      this.map.panTo([pos.lat, pos.lng], { animate: true, duration: 0.5 });
    }

    // While moving, swallow the part of the route already traveled.
    if (this.navState$.value.phase === 'navigating') this.trimRouteBehind(pos);
    this.updateFloodPrompt();
  }

  private onNavState(state: NavState): void {
    if (state.phase === 'navigating' || state.phase === 'rerouting') {
      this.chatOpen = false;
      if (this.voice.state === 'listening') this.voice.deactivate();
    }
    try {
      if (!this.map) return;

      if (state.route && state.phase !== 'idle') {
        this.drawRoute(state);
        if (state.phase === 'preview' && this.routeLine) {
          this.follow = false;
          this.map.fitBounds(this.routeLine.getBounds(), { padding: [60, 120] });
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
    if (this.routePoints !== state.route.geometry || !this.routeLine) {
      this.routePoints = state.route.geometry;
      this.trimIndex = 0;
      const pts = state.route.geometry.map((p) => [p.lat, p.lng]) as [number, number][];

      if (!this.routeLine) {
        this.routeLine = L.polyline(pts, {
          color: '#007aff',
          weight: 6,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
          className: 'nb-route-line',
        }).addTo(this.map);
      } else {
        this.routeLine.setLatLngs(pts);
      }
    }

    const dest = state.route.destination;
    if (!this.destMarker) {
      this.destMarker = L.marker([dest.lat, dest.lng], {
        icon: L.divIcon({
          className: 'dest-pin',
          html: '<div class="nb-pin"></div>',
          iconSize: [26, 34],
          iconAnchor: [13, 34],
        }),
        interactive: false,
        zIndexOffset: 500,
      }).addTo(this.map);
    } else {
      this.destMarker.setLatLng([dest.lat, dest.lng]);
    }
  }

  /** Drop every vertex the user has already passed, Waze-style. */
  private trimRouteBehind(pos: GpsPosition): void {
    const pts = this.routePoints;
    if (!pts || !this.routeLine || pts.length < 2) return;

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
    const rest = pts.slice(best + 1).map((p) => [p.lat, p.lng] as [number, number]);
    this.routeLine.setLatLngs([[snapped.lat, snapped.lng], ...rest]);
  }

  private clearRoute(): void {
    this.routeLine?.remove();
    this.routeLine = null;
    this.destMarker?.remove();
    this.destMarker = null;
    this.routePoints = null;
    this.trimIndex = 0;
  }

  private onMapEvent(ev: MapEvent): void {
    if (!this.map || !this.placesLayer) return;
    if (ev.type === 'clear-places') {
      this.placesLayer.clearLayers();
      return;
    }
    if (ev.type === 'places') {
      this.placesLayer.clearLayers();
      const bounds: [number, number][] = [];
      for (const p of ev.places) {
        L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: 'place-dot',
            html: `<div class="nb-place"></div><div class="nb-place-label">${p.name}</div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          }),
        }).addTo(this.placesLayer);
        bounds.push([p.lat, p.lng]);
      }
      if (bounds.length === 1) {
        this.map.setView(bounds[0], 16, { animate: true });
      } else if (bounds.length > 1) {
        this.map.fitBounds(L.latLngBounds(bounds), { padding: [70, 70] });
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
    this.map.setView([pos.lat, pos.lng], Math.max(this.map.getZoom(), 15), { animate: true });
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

  // --- community reports --------------------------------------------------------

  /** Redraw every live report as a colored pin; confirmed ones get a bolder ring. */
  private renderReports(): void {
    if (!this.map || !this.reportsLayer) return;
    this.reportsLayer.clearLayers();
    for (const report of this.reports.reports$.value) {
      L.circleMarker([report.lat, report.lng], {
        radius: 7,
        color: '#ffffff',
        weight: (report.presenceCount ?? 0) > 0 ? 2.5 : 1.5,
        fillColor: this.reports.kindColor(report.kind),
        fillOpacity: 0.95,
      })
        .bindTooltip(`${report.kind} · tap for details`, { direction: 'top', offset: [0, -8] })
        .on('click', () => void this.openReportActions(report))
        .addTo(this.reportsLayer!);
    }
    this.updateFloodPrompt();
  }

  private async openReportActions(report: CommunityReport): Promise<void> {
    const sheet = await this.actionSheetCtrl.create({
      header: report.text,
      subHeader: `${report.kind} · ${this.reports.trustLabel(report)}`,
      buttons: [
        {
          text: '✅ Still true — confirm',
          handler: () => {
            void this.confirmReport(report);
          },
        },
        {
          text: '👎 Not true — dispute',
          handler: () => {
            void this.disputeReport(report);
          },
        },
        {
          text: 'Retire this report',
          role: 'destructive',
          handler: () => {
            void this.retireReport(report);
          },
        },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async confirmReport(report: CommunityReport): Promise<void> {
    try {
      const updated = await this.reports.confirmReport(report.id);
      await this.toast(
        this.reports.wasOnSite(updated) ? 'Confirmed on site — thank you!' : 'Confirmed — thank you!'
      );
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not confirm that report.');
    }
  }

  private async disputeReport(report: CommunityReport): Promise<void> {
    try {
      await this.reports.disputeReport(report.id);
      await this.toast('Marked as not true — noted.');
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not dispute that report.');
    }
  }

  private async retireReport(report: CommunityReport): Promise<void> {
    try {
      await this.reports.retireReport(report.id);
      await this.toast('Report retired.');
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not retire that report.');
    }
  }

  /** Step 6: raining + a flood report within 400 m → ask once, one tap. */
  private updateFloodPrompt(): void {
    const weather = this.weather$.value;
    const pos = this.location.position;
    const idle = this.navState$.value.phase === 'idle';
    const raining = !!weather && /rain|drizzle|thunder|shower/i.test(weather.description);
    const near =
      idle && raining && pos
        ? this.reports
            .reportsNear(pos, 400)
            .filter((r) => r.kind.toLowerCase().includes('flood') && !this.dismissedFloodIds.has(r.id))
        : [];
    const next = near[0] ?? null;
    if (next?.id !== this.floodPrompt?.id) {
      this.floodPrompt = next;
      this.cdr.markForCheck();
    }
  }

  async confirmFloodPrompt(): Promise<void> {
    const report = this.floodPrompt;
    if (!report) return;
    this.dismissedFloodIds.add(report.id);
    this.floodPrompt = null;
    this.cdr.markForCheck();
    await this.confirmReport(report);
  }

  dismissFloodPrompt(): void {
    if (this.floodPrompt) this.dismissedFloodIds.add(this.floodPrompt.id);
    this.floodPrompt = null;
    this.cdr.markForCheck();
  }

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
      this.updateFloodPrompt();
    } catch {
      this.weather$.next(null);
      this.updateFloodPrompt();
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
