import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { environment } from '../../../environments/environment';

export const TOKEN_KEY = 'navbudol.token';

/**
 * Thin client for OUR FastAPI backend. On device, CapacitorHttp is used so
 * plain-http localhost calls work from the https webview origin (no mixed
 * content, no CORS). In the browser it falls back to fetch (backend allows
 * CORS). Auth token is attached automatically when present.
 */
@Injectable({ providedIn: 'root' })
export class BackendApiService {
  private base = environment.backendBaseUrl;

  /** Absolute backend origin — for photo URLs that come back relative. */
  get baseUrl(): string {
    return this.base;
  }

  private get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  private authHeaders(): Record<string, string> {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async get<T>(path: string, timeoutMs = 15000): Promise<T> {
    const url = `${this.base}${path}`;
    if (this.isNative) {
      const res = await CapacitorHttp.get({
        url,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        headers: this.authHeaders(),
      });
      return this.unwrap<T>(res.status, res.data, url);
    }
    const res = await fetch(url, { headers: this.authHeaders() });
    const body = await res.text();
    return this.unwrap<T>(res.status, this.maybeJson(body), url);
  }

  /** GET with query params, e.g. getParams('/api/weather', {lat: 15.3, lon: 121.1}) */
  async getParams<T>(path: string, params: Record<string, string | number | undefined>, timeoutMs = 15000): Promise<T> {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return this.get<T>(qs ? `${path}?${qs}` : path, timeoutMs);
  }

  async post<T>(path: string, body: unknown, timeoutMs = 60000): Promise<T> {
    return this.send<T>('POST', path, body, timeoutMs);
  }

  async put<T>(path: string, body: unknown, timeoutMs = 30000): Promise<T> {
    return this.send<T>('PUT', path, body, timeoutMs);
  }

  async patch<T>(path: string, body: unknown, timeoutMs = 30000): Promise<T> {
    return this.send<T>('PATCH', path, body, timeoutMs);
  }

  async delete<T>(path: string, timeoutMs = 30000): Promise<T> {
    const url = `${this.base}${path}`;
    if (this.isNative) {
      const res = await CapacitorHttp.delete({
        url,
        headers: this.authHeaders(),
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      return this.unwrap<T>(res.status, res.data, url);
    }
    const res = await fetch(url, { method: 'DELETE', headers: this.authHeaders() });
    const text = await res.text();
    return this.unwrap<T>(res.status, this.maybeJson(text), url);
  }

  private async send<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown, timeoutMs: number): Promise<T> {
    const url = `${this.base}${path}`;
    if (this.isNative) {
      const res = await CapacitorHttp.request({
        url,
        method,
        data: body,
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      return this.unwrap<T>(res.status, res.data, url);
    }
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return this.unwrap<T>(res.status, this.maybeJson(text), url);
  }

  private maybeJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private unwrap<T>(status: number, data: unknown, url: string): T {
    if (status >= 400) {
      // A dead session anywhere in the app means: back to sign-in.
      if (status === 401 && !url.includes('/auth/login') && !url.includes('/auth/register')) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem('navbudol.user');
        window.location.hash = '';
        window.location.assign('/auth');
      }
      const detail =
        data && typeof data === 'object' && 'detail' in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>)['detail'])
          : `HTTP ${status}`;
      throw new Error(`${url.split('/api/')[1] ?? url}: ${detail}`);
    }
    return data as T;
  }
}

export interface HealthResponse {
  ok: boolean;
  gemini_key_set: boolean;
  fish_key_set: boolean;
}

export interface TtsResponse {
  audioBase64: string;
  cached: boolean;
}
