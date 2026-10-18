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
  outsideServiceArea?: boolean;
  /** set when this entry is a community-created place */
  communityPlaceId?: string;
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
  /** roads meeting at this step's junction (OSRM) — ≥3 means a real crossing */
  junctionRoads?: number;
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
  /** text (default) | places (result list) | route (ready-to-start trip) | status (transient chip) | pilot (driving steps) | notice (honest system note) */
  kind?: 'text' | 'places' | 'route' | 'status' | 'pilot' | 'notice';
  /** kind 'places': what the AI found */
  places?: PlaceResult[];
  route?: RouteCardData;
  /** kind 'pilot': what the pilot is doing to the page */
  pilot?: {
    explain: string;
    /** true for a silent read batch (snapshot/scroll) — renders as "Read page" */
    read?: boolean;
    steps: Array<{ label: string; status: 'run' | 'ok' | 'fail' | 'blocked' }>;
  };
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

// ============================================================================
// Community platform (accounts, places, social proof)
// ============================================================================

export interface UserRef {
  id: string;
  displayName: string;
  avatar: string;
}

export interface AppUser extends UserRef {
  username: string;
  bio: string;
  createdAt: string;
}

export interface RatingSummary {
  average: number | null;
  count: number;
  distribution: Record<string, number>;
}

export interface CommunityPlaceSummary {
  id: string;
  name: string;
  icon: string;
  customIconUrl?: string | null;
  lat: number;
  lng: number;
  creator: UserRef | null;
  rating: RatingSummary;
  photoCount: number;
  commentCount: number;
  likes: number;
  dislikes: number;
  createdAt: string;
  distanceM?: number;
  myRating?: number | null;
  myVote?: number;
  hasVisited?: boolean;
  isCreator?: boolean;
}

export interface CommunityPlacePhoto {
  id: string;
  url: string;
  caption: string;
  inGallery: boolean;
  createdAt: string;
  uploader: UserRef | null;
  /** set on upload responses: whether the upload proved a visit */
  verifiedVisit?: boolean;
}

export interface CommunityPlaceComment {
  id: string;
  text: string;
  /** optional photo attached to the comment (CDN URL or /uploads path) */
  imageUrl?: string | null;
  verifiedVisit: boolean;
  createdAt: string;
  author: UserRef | null;
  /** comment votes (like/dislike) */
  likes: number;
  dislikes: number;
  myVote?: number;
  /** replies live one level under a top-level comment */
  replies?: CommunityPlaceComment[];
}

export interface CommunityPlaceDetail extends CommunityPlaceSummary {
  description: string;
  gallery: CommunityPlacePhoto[];
  communityPhotos: CommunityPlacePhoto[];
  comments: CommunityPlaceComment[];
}

export interface UserProfile {
  user: AppUser;
  stats: { places: number; photos: number; comments: number; placesVisited: number };
  places: Array<{ id: string; name: string; icon: string; lat: number; lng: number; createdAt: string }>;
}

export interface AuthResponse {
  token: string;
  user: AppUser;
}
