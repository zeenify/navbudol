import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Character } from '../models';
import { BackendApiService, TtsResponse } from './backend-api.service';

interface SpeakJob {
  text: string;
  character: Character;
  resolve: () => void;
}

/**
 * TTS (plan §7.7): Fish Audio voices via our backend (cached MP3s),
 * played through Web Audio so per-character gain (Makima +16 dB) works.
 * Falls back to the browser's speechSynthesis when a character has no
 * Fish voice (NavBuddy for now) or when the backend/Fish fails.
 */
@Injectable({ providedIn: 'root' })
export class TtsService {
  readonly isSpeaking$ = new BehaviorSubject(false);

  private queue: SpeakJob[] = [];
  private processing = false;
  private audioCtx: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  /** Synthesized-but-not-yet-played clip (see prepare()). */
  private prepared: { text: string; voiceId: string; res: TtsResponse } | null = null;

  constructor(private api: BackendApiService) {}

  /**
   * Synthesize NOW without playing — used so a chat reply appears exactly
   * when its voice is ready. speak() picks the prepared clip up instantly.
   */
  async prepare(text: string, character: Character): Promise<boolean> {
    const clean = (text ?? '').trim();
    if (!clean || !character.fishVoiceId) return false;
    try {
      const res = await this.api.post<TtsResponse>('/api/tts', {
        text: clean,
        reference_id: character.fishVoiceId,
      });
      this.prepared = { text: clean, voiceId: character.fishVoiceId, res };
      return true;
    } catch {
      return false;
    }
  }

  /** Enqueue; plays one at a time. Resolves when this text finishes. */
  speak(text: string, character: Character): Promise<void> {
    const clean = (text ?? '').trim();
    if (!clean) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.queue.push({ text: clean, character, resolve });
      void this.process();
    });
  }

  /** Interrupt: stop current audio, drop everything queued. */
  stop(): void {
    const waiting = this.queue;
    this.queue = [];
    waiting.forEach((j) => j.resolve());
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        /* already stopped */
      }
      this.currentSource = null;
    }
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* no speechSynthesis */
    }
    this.isSpeaking$.next(false);
  }

  // --- queue ----------------------------------------------------------------

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    this.isSpeaking$.next(true);
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      try {
        await this.speakOne(job);
      } catch (e) {
        console.warn('TTS failed, falling back to system voice', e);
        try {
          await this.speakWithSystemVoice(job.text);
        } catch {
          /* give up silently */
        }
      }
      job.resolve();
    }
    this.processing = false;
    this.isSpeaking$.next(false);
  }

  private async speakOne(job: SpeakJob): Promise<void> {
    if (!job.character.fishVoiceId) {
      // NavBuddy (or any voiceless character) — system voice directly.
      await this.speakWithSystemVoice(job.text);
      return;
    }
    // Use the clip prepared by prepare() when it matches (instant playback).
    let res: TtsResponse | null = null;
    if (
      this.prepared &&
      this.prepared.text === job.text &&
      this.prepared.voiceId === job.character.fishVoiceId
    ) {
      res = this.prepared.res;
      this.prepared = null;
    }
    if (!res) {
      res = await this.api.post<TtsResponse>('/api/tts', {
        text: job.text,
        reference_id: job.character.fishVoiceId,
      });
    }
    await this.playBase64(res.audioBase64, job.character.gainDb);
  }

  // --- Web Audio playback with per-character gain ---------------------------

  private async playBase64(audioBase64: string, gainDb: number): Promise<void> {
    const ctx = this.ensureCtx();
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const buffer = await ctx.decodeAudioData(bytes.buffer);

    return new Promise<void>((resolve, reject) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = Math.pow(10, gainDb / 20);
      src.connect(gain);
      gain.connect(ctx.destination);
      this.currentSource = src;
      src.onended = () => {
        if (this.currentSource === src) this.currentSource = null;
        resolve();
      };
      try {
        src.start();
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private ensureCtx(): AudioContext {
    if (!this.audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctor();
    }
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    return this.audioCtx;
  }

  // --- browser fallback -------------------------------------------------------

  private speakWithSystemVoice(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        resolve();
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'en-US';
      utter.rate = 1.0;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      synth.speak(utter);
    });
  }
}
