import { Injectable, NgZone, inject } from '@angular/core';
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
import { distanceFromGeneralTinio, isWithinGeneralTinioServiceArea } from '../service-area';
import { buildSystemPrompt, buildPilotSystemPrompt, PromptContext } from '../constants/prompts';
import { BackendApiService } from './backend-api.service';
import { CharacterService } from './character.service';
import { ChatActionsService } from './chat-actions.service';
import { LocationService } from './location.service';
import { NavigationService } from './navigation.service';
import { PlacesService } from './places.service';
import { CommunityPlacesService } from './community-places.service';
import { CommunityPlaceDetail } from '../models';
import { placeIconDef, PLACE_ICONS } from '../constants/place-icons';
import { RoutingService } from './routing.service';
import { SettingsService } from './settings.service';
import { TtsService } from './tts.service';
import { PilotRunService } from '../pilot/run.service';

const THREAD_KEY = 'navbudol.chat.thread';
const THREAD_LIMIT = 40;
const RUN_FLAG_KEY = 'navbudol.chat.running';

/** OpenAI-format tool declarations for the pilot's brains (River + fallback). */
export interface PilotToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

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
    {
      name: 'get_nearby_community_places',
      description:
        'List community-added places near the user with their ratings, likes and visit counts. ' +
        'Use when the user asks what is around, wants recommendations, or asks about places ' +
        'other neighbors added. Optional query filters by name or kind.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional filter: food, cafe, school, church…' },
        },
      },
    },
    {
      name: 'get_place_details',
      description:
        'Full community intel for ONE place: description, rating breakdown, like/dislike counts, ' +
        'photos, and recent comments with verified-visit badges. Use when the user asks whether a ' +
        'specific community place is good, legit, or worth visiting.',
      parameters: {
        type: 'object',
        properties: {
          place_name: { type: 'string', description: 'The community place name the user mentioned' },
        },
        required: ['place_name'],
      },
    },
  ];

  constructor(
    private api: BackendApiService,
    private characters: CharacterService,
    private chatActions: ChatActionsService,
    private location: LocationService,
    private nav: NavigationService,
    private places: PlacesService,
    private community: CommunityPlacesService,
    private routing: RoutingService,
    private settings: SettingsService,
    private tts: TtsService,
    private zone: NgZone,
    private pilot: PilotRunService
  ) {
    this.resetForCharacter(this.characters.getSelected());
    this.restoreThread();
    // selected$ is a BehaviorSubject — its first emission re-fires right
    // here and must NOT wipe the thread we just restored.
    let bootedCharacterId = this.characters.getSelected().id;
    this.messages$.subscribe((messages) => this.persistThread(messages));
    this.characters.selected$.subscribe((ch) => {
      if (ch.id === bootedCharacterId) return;
      bootedCharacterId = ch.id;
      this.zone.run(() => this.resetForCharacter(ch));
    });
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

  // --- thread persistence ------------------------------------------------------

  private persistThread(messages: ChatMessage[]): void {
    try {
      const slim = messages.slice(-THREAD_LIMIT).map(({ id, ...rest }) => {
        void id;
        return rest;
      });
      localStorage.setItem(THREAD_KEY, JSON.stringify(slim));
    } catch {
      /* quota — the thread is ephemeral in the worst case */
    }
  }

  private restoreThread(): void {
    let thread: ChatMessage[] = [];
    try {
      const saved = JSON.parse(localStorage.getItem(THREAD_KEY) || '[]');
      if (Array.isArray(saved) && saved.length > 0) {
        thread = (saved as Omit<ChatMessage, 'id'>[]).map((m) => ({ ...m, id: this.nextId++ }));
        this.messages$.next(thread);
      }
    } catch {
      /* corrupt thread — greeting stays */
    }
    // A run that never finished (app killed mid-flight) gets an honest note
    // instead of a dangling question.
    if (localStorage.getItem(RUN_FLAG_KEY) === '1') {
      localStorage.removeItem(RUN_FLAG_KEY);
      this.messages$.next([
        ...this.messages$.value,
        {
          id: this.nextId++,
          role: 'model',
          text: '(that last request never finished — ask again)',
          kind: 'notice',
          avatar: this.characters.getSelected().avatar,
        },
      ]);
    }
  }

  /**
   * Main entry: send user text, run the agentic function loop.
   * Resolves with the assistant's final line (spoken aloud by TTS).
   * With Pilot mode on, the message runs through the pilot loop — the
   * Gemini loop below stays the plain-chat path.
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

    if (this.pilot.enabled$.value) {
      this.thinking$.next(true);
      this.thinkingLabel$.next('');
      try {
        return await this.pilot.chat(text);
      } finally {
        this.thinkingLabel$.next(null);
        this.thinking$.next(false);
      }
    }

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

  /** Status chip label for a tool call — shared with the pilot loop. */
  statusLabelFor(fc: GeminiFunctionCall): string {
    switch (fc.name) {
      case 'search_places':
        return `Searching for “${String(fc.args['query'] ?? '')}”…`;
      case 'find_nearby_places':
        return `Looking for ${String(fc.args['query'] ?? '')} nearby…`;
      case 'get_directions':
        return `Finding the route to ${String(fc.args['place_name'] ?? '')}…`;
      case 'get_weather':
        return 'Checking the weather…';
      case 'get_nearby_community_places':
        return 'Checking community places…';
      case 'get_place_details':
        return `Reading neighbor reviews…`;
      default:
        return 'Working on it…';
    }
  }
  /** Render what a place search turned up, and remember it for a pick. */
  private async presentPlaces(results: PlaceResult[]): Promise<void> {
    if (results.length === 0) return;
    const avatar = this.characters.getSelected().avatar;
    if (results.length === 1 && isWithinGeneralTinioServiceArea(results[0])) {
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
    if (!isWithinGeneralTinioServiceArea(place)) {
      const message = `That place is ${formatDistance(distanceFromGeneralTinio(place))} from General Tinio — outside the service area.`;
      this.pushDisplay({ role: 'model', text: message, avatar });
      return message;
    }
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
          // Community places live in the town sweep cache (localStorage-first,
          // network behind it) — warm it before a cold-boot search so the
          // neighborhood's places never lose to remote geocodes.
          if (this.community.localPool().length === 0) {
            await this.community.ensureTownSweep().catch(() => undefined);
          }
          const results = await this.places.search(query, pos, 5);
          console.log(`[search_places] q="${query}" results=${results.length} [${results.map((r) => r.name).join('; ').slice(0, 120)}]`);
          this.mapEvents$.next({ type: 'places', places: results });
          await this.presentPlaces(results);
          return {
            results: results.map((p) => this.placeSummary(p)),
            note:
              results.length > 1
                ? 'Several matching places were shown to the user as a list. Ask which one to navigate to.'
                : results[0]?.outsideServiceArea
                  ? 'The only match is outside the General Tinio service area. Do not route there; explain the service-area limit.'
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
                : results[0]?.outsideServiceArea
                  ? 'The only match is outside the General Tinio service area. Do not route there; explain the service-area limit.'
                  : 'One place was found and its route is already ready. The user should open it from the route card; do not ask whether to plot it.',
          };
        }
        case 'get_directions': {
          if (!pos) return { error: 'Location is off — the user must enable GPS first.' };
          const placeName = String(fc.args['place_name'] ?? '');
          const hits = await this.places.search(placeName, pos, 6);
          // Never route to a far-away fuzzy match: only accept places that
          // are actually near the user (this is a town navigator).
          const serviceHits = hits.filter((hit) => isWithinGeneralTinioServiceArea(hit));
          if (serviceHits.length === 0) {
            return {
              error: `"${placeName}" is outside the General Tinio service area, so I cannot route there.`,
            };
          }
          const MAX_ROUTE_M = 25000;
          const nearbyHits = serviceHits
            .map((h) => ({ h, d: h.distanceM ?? haversineM(pos, h) }))
            .filter((x) => x.d <= MAX_ROUTE_M)
            .sort((a, b) => a.d - b.d);
          if (nearbyHits.length === 0) {
            return {
              error: `That place is too far from your current location. Try a place inside or near General Tinio.`,
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
        case 'get_nearby_community_places': {
          const query = String(fc.args['query'] ?? '').trim().toLowerCase();
          const pos = this.location.position;
          const pool = this.community.localPool();
          const scored = pool
            .map((p) => {
              const label = placeIconDef(p.icon)?.label ?? '';
              const hay = `${p.name} ${label}`.toLowerCase();
              const match = !query || query.split(/\s+/).some((w) => w.length > 2 && hay.includes(w));
              return { p, label, match, d: pos ? haversineM(pos, p) : (p.distanceM ?? 0) };
            })
            .filter((x) => x.match)
            .sort((a, b) => (b.p.rating.average ?? 0) * 10 + b.p.likes - ((a.p.rating.average ?? 0) * 10 + a.p.likes))
            .slice(0, 8);
          if (scored.length === 0) {
            return {
              places: [],
              note: query
                ? 'No community places match that nearby yet.'
                : 'No community places nearby yet — the user could add the first one.',
            };
          }
          return {
            places: scored.map(({ p, label, d }) => ({
              name: p.name,
              kind: label,
              rating: p.rating.average ?? null,
              rating_count: p.rating.count,
              likes: p.likes,
              dislikes: p.dislikes,
              photos: p.photoCount,
              comments: p.commentCount,
              distance_m: Math.round(d),
              creator: p.creator?.displayName ?? null,
            })),
            note:
              'These were added by neighbors. Higher rating + more likes + more comments = more trusted. ' +
              'Offer to navigate to one the user sounds interested in.',
          };
        }
        case 'get_place_details': {
          const name = String(fc.args['place_name'] ?? '').trim().toLowerCase();
          const match = this.community
            .localPool()
            .find((p) => p.name.toLowerCase().includes(name) || name.includes(p.name.toLowerCase()));
          if (!match) {
            return { error: `No community place named "${name}" is on the map around here.` };
          }
          const detail: CommunityPlaceDetail = await this.community.detail(match.id);
          return {
            name: detail.name,
            description: detail.description || null,
            rating: detail.rating,
            likes: detail.likes,
            dislikes: detail.dislikes,
            photos: detail.photoCount,
            created_by: detail.creator?.displayName ?? null,
            comments: detail.comments.slice(0, 6).map((c) => ({
              author: c.author?.displayName ?? 'Neighbor',
              text: c.text,
              verified_visit: c.verifiedVisit,
              age: this.relativeAge(c.createdAt),
            })),
            note:
              'Judge legitimacy honestly: comments with verified_visit=true come from people whose GPS ' +
              'proves they were there. Weight rating count and likes; say when evidence is thin.',
          };
        }
        default:
          return { error: `Unknown function: ${fc.name}` };
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // --- pilot integration -----------------------------------------------------
  // The pilot reuses this loop's tools, cards and map reactions. Gemini
  // stays the FALLBACK brain; River is primary (see core/pilot/run.service).

  /** The prompt context the pilot charter renders from. */
  promptContext(): PromptContext {
    return {
      position: this.location.position,
      address: this.lastAddress,
      nav: this.nav.navState$.value,
      placeLines: this.communityPlaceLines(),
    };
  }

  /** Public tool execution for the pilot loop — identical behavior to the
   *  plain chat loop (map events, result cards, error wrapping). */
  async runPilotTool(fc: GeminiFunctionCall): Promise<Record<string, unknown>> {
    return this.executeFunction(fc);
  }

  /** Push tool-result cards (places list / route) after a pilot tool call. */
  flushPendingCards(): void {
    this.flushPendingDisplay();
  }

  /** Thread display: push + in-place patch for pilot step rows. */
  pushDisplay(msg: Omit<ChatMessage, 'id'>): number {
    const id = this.nextId++;
    this.messages$.next([...this.messages$.value, { id, ...msg }]);
    return id;
  }

  patchDisplay(id: number, patch: Partial<ChatMessage>): void {
    this.messages$.next(this.messages$.value.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  /** Update a pilot driving-step row with per-command outcomes. */
  updatePilotRow(id: number, results: Array<{ ok: boolean; blocked?: boolean }>): void {
    const target = this.messages$.value.find((m) => m.id === id);
    if (!target?.pilot) return;
    const steps = target.pilot.steps.map((s, i) => {
      const r = results[i];
      if (!r) return s;
      return { label: s.label, status: (r.blocked ? 'blocked' : r.ok ? 'ok' : 'fail') as 'ok' | 'fail' | 'blocked' };
    });
    this.patchDisplay(id, { pilot: { ...target.pilot, steps } });
  }

  /** Weather for request_data lookups (same endpoint as get_weather). */
  async weatherAt(lat: number, lng: number): Promise<Record<string, unknown>> {
    const w = await this.api.get<{ temp: number; feelsLike: number; description: string; city: string }>(
      `/api/weather?lat=${lat}&lon=${lng}`
    );
    return { temperature_c: w.temp, feels_like_c: w.feelsLike, sky: w.description, location: w.city };
  }

  /**
   * The pilot's brain call. DeepSeek V4.1 Flash via River (stateless proxy,
   * no streaming) — with Gemini as the identical-behavior fallback on the
   * backend. The UI never distinguishes them beyond the app-log line.
   */
  async postBrain(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    tools: Array<{ type: 'function'; function: Record<string, unknown> }>
  ): Promise<{
    text: string | null;
    tool_calls: Array<{ name: string; arguments: Record<string, unknown> }> | null;
    brain: 'river' | 'gemini';
  }> {
    return this.api.post('/api/pilot/brain', { messages, tools }, 90000);
  }

  /** invoke_screen + request_data + the existing app tools, Gemini-style
   *  declarations (the run service wraps them for the OpenAI-format brain). */
  pilotToolDeclarations(): PilotToolDeclaration[] {
    const invokeScreen: PilotToolDeclaration = {
      name: 'invoke_screen',
      description:
        'Operate the NavBudol UI for the user. Batch related commands in one call and set explain to one short ' +
        "friendly sentence about what you are about to do. point/snapshot/scroll are free reads; the FIRST batch " +
        'containing click/input/select is held at the user\'s "Take the wheel" approval gate — send the call ' +
        'and let the gate ask, never also ask in words. There is NO goto/jump command: navigate ONLY by clicking ' +
        'real screen controls (tab bar, rows, back buttons). Controls marked [DESTRUCTIVE] are never pressed by ' +
        'you; do everything else the task needs, then hand the user that one press.',
      parameters: {
        type: 'object',
        properties: {
          explain: { type: 'string', description: "One short friendly sentence: what you're about to do and why." },
          commands: {
            type: 'array',
            description: 'The actions to perform, in order.',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['click', 'input', 'select', 'scroll', 'point', 'snapshot'] },
                ref: { type: 'integer', description: 'Element ref number from the LATEST snapshot.' },
                value: { type: 'string', description: 'input/select only: the text to type or the option to pick.' },
                direction: { type: 'string', enum: ['up', 'down'], description: 'scroll only.' },
              },
              required: ['action'],
            },
          },
        },
        required: ['explain', 'commands'],
      },
    };
    const requestData: PilotToolDeclaration = {
      name: 'request_data',
      description:
        'Read app facts without touching the screen: trip_status (active navigation), app_settings (dark/satellite/' +
        'simulate/speed/travel mode), recent_places (nearby community places), service_area, current_route, ' +
        'current_location, weather. Results are cached per run — a repeat returns the same data.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            enum: ['trip_status', 'app_settings', 'recent_places', 'service_area', 'current_route', 'current_location', 'weather'],
          },
          params: { type: 'object', description: 'Optional parameters for the query.', properties: {} },
        },
        required: ['query'],
      },
    };
    return [invokeScreen, requestData, ...(this.functionDeclarations as PilotToolDeclaration[])];
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
      outside_service_area: p.outsideServiceArea || undefined,
    };
  }

  // --- prompt + history -------------------------------------------------------

  private systemPrompt(): string {
    const ctx: PromptContext = {
      position: this.location.position,
      address: this.lastAddress,
      nav: this.nav.navState$.value,
      placeLines: this.communityPlaceLines(),
    };
    return buildSystemPrompt(this.characters.getSelected(), ctx);
  }

  /** Up to 6 nearby community places, best-signal first, into the prompt. */
  private communityPlaceLines(): string[] {
    const pos = this.location.position;
    return this.community
      .localPool()
      .map((p) => ({
        p,
        d: pos ? haversineM(pos, p) : (p.distanceM ?? 0),
        label: placeIconDef(p.icon)?.label ?? 'Place',
      }))
      .sort(
        (a, b) =>
          (b.p.rating.average ?? 0) * 10 + b.p.likes - ((a.p.rating.average ?? 0) * 10 + a.p.likes)
      )
      .slice(0, 6)
      .map(({ p, d, label }) => {
        const trust = p.rating.average ? `★${p.rating.average} (${p.rating.count})` : 'unrated';
        return `${p.name} — ${label}, ${trust}, ${p.likes} likes, ${p.photoCount} photos, ${formatDistance(d)} away`;
      });
  }

  /** Coarse age for comment lines handed to the model. */
  private relativeAge(iso: string): string {
    const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  /**
   * AI icon matching for the add-place flow: one cheap round trip that picks
   * the best library key for a description. Returns null on any failure —
   * the picker stays usable without it.
   */
  async matchIcon(description: string): Promise<string | null> {
    const text = description.trim();
    if (!text) return null;
    const keys = PLACE_ICONS.map((i) => `${i.key} (${i.label})`).join(', ');
    try {
      const res = await this.api.post<ChatApiResponse>(
        '/api/chat',
        {
          system:
            'You match place descriptions to icon keys from a fixed list. Reply with EXACTLY one key from the list and nothing else.',
          contents: [
            {
              role: 'user',
              parts: [{ text: `Place: "${text}"\n\nIcon keys:\n${keys}\n\nReply with only the single best key.` }],
            },
          ],
        },
        30000
      );
      const key = (res.text ?? '').trim().toLowerCase().replace(/[^a-z_]/g, '');
      return PLACE_ICONS.some((i) => i.key === key) ? key : null;
    } catch {
      return null;
    }
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
