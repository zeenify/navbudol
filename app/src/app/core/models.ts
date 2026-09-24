// NavBudol domain models.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GpsPosition extends LatLng {
  accuracy?: number;
  heading?: number | null;
  simulated?: boolean;
  timestamp: number;
}

export interface PlaceResult {
  name: string;
  detail?: string;
  lat: number;
  lng: number;
  type?: string;
  distanceM?: number;
}

export interface RouteStep {
  instruction: string;
  name: string;
  distanceM: number;
  durationS: number;
  maneuverType: string;
  maneuverModifier: string;
  location: LatLng;
  /** cumulative distance from route start to the END of this step */
  cumulativeDistanceM: number;
}

export interface RouteResult {
  geometry: LatLng[];
  steps: RouteStep[];
  distanceM: number;
  durationS: number;
  destination: PlaceResult;
  /** total climb in meters (ORS routes with elevation; undefined for OSRM) */
  ascentM?: number;
  /** which engine produced this route */
  source?: 'ors' | 'osrm';
  /** travel mode the route + timing are for */
  profile?: RouteProfile;
}

export type RouteProfile = 'driving-car' | 'foot-walking';

export type NavPhase = 'idle' | 'preview' | 'navigating' | 'rerouting' | 'arrived';

export interface NavState {
  phase: NavPhase;
  route: RouteResult | null;
  currentStepIndex: number;
  remainingDistanceM: number;
  remainingDurationS: number;
  distanceToNextManeuverM: number;
  nextInstruction: string;
  nextManeuverType: string;
  nextManeuverModifier: string;
}

export interface RouteCardData {
  destination: PlaceResult;
  distanceM: number;
  durationS: number;
  source?: string;
  profile?: string;
  geometry?: LatLng[];
  ascentM?: number;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'model';
  text: string;
  avatar?: string;
  error?: boolean;
  /** text (default) | places (result list) | route (ready-to-start trip) | status (transient chip) */
  kind?: 'text' | 'places' | 'route' | 'status';
  /** kind 'places': what the AI found */
  places?: PlaceResult[];
  route?: RouteCardData;
}

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Flexible part shape — Gemini 3.x parts carry extra fields
 * (functionCall.id, thoughtSignature) that MUST be echoed back verbatim,
 * so nothing here is closed. The backend returns its raw parts and the
 * conversation stores them untouched.
 */
export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
  [key: string]: unknown;
}

export interface ChatApiResponse {
  text: string | null;
  functionCalls: GeminiFunctionCall[] | null;
  /** Raw Gemini parts — echo these back to keep signatures intact. */
  parts?: GeminiPart[];
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Events that make the map react to things the AI (or other services) did. */
export type MapEvent =
  | { type: 'places'; places: PlaceResult[] }
  | { type: 'clear-places' }
  | { type: 'focus'; lat: number; lng: number };

export interface Character {
  id: string;
  /** display name ("Gojo") */
  name: string;
  /** "Gojo Satoru" — goes into the prompt */
  fullName: string;
  /** "Jujutsu Kaisen" — goes into the prompt; empty for NavBuddy */
  series: string;
  avatar: string;
  /** Fish Audio reference_id — empty = system TTS fallback */
  fishVoiceId: string;
  /** playback volume correction in dB (Makima ships with +16) */
  gainDb: number;
  /** one-line vibe for the picker card */
  tagline: string;
  greeting: string;
  navigationStart: string;
  navigationArrival: string;
  isDefault?: boolean;
}

export type VoiceAssistantState = 'idle' | 'listening' | 'processing' | 'speaking';
