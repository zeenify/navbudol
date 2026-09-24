import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

/**
 * STT: native Android SpeechRecognizer on device, Web Speech API in the
 * browser. Partial results stream into `partial$`.
 *
 * Two modes:
 *  - Tap-to-talk (the mic buttons): recording runs until the user stops,
 *    cancels, or sends. No silence auto-stop and no premature sends.
 *  - Legacy auto mode: 2 s of silence finalizes onto `final$`.
 */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  readonly isListening$ = new BehaviorSubject(false);
  readonly partial$ = new Subject<string>();
  readonly final$ = new Subject<string>();

  private lastPartial = '';
  private lastFinal = '';
  private finalized = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private webRec: unknown = null;
  private ptt = false;

  constructor(private zone: NgZone) {}

  async startPushToTalk(): Promise<void> {
    this.ptt = true;
    this.lastFinal = '';
    try {
      await this.start();
    } catch (error) {
      this.ptt = false;
      throw error;
    }
  }

  async stopPushToTalk(): Promise<string> {
    if (!this.isListening$.value) {
      this.ptt = false;
      return this.lastFinal || this.lastPartial.trim();
    }
    try {
      if (Capacitor.isNativePlatform()) {
        SpeechRecognition.stop().catch(() => undefined);
        this.finalize(this.lastPartial);
        return this.lastFinal || this.lastPartial.trim();
      }
      const rec = this.webRec as WebSpeechRecognition | null;
      rec?.stop();
      for (let waited = 0; waited < 700 && !this.lastFinal && this.isListening$.value; waited += 60) {
        await new Promise((r) => setTimeout(r, 60));
      }
      this.finalize(this.lastFinal || this.lastPartial);
      return (this.lastFinal || this.lastPartial).trim();
    } finally {
      this.ptt = false;
    }
  }

  async startTapToTalk(): Promise<void> {
    return this.startPushToTalk();
  }

  async stopTapToTalk(): Promise<string> {
    return this.stopPushToTalk();
  }

  async start(): Promise<void> {
    if (this.isListening$.value) return;
    this.lastPartial = '';
    this.lastFinal = '';
    this.finalized = false;
    this.isListening$.next(true);

    if (Capacitor.isNativePlatform()) {
      try {
        await SpeechRecognition.requestPermissions();
        // With partialResults: true, start() resolves immediately and
        // partial results stream through the 'partialResults' event
        // until stop() is called.
        await SpeechRecognition.start({
          language: 'en-US',
          partialResults: true,
          popup: false,
          maxResults: 2,
        });
        SpeechRecognition.addListener('partialResults', (data: { matches?: string[] }) => {
          this.zone.run(() => {
            const matches = data?.matches ?? [];
            const latest = matches[matches.length - 1];
            if (latest) {
              this.lastPartial = latest;
              this.partial$.next(latest);
              if (!this.ptt) this.armSilenceTimer();
            }
          });
        });
      } catch (e) {
        this.isListening$.next(false);
        throw e instanceof Error ? e : new Error(String(e));
      }
      return;
    }

    // --- Web Speech API fallback ---
    const SR =
      (window as unknown as Record<string, unknown>)['webkitSpeechRecognition'] ??
      (window as unknown as Record<string, unknown>)['SpeechRecognition'];
    if (!SR) {
      this.isListening$.next(false);
      throw new Error('Speech recognition is not supported in this browser — try Chrome.');
    }
    const rec = new (SR as new () => WebSpeechRecognition)();
    this.webRec = rec;
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event: WebSpeechEvent) => {
      this.zone.run(() => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            this.lastFinal = `${this.lastFinal} ${res[0].transcript}`.trim();
            if (!this.ptt) {
              this.finalize(this.lastFinal);
              return;
            }
            continue;
          }
          interim += res[0].transcript;
        }
        if (interim) {
          this.lastPartial = `${this.lastFinal} ${interim}`.trim();
          this.partial$.next(this.lastPartial);
          if (!this.ptt) this.armSilenceTimer();
        }
      });
    };
    rec.onerror = (ev: { error?: string }) => {
      this.zone.run(() => {
        if (ev.error === 'no-speech' || ev.error === 'aborted') {
          this.finalize(this.lastFinal || this.lastPartial);
        } else {
          this.isListening$.next(false);
        }
      });
    };
    rec.onend = () => {
      this.zone.run(() => this.finalize(this.lastFinal || this.lastPartial));
    };
    try {
      rec.start();
    } catch (e) {
      this.isListening$.next(false);
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  stop(): void {
    if (!this.isListening$.value) return;
    if (Capacitor.isNativePlatform()) {
      SpeechRecognition.stop().catch(() => undefined);
      this.finalize(this.lastPartial);
    } else {
      const rec = this.webRec as WebSpeechRecognition | null;
      rec?.stop();
      // onend fires finalize
    }
  }

  cancel(): void {
    this.ptt = false;
    this.lastPartial = '';
    this.lastFinal = '';
    this.finalized = true;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (!this.isListening$.value) return;
    this.isListening$.next(false);
    if (Capacitor.isNativePlatform()) {
      SpeechRecognition.stop().catch(() => undefined);
    } else {
      (this.webRec as WebSpeechRecognition | null)?.stop();
    }
  }

  private armSilenceTimer(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.zone.run(() => this.stop()), 2000);
  }

  private finalize(text: string): void {
    if (this.finalized) return;
    this.finalized = true;
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.isListening$.next(false);
    const clean = (text ?? '').trim();
    if (!clean) return;
    if (this.ptt) {
      this.lastFinal = clean;
    } else {
      this.final$.next(clean);
    }
  }
}

// Minimal structural types for the Web Speech API (not in all TS libs).
interface WebSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: WebSpeechEvent) => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface WebSpeechEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
