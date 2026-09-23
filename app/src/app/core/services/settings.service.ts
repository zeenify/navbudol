import { BehaviorSubject } from 'rxjs';
import { Injectable } from '@angular/core';

export type SimSpeed = 1 | 2 | 5 | 10;
export type RouteProfile = 'driving-car' | 'foot-walking';
export type MapMode = 'light' | 'dark' | 'satellite';

/**
 * App-wide toggles (dark mode, sim settings). All persisted.
 * `dark` applies a `dark` class on <body>; map style = satellite override
 * else dark/light.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly dark$ = new BehaviorSubject(this.bool('navbudol.dark', false));
  readonly simSpeed$ = new BehaviorSubject<SimSpeed>(
    (Number(localStorage.getItem('navbudol.simSpeed')) || 2) as SimSpeed
  );
  readonly simMode$ = new BehaviorSubject(this.bool('navbudol.simMode', false));
  readonly satellite$ = new BehaviorSubject(this.bool('navbudol.satellite', false));
  readonly profile$ = new BehaviorSubject<RouteProfile>(
    (localStorage.getItem('navbudol.profile') as RouteProfile) || 'driving-car'
  );

  constructor() {
    this.applyDark(this.dark$.value);
  }

  get dark(): boolean {
    return this.dark$.value;
  }

  get simMode(): boolean {
    return this.simMode$.value;
  }

  get satellite(): boolean {
    return this.satellite$.value;
  }

  get profile(): RouteProfile {
    return this.profile$.value;
  }

  /** Effective MapTiler style: satellite wins, then dark/light. */
  get mapStyle(): MapMode {
    return this.satellite ? 'satellite' : this.dark ? 'dark' : 'light';
  }

  setSatellite(v: boolean): void {
    this.satellite$.next(v);
    localStorage.setItem('navbudol.satellite', v ? '1' : '0');
  }

  setProfile(p: RouteProfile): void {
    this.profile$.next(p);
    localStorage.setItem('navbudol.profile', p);
  }

  setSimMode(v: boolean): void {
    this.simMode$.next(v);
    localStorage.setItem('navbudol.simMode', v ? '1' : '0');
  }

  setDark(v: boolean): void {
    this.dark$.next(v);
    this.applyDark(v);
    localStorage.setItem('navbudol.dark', v ? '1' : '0');
  }

  setSimSpeed(x: SimSpeed): void {
    this.simSpeed$.next(x);
    localStorage.setItem('navbudol.simSpeed', String(x));
  }

  private applyDark(v: boolean): void {
    document.body.classList.toggle('dark', v);
  }

  private bool(key: string, fallback: boolean): boolean {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  }
}
