import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  CommunityPlaceComment,
  CommunityPlaceDetail,
  CommunityPlacePhoto,
  CommunityPlaceSummary,
  UserProfile,
} from '../models';
import { environment } from '../../../environments/environment';
import { BackendApiService } from './backend-api.service';
import { AuthService } from './auth.service';

/**
 * Client for the community places platform. Keeps the latest nearby fetch in
 * memory so the map pins, search results, and the AI all read the same list.
 */
@Injectable({ providedIn: 'root' })
export class CommunityPlacesService {
  /** Community places around the last map position (server-sorted by distance). */
  readonly nearby$ = new BehaviorSubject<CommunityPlaceSummary[]>([]);

  /** Bumped by every mutation so the map + pages know to re-read. */
  readonly version$ = new BehaviorSubject(0);

  /** Everything seen this session — feeds name search and the AI context. */
  private cache = new Map<string, CommunityPlaceSummary>();
  private townSweep: Promise<void> | null = null;

  constructor(
    private api: BackendApiService,
    auth: AuthService
  ) {
    // A sweep that ran while signed out (or with a dead session) found
    // nothing — re-sweep whenever a user session becomes active.
    auth.currentUser$.subscribe((user) => {
      if (user) {
        this.townSweep = null;
        void this.ensureTownSweep();
      }
    });
  }

  /**
   * One town-wide fetch (25 km around the service-area center) so search and
   * the AI see every community place, not just the ones near the camera.
   */
  ensureTownSweep(): Promise<void> {
    if (!this.townSweep) {
      this.townSweep = this.refreshNearby(
        environment.defaultCenter.lat,
        environment.defaultCenter.lng,
        25000
      ).then(() => undefined);
    }
    return this.townSweep;
  }

  async refreshNearby(lat: number, lng: number, radiusM = 5000): Promise<CommunityPlaceSummary[]> {
    try {
      const places = await this.api.getParams<CommunityPlaceSummary[]>('/api/places/nearby', {
        lat,
        lng,
        radius_m: radiusM,
      });
      this.nearby$.next(places);
      for (const p of places) this.cache.set(p.id, p);
      return places;
    } catch {
      return this.nearby$.value;
    }
  }

  /** Community places as searchable PlaceResults (name search + AI tools). */
  localPool(): CommunityPlaceSummary[] {
    return Array.from(this.cache.values());
  }

  cachedPlace(placeId: string): CommunityPlaceSummary | null {
    return this.cache.get(placeId) ?? null;
  }

  detail(placeId: string): Promise<CommunityPlaceDetail> {
    return this.api.get<CommunityPlaceDetail>(`/api/places/${placeId}`);
  }

  async create(body: {
    name: string;
    icon: string;
    customIconUrl?: string | null;
    description: string;
    lat: number;
    lng: number;
    at: { lat: number; lng: number };
  }): Promise<CommunityPlaceSummary> {
    const place = await this.api.post<CommunityPlaceSummary>('/api/places', body);
    this.bump();
    return place;
  }

  /** Upload a custom icon image; returns the served URL. */
  uploadCustomIcon(dataUrl: string): Promise<{ url: string }> {
    const [meta, base64] = this.splitDataUrl(dataUrl);
    return this.api.post<{ url: string }>('/api/place-icons', {
      imageBase64: base64,
      mimeType: meta.mimeType,
    });
  }

  async update(
    placeId: string,
    patch: { name?: string; description?: string; icon?: string }
  ): Promise<CommunityPlaceSummary & { description: string }> {
    const place = await this.api.patch<CommunityPlaceSummary & { description: string }>(
      `/api/places/${placeId}`,
      patch
    );
    this.bump();
    return place;
  }

  async retire(placeId: string): Promise<void> {
    await this.api.delete(`/api/places/${placeId}`);
    this.bump();
  }

  async addPhoto(
    placeId: string,
    dataUrl: string,
    caption: string,
    at?: { lat: number; lng: number }
  ): Promise<CommunityPlacePhoto> {
    const [meta, base64] = this.splitDataUrl(dataUrl);
    const photo = await this.api.post<CommunityPlacePhoto>(`/api/places/${placeId}/photos`, {
      imageBase64: base64,
      mimeType: meta.mimeType,
      caption,
      at,
    });
    this.bump();
    return photo;
  }

  deletePhoto(placeId: string, photoId: string): Promise<void> {
    return this.api.delete(`/api/places/${placeId}/photos/${photoId}`).then(() => this.bump());
  }

  setPhotoInGallery(placeId: string, photoId: string, inGallery: boolean): Promise<CommunityPlacePhoto> {
    return this.api
      .post<CommunityPlacePhoto>(`/api/places/${placeId}/photos/${photoId}/gallery`, {
        in_gallery: inGallery,
      })
      .then((p) => {
        this.bump();
        return p;
      });
  }

  async addComment(
    placeId: string,
    text: string,
    imageDataUrl?: string
  ): Promise<CommunityPlaceComment> {
    const body: Record<string, unknown> = { text };
    if (imageDataUrl) {
      const [meta, base64] = this.splitDataUrl(imageDataUrl);
      body['imageBase64'] = base64;
      body['mimeType'] = meta.mimeType;
    }
    const comment = await this.api.post<CommunityPlaceComment>(
      `/api/places/${placeId}/comments`,
      body
    );
    this.bump();
    return comment;
  }

  deleteComment(placeId: string, commentId: string): Promise<void> {
    return this.api.delete(`/api/places/${placeId}/comments/${commentId}`).then(() => this.bump());
  }

  async rate(placeId: string, stars: number): Promise<CommunityPlaceDetail['rating']> {
    return this.api.put(`/api/places/${placeId}/rating`, { stars });
  }

  async vote(
    placeId: string,
    value: 1 | -1 | 0
  ): Promise<{ likes: number; dislikes: number; myVote: number }> {
    return this.api.put(`/api/places/${placeId}/vote`, { value });
  }

  /** Records a GPS-backed visit (navigation arrival). Throws when not on site. */
  recordVisit(placeId: string, at: { lat: number; lng: number }): Promise<void> {
    return this.api.post(`/api/places/${placeId}/visit`, { at });
  }

  profile(userId: string): Promise<UserProfile> {
    return this.api.get<UserProfile>(`/api/users/${userId}`);
  }

  absoluteUrl(path: string): string {
    if (path.startsWith('http')) return path;
    return this.api.baseUrl + path;
  }

  private bump(): void {
    this.version$.next(this.version$.value + 1);
  }

  private splitDataUrl(dataUrl: string): [{ mimeType: string }, string] {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!match) throw new Error('Not an image data URL.');
    return [{ mimeType: match[1] }, match[2]];
  }
}
