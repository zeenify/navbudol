import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { VoiceAssistantState } from '../models';
import { CharacterService } from './character.service';
import { GeminiService } from './gemini.service';
import { NavigationService } from './navigation.service';
import { SpeechService } from './speech.service';
import { TtsService } from './tts.service';

/**
 * The conductor (plan §7.8): mic tap → STT → Gemini → TTS, plus direct
 * TTS for navigation alerts (they bypass the AI entirely).
 */
@Injectable({ providedIn: 'root' })
export class VoiceAssistantService {
  readonly state$ = new BehaviorSubject<VoiceAssistantState>('idle');

  constructor(
    private speech: SpeechService,
    private gemini: GeminiService,
    private tts: TtsService,
    private characters: CharacterService,
    private nav: NavigationService,
    private zone: NgZone
  ) {
    this.speech.final$.subscribe((text) => this.zone.run(() => void this.handleFinal(text)));
    // Nav announcements go straight to the voice, no AI involved.
    this.nav.alerts$.subscribe((alert) => {
      this.zone.run(() => void this.tts.speak(alert, this.characters.getSelected()));
    });
  }

  get state(): VoiceAssistantState {
    return this.state$.value;
  }

  /** The one handler for every mic tap. */
  activate(): void {
    switch (this.state) {
      case 'speaking':
        this.tts.stop();
        void this.startListening();
        break;
      case 'listening':
        this.speech.stop();
        break;
      case 'idle':
      case 'processing':
        void this.startListening();
        break;
    }
  }

  deactivate(): void {
    this.speech.stop();
    this.tts.stop();
    this.state$.next('idle');
  }

  /** Hold-to-talk: press — start recording right away. */
  async beginPushToTalk(): Promise<void> {
    if (this.state === 'speaking') this.tts.stop();
    this.state$.next('listening');
    try {
      await this.speech.startPushToTalk();
    } catch (e) {
      console.warn('PTT start failed', e);
      this.state$.next('idle');
    }
  }

  /** Hold-to-talk: release — send whatever was said to the AI. */
  async endPushToTalk(): Promise<void> {
    if (this.state !== 'listening') return;
    let text = '';
    try {
      text = await this.speech.stopPushToTalk();
    } catch (e) {
      console.warn('PTT stop failed', e);
    }
    if (!text) {
      this.state$.next('idle');
      return;
    }
    await this.handleFinal(text);
  }

  private async startListening(): Promise<void> {
    this.state$.next('listening');
    try {
      await this.speech.start();
    } catch (e) {
      console.warn('STT start failed', e);
      this.state$.next('idle');
    }
  }

  private async handleFinal(text: string): Promise<void> {
    this.state$.next('processing');
    try {
      const reply = await this.gemini.chat(text);
      if (reply) {
        this.state$.next('speaking');
        await this.tts.speak(reply, this.characters.getSelected());
      }
    } catch (e) {
      console.warn('voice loop failed', e);
    } finally {
      if (this.state === 'speaking' || this.state === 'processing') {
        this.state$.next('idle');
      }
    }
  }
}
