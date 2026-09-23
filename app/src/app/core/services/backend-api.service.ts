import { Injectable } from '@angular/core';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { environment } from '../../../environments/environment';

/**
 * Thin client for OUR FastAPI backend. On device, CapacitorHttp is used so
 * plain-http localhost calls work from the https webview origin (no mixed
 * content, no CORS). In the browser it falls back to fetch (backend allows
 * CORS).
 */
@Injectable({ providedIn: 'root' })
export class BackendApiService {
  private base = environment.backendBaseUrl;

  private get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async get<T>(path: string, timeoutMs = 15000): Promise<T> {
    const url = `${this.base}${path}`;
    if (this.isNative) {
      const res = await CapacitorHttp.get({
        url,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      return this.unwrap<T>(res.status, res.data, url);
    }
    const res = await fetch(url, { method: 'GET' });
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
    const url = `${this.base}${path}`;
    if (this.isNative) {
      const res = await CapacitorHttp.post({
        url,
        data: body,
        headers: { 'Content-Type': 'application/json' },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      });
      return this.unwrap<T>(res.status, res.data, url);
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
