import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AppUser, AuthResponse, UserProfile } from '../models';
import { TOKEN_KEY, BackendApiService } from './backend-api.service';

/**
 * Session state for the community platform. The token lives in localStorage;
 * `currentUser$` replays the last known user so pages can render instantly
 * and re-verify against /auth/me on app start.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly currentUser$: BehaviorSubject<AppUser | null>;

  constructor(private api: BackendApiService) {
    let initial: AppUser | null = null;
    try {
      const raw = localStorage.getItem('navbudol.user');
      initial = raw ? (JSON.parse(raw) as AppUser) : null;
      if (initial && !localStorage.getItem(TOKEN_KEY)) initial = null;
    } catch {
      initial = null;
    }
    this.currentUser$ = new BehaviorSubject<AppUser | null>(initial);
  }

  get currentUser(): AppUser | null {
    return this.currentUser$.value;
  }

  get isLoggedIn(): boolean {
    return !!localStorage.getItem(TOKEN_KEY) && !!this.currentUser;
  }

  /** Resolve the stored token against the server; drops dead sessions. */
  async restore(): Promise<AppUser | null> {
    if (!localStorage.getItem(TOKEN_KEY)) return null;
    try {
      const user = await this.api.get<AppUser>('/api/auth/me', 8000);
      this.setUser(user);
      return user;
    } catch {
      this.clearSession();
      return null;
    }
  }

  async register(username: string, password: string, displayName?: string): Promise<AppUser> {
    const res = await this.api.post<AuthResponse>('/api/auth/register', {
      username,
      password,
      display_name: displayName || undefined,
    });
    this.acceptSession(res);
    return res.user;
  }

  async login(username: string, password: string): Promise<AppUser> {
    const res = await this.api.post<AuthResponse>('/api/auth/login', { username, password });
    this.acceptSession(res);
    return res.user;
  }

  async updateProfile(patch: { displayName?: string; avatar?: string; bio?: string }): Promise<AppUser> {
    const user = await this.api.patch<AppUser>('/api/auth/me', {
      display_name: patch.displayName,
      avatar: patch.avatar,
      bio: patch.bio,
    });
    this.setUser(user);
    return user;
  }

  async logout(): Promise<void> {
    try {
      await this.api.post('/api/auth/logout', {});
    } catch {
      /* session may already be gone server-side */
    }
    this.clearSession();
  }

  profile(userId: string): Promise<UserProfile> {
    return this.api.get<UserProfile>(`/api/users/${userId}`);
  }

  private acceptSession(res: AuthResponse): void {
    localStorage.setItem(TOKEN_KEY, res.token);
    this.setUser(res.user);
  }

  private setUser(user: AppUser): void {
    localStorage.setItem('navbudol.user', JSON.stringify(user));
    this.currentUser$.next(user);
  }

  private clearSession(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('navbudol.user');
    this.currentUser$.next(null);
  }
}

export type AuthState = Observable<AppUser | null>;
