import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  ChatApiResponse,
  ChatMessage,
  Character,
  GeminiContent,
  GeminiFunctionCall,
  GeminiPart,
  MapEvent,
  PlaceResult,
  RouteResult,
} from '../models';
import { formatDistance, formatDuration, haversineM } from '../geo.utils';
import { buildSystemPrompt, PromptContext } from '../constants/prompts';
import { BackendApiService } from './backend-api.service';
import { CharacterService } from './character.service';
import { ChatActionsService } from './chat-actions.service';
import { LocationService } from './location.service';
import { NavigationService } from './navigation.service';
import { PlacesService } from './places.service';
import { RoutingService } from './routing.service';
import { SettingsService } from './settings.service';
import { TtsService } from './tts.service';

/**
 * The AI brain (plan §7.5). Talks to OUR backend (/api/chat), never to
 * Google directly. The function-calling loop runs here on the device —
 * only the device knows the GPS and map state.
 *
 * Agentic flow: whatever the model says in a turn renders IMMEDIATELY
 * (so the user sees life right away), then tools run with visible status
 * chips, and tool result cards are added after the final response.
 */
@Injectable({ providedIn: 'root' })
export class GeminiService {
  /** Display-ready messages for chat UIs. */
  readonly messages$ = new BehaviorSubject<ChatMessage[]>([]);
  readonly thinking$ = new BehaviorSubject(false);
  /**
   * The transient thinking bubble: null = hidden, '' = plain dots, any
   * other string = dots + status text ("Searching for 7-Eleven…").
   */
  readonly thinkingLabel$ = new BehaviorSubject<string | null>(null);
  /** Map reactions to AI actions (search results on the map, etc.). */
  readonly mapEvents$ = new Subject<MapEvent>();

  private contents: GeminiContent[] = [];
  private nextId = 1;
  private lastAddress: string | null = null;
  /** Set when the AI returned several matching places — awaiting a pick. */
  private pendingChoice: PlaceResult[] | null = null;
  private pendingDisplay: Array<Omit<ChatMessage, 'id'>> = [];

  readonly functionDeclarations = [
    {
      name: 'search_places',
      description:
        'Search for a place by name or address. Use when the user wants to go somewhere specific.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Place name or address to search for' },
        },
        required: ['query'],
      },
    },
    {
      name: 'find_nearby_places',
      description:
        'Find nearby points of interest like restaurants, gas stations, ATMs, etc.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Type of place to find (e.g. restaurant, gas station, pharmacy)',
          },
          radius_meters: { type: 'number', description: 'Search radius in meters. Default 2000.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_directions',
      description: 'Calculate a route to a destination and show it on the map.',
      parameters: {
        type: 'object',
        properties: {
          place_name: { type: 'string', description: 'Name of the place to navigate to' },
        },
        required: ['place_name'],
      },
    },
    {
      name: 'start_navigation',
      description: 'Begin turn-by-turn navigation on the currently previewed route.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'stop_navigation',
      description: 'Stop current navigation and return to idle.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_trip_status',
      description: 'Get remaining distance, ETA, and next instruction for the current trip.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_weather',
      description:
        'Get the current weather at the user location (temperature, sky conditions). ' +
        'Use when the user asks about weather, rain, or whether to bring an umbrella.',
      parameters: { type: 'object', properties: {} },
    },
  ];

  constructor(
    private api: BackendApiService,
    private characters: CharacterService,
    private chatActions: ChatActionsService,
    private location: LocationService,
    private nav: NavigationService,
    private places: PlacesService,
    private routing: RoutingService,
    private settings: SettingsService,
    private tts: TtsService,
    private zone: NgZone
  ) {
    this.resetForCharacter(this.characters.getSelected());
    this.characters.selected$.subscribe((ch) => this.zone.run(() => this.resetForCharacter(ch)));
    // Keep a reverse-geocoded address warm for the AI context.
    // PlacesService only re-fetches when the user moved >200 m.
    this.location.position$.subscribe((pos) => {
      if (!pos) return;
      void this.places
        .reverseGeocode(pos)
        .then((a) => (this.lastAddress = a))
        .catch(() => undefined);
    });
  }

  /** New character = fresh conversation with their greeting. */
  resetForCharacter(character: Character): void {
    this.contents = [];
    this.pendingChoice = null;
    this.messages$.next([
      { id: this.nextId++, role: 'model', text: character.greeting, avatar: character.avatar },
    ]);
  }

  /**
   * Main entry: send user text, run the agentic function loop.
   * Resolves with the assistant's final line (spoken aloud by TTS).
   */
  async chat(userText: string): Promise<string> {
    const text = userText.trim();
    if (!text) return '';
    if (this.thinking$.value) return '';

    // Shortcut: a place list is on the table and the user picked one
    // ("the nearest", "the second one", "2") — no AI roundtrip needed.
    if (this.pendingChoice) {
      const picked = this.matchChoicePick(text);
      if (picked) {
        this.pushDisplay({ role: 'user', text });
        this.thinking$.next(true);
        try {
          return await this.routeToChoice(picked);
        } finally {
          this.thinking$.next(false);
        }
      }
    }

    this.pushDisplay({ role: 'user', text });
    this.contents.push({ role: 'user', parts: [{ text }] });
    const avatar = this.characters.getSelected().avatar;
    // One transient "thinking" bubble (avatar + dots) that follows the work:
    // plain dots while the model writes, status text while a tool runs.
    this.thinking$.next(true);
    this.thinkingLabel$.next('');

    try {
      for (let round = 0; round < 3; round++) {
        const response = await this.api.post<ChatApiResponse>('/api/chat', {
          system: this.systemPrompt(),
          contents: this.trimmedContents(),
          tools: [{ function_declarations: this.functionDeclarations }],
        });
        this.thinkingLabel$.next(null);

        // Whatever the model SAYS renders the moment it exists — an
        // acknowledgment before tools run, or the final answer at the end.
        const said = response.text?.trim() ?? '';

        if (response.functionCalls && response.functionCalls.length > 0) {
          if (said) this.pushDisplay({ role: 'model', text: said, avatar });
          // Echo Gemini's raw parts back verbatim — Gemini 3.x attaches a
          // thoughtSignature (and ids) that must round-trip untouched.
          this.contents.push({
            role: 'model',
            parts: response.parts ?? response.functionCalls.map((fc) => ({ functionCall: { name: fc.name, args: fc.args } })),
          });
          const responses: GeminiPart[] = [];
          for (const fc of response.functionCalls) {
            this.thinkingLabel$.next(this.statusLabelFor(fc));
            const result = await this.executeFunction(fc);
            responses.push({ functionResponse: { name: fc.name, response: result } });
          }
          this.contents.push({ role: 'user', parts: responses });
          this.thinkingLabel$.next('');
          continue;
        }

        if (said) {
          this.contents.push({
            role: 'model',
            parts: response.parts ?? [{ text: said }],
          });
          // Sync the voice: prepare the clip first, so the bubble appears
          // exactly when the character starts speaking it.
          const char = this.characters.getSelected();
          if (char.fishVoiceId) {
            this.thinkingLabel$.next('Getting the voice ready…');
            await this.tts.prepare(said, char);
          }
          this.thinkingLabel$.next(null);
          this.pushDisplay({ role: 'model', text: said, avatar });
          this.flushPendingDisplay();
          return said;
        }

        const reply = "I'm not sure what to say — try again?";
        this.contents.push({ role: 'model', parts: [{ text: reply }] });
        this.pushDisplay({ role: 'model', text: reply, avatar });
        this.flushPendingDisplay();
        return reply;
      }
      const fallback = 'I got a bit lost there — could you say that again?';
      this.pushDisplay({ role: 'model', text: fallback, avatar });
      this.flushPendingDisplay();
      return fallback;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn('chat failed', message);
      const friendly =
        message.includes('GEMINI_API_KEY') || message.includes('API key not valid')
          ? 'The Gemini key is missing or invalid — paste a fresh AI Studio key into backend/.env and restart the backend.'
          : 'Sorry, I had trouble reaching the AI. Try again in a moment.';
      this.pushDisplay({ role: 'model', text: friendly, error: true, avatar });
      this.flushPendingDisplay();
      return friendly;
    } finally {
      this.thinkingLabel$.next(null);
      this.thinking$.next(false);
    }
  }

  // --- place cards + choices --------------------------------------------------

  private statusLabelFor(fc: GeminiFunctionCall): string {
    switch (fc.name) {
      case 'search_places':
        return `Searching for “${String(fc.args['query'] ?? '')}”…`;
      case 'find_nearby_places':
        return `Looking for ${String(fc.args['query'] ?? '')} nearby…`;
      case 'get_directions':
        return `Finding the route to ${String(fc.args['place_name'] ?? '')}…`;
      case 'get_weather':
        return 'Checking the weather…';
      default:
        return 'Working on it…';
    }
  }

  /** Render what a place search turned up, and remember it for a pick. */
  private async presentPlaces(results: PlaceResult[]): Promise<void> {
    if (results.length === 0) return;
    const avatar = this.characters.getSelected().avatar;
    if (results.length === 1) {
      this.thinkingLabel$.next('Preparing your route…');
      const route = await this.chatActions.routeToPlace(results[0]);
      if (route) {
        this.pendingChoice = null;
        this.pendingDisplay.push({
          role: 'model',
          text: '',
          kind: 'route',
          avatar,
          route: this.routeCardData(results[0], route),
        });
        return;
      }
    }
    this.pendingChoice = results.length > 1 ? results : null;
    this.pendingDisplay.push({ role: 'model', text: '', kind: 'places', places: results, avatar });
  }

  private async routeToChoice(place: PlaceResult, messageId?: number): Promise<string> {
    const avatar = this.characters.getSelected().avatar;
    const route = await this.chatActions.routeToPlace(place);
    if (!route) return 'I could not find a route there.';
    this.pendingChoice = null;
    const routeData = this.routeCardData(place, route);
    if (messageId !== undefined) {
      this.messages$.next(
        this.messages$.value.map((message) =>
          message.id === messageId
            ? { ...message, kind: 'route' as const, text: '', places: undefined, route: routeData }
            : message
        )
      );
    } else {
      this.pushDisplay({ role: 'model', text: '', kind: 'route', avatar, route: routeData });
    }
    return `Route to ${place.name} is ready.`;
  }

  /** The user tapped a place in a result card. */
  async choosePlace(place: PlaceResult, messageId?: number): Promise<boolean> {
    if (this.thinking$.value) return false;
    this.pushDisplay({ role: 'user', text: place.name });
    this.thinking$.next(true);
    try {
      const result = await this.routeToChoice(place, messageId);
      return !result.startsWith('I could not');
    } finally {
      this.thinking$.next(false);
    }
  }

  /** Chat route card: start navigation (jumps to the map). */
  startPreviewedRoute(): Promise<void> {
    return this.chatActions.startPreviewedRoute();
  }

  /** Chat route card: view the plotted route on the map. */
  showRouteOnMap(): Promise<void> {
    return this.chatActions.showOnMap();
  }

  /** "nearest" / "second one" / "2" → the picked place, or null to pass to the AI. */
  private matchChoicePick(text: string): PlaceResult | null {
    const choices = this.pendingChoice;
    if (!choices || choices.length === 0) return null;
    const t = text.toLowerCase().trim();

    const byDistance = [...choices].sort((a, b) => (a.distanceM ?? 1e12) - (b.distanceM ?? 1e12));
    if (/\b(nearest|closest|shortest)\b/.test(t)) return byDistance[0];

    const ordinals = ['first', 'second', 'third', 'fourth', 'fifth'];
    for (let i = 0; i < ordinals.length; i++) {
      if (t.includes(ordinals[i]) && choices[i]) return choices[i];
    }
    const num = t.match(/\b(?:number\s*)?([1-5])\b/);
    if (num && (t.length <= 12 || /\b(option|choice|number|one)\b/.test(t))) {
      const idx = Number(num[1]) - 1;
      if (choices[idx]) return choices[idx];
    }
    // Exact name match against the listed options.
    const exact = choices.find((c) => c.name.toLowerCase() === t);
    return exact ?? null;
  }

  // --- function execution ---------------------------------------------------

  private async executeFunction(fc: GeminiFunctionCall): Promise<Record<string, unknown>> {
    const pos = this.location.position;
    try {
      switch (fc.name) {
        case 'search_places': {
          const query = String(fc.args['query'] ?? '');
          const results = await this.places.search(query, pos, 5);
          this.mapEvents$.next({ type: 'places', places: results });
          await this.presentPlaces(results);
          return {
            results: results.map((p) => this.placeSummary(p)),
            note:
              results.length > 1
                ? 'Several matching places were shown to the user as a list. Ask which one to navigate to.'
                : 'One place was found and its route is already ready. The user should open it from the route card; do not ask whether to plot it.',
          };
        }
        case 'find_nearby_places': {
          if (!pos) return { error: 'Location is off — the user must enable GPS first.' };
          const query = String(fc.args['query'] ?? '');
          const radius = Number(fc.args['radius_meters'] ?? 2000) || 2000;
          // Local dataset first: instant and reliable. Overpass is a
          // fallback for categories the dataset doesn't cover.
          let results = await this.places.nearbyLocal(query, pos, Math.max(radius * 2, 5000), 5);
          if (results.length === 0) {
            try {
              results = await this.places.nearby(query, pos, radius, 5);
            } catch {
              results = [];
            }
          }
          this.mapEvents$.next({ type: 'places', places: results });
          await this.presentPlaces(results);
          return {
            results: results.map((p) => this.placeSummary(p)),
            note:
              results.length > 1
                ? 'Several matching places were shown to the user as a list. Ask which one to navigate to.'
                : 'One place was found and its route is already ready. The user should open it from the route card; do not ask whether to plot it.',
          };
        }
        case 'get_directions': {
          if (!pos) return { error: 'Location is off — the user must enable GPS first.' };
          const placeName = String(fc.args['place_name'] ?? '');
          const hits = await this.places.search(placeName, pos, 6);
          // Never route to a far-away fuzzy match: only accept places that
          // are actually near the user (this is a town navigator).
          const MAX_ROUTE_M = 25000;
          const nearbyHits = hits
            .map((h) => ({ h, d: h.distanceM ?? haversineM(pos, h) }))
            .filter((x) => x.d <= MAX_ROUTE_M)
            .sort((a, b) => a.d - b.d);
          if (nearbyHits.length === 0) {
            return {
              error: `No place called "${placeName}" near the user. Suggest find_nearby_places instead of guessing.`,
            };
          }
          const dest = nearbyHits[0].h;
          const route = await this.routing.getRoute(pos, dest, this.settings.profile);
          this.mapEvents$.next({ type: 'clear-places' });
          this.nav.previewRoute(route);
          this.pendingChoice = null;
          this.pendingDisplay.push({
            role: 'model',
            text: '',
            kind: 'route',
            avatar: this.characters.getSelected().avatar,
            route: this.routeCardData(dest, route),
          });
          return {
            route_found: true,
            destination: dest.name,
            distance_km: Number((route.distanceM / 1000).toFixed(1)),
            eta_minutes: Math.max(1, Math.round(route.durationS / 60)),
            travel_mode: this.settings.profile === 'foot-walking' ? 'walking' : 'driving',
            other_matches: nearbyHits.length > 1 ? nearbyHits.slice(1).map((x) => x.h.name) : undefined,
          };
        }
        case 'start_navigation': {
          if (!this.nav.hasRoute) return { error: 'No route plotted yet. Get directions first.' };
          await this.chatActions.startPreviewedRoute();
          const s = this.nav.navState$.value;
          return {
            started: true,
            distance: formatDistance(s.remainingDistanceM),
            eta: formatDuration(s.remainingDurationS),
          };
        }
        case 'stop_navigation': {
          this.nav.stopNavigation();
          return { stopped: true };
        }
        case 'get_trip_status': {
          return { status: this.nav.tripStatusText() };
        }
        case 'get_weather': {
          const pos0 = this.location.positionOrTownCenter;
          const w = await this.api.get<{
            temp: number;
            feelsLike: number;
            description: string;
            city: string;
          }>(`/api/weather?lat=${pos0.lat}&lon=${pos0.lng}`);
          return {
            temperature_c: w.temp,
            feels_like_c: w.feelsLike,
            sky: w.description,
            location: w.city,
          };
        }
        default:
          return { error: `Unknown function: ${fc.name}` };
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private routeCardData(destination: PlaceResult, route: RouteResult) {
    return {
      destination,
      distanceM: route.distanceM,
      durationS: route.durationS,
      source: route.source,
      profile: route.profile,
      geometry: route.geometry,
      ascentM: route.ascentM,
    };
  }

  private placeSummary(p: PlaceResult): Record<string, unknown> {
    return {
      name: p.name,
      location: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
      distance: p.distanceM ? formatDistance(p.distanceM) : undefined,
    };
  }

  // --- prompt + history -------------------------------------------------------

  private systemPrompt(): string {
    const ctx: PromptContext = {
      position: this.location.position,
      address: this.lastAddress,
      nav: this.nav.navState$.value,
    };
    return buildSystemPrompt(this.characters.getSelected(), ctx);
  }

  private trimmedContents(): GeminiContent[] {
    const max = environment.maxChatHistory;
    if (this.contents.length <= max) return this.contents;
    let start = this.contents.length - max;
    // Never open with an orphan functionCall/functionResponse pair —
    // trim forward to the next plain user turn.
    while (start < this.contents.length) {
      const c = this.contents[start];
      const orphan =
        c.role === 'model'
          ? c.parts.some((p) => 'functionCall' in p)
          : c.parts.some((p) => 'functionResponse' in p);
      if (!orphan) break;
      start++;
    }
    return this.contents.slice(start);
  }

  private pushDisplay(msg: Omit<ChatMessage, 'id'>): void {
    this.messages$.next([...this.messages$.value, { id: this.nextId++, ...msg }]);
  }

  private flushPendingDisplay(): void {
    if (this.pendingDisplay.length === 0) return;
    const messages = this.pendingDisplay;
    this.pendingDisplay = [];
    this.messages$.next([
      ...this.messages$.value,
      ...messages.map((msg) => ({ id: this.nextId++, ...msg })),
    ]);
  }
}
