import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Character, VoiceAssistantState } from '../models';
import { CharacterService } from './character.service';
import { GeminiService } from './gemini.service';
import { NavigationService } from './navigation.service';
import { SpeechService } from './speech.service';
import { TtsService } from './tts.service';

@Injectable({ providedIn: 'root' })
export class VoiceAssistantService {
  readonly state$ = new BehaviorSubject<VoiceAssistantState>('idle');

  private navigationCharacter: Character | null = null;

  constructor(
    private speech: SpeechService,
    private gemini: GeminiService,
    private tts: TtsService,
    private characters: CharacterService,
    private nav: NavigationService,
    private zone: NgZone
  ) {
    this.speech.final$.subscribe((text) => this.zone.run(() => void this.handleFinal(text)));
    this.nav.started$.subscribe(({ destination }) => {
      this.zone.run(() => {
        const character = this.characters.getSelected();
        this.navigationCharacter = character;
        const arrival = this.navigationLine(character, destination, 'arrival');
        void this.tts.prepare(arrival, character);
        void this.tts.speak(this.navigationLine(character, destination, 'started'), character);
      });
    });
    this.nav.arrived$.subscribe(({ destination }) => {
      this.zone.run(() => {
        const character = this.navigationCharacter ?? this.characters.getSelected();
        void this.tts.speak(this.navigationLine(character, destination, 'arrival'), character);
      });
    });
  }

  get state(): VoiceAssistantState {
    return this.state$.value;
  }

  private get navigationLocked(): boolean {
    return this.nav.phase === 'navigating' || this.nav.phase === 'rerouting';
  }

  activate(): void {
    if (this.navigationLocked || this.gemini.thinking$.value) return;
    if (this.state === 'listening') {
      void this.stopTapToTalk();
      return;
    }
    if (this.state === 'speaking') this.tts.stop();
    void this.startTapToTalk();
  }

  deactivate(): void {
    this.speech.cancel();
    this.tts.stop();
    this.state$.next('idle');
  }

  async startTapToTalk(): Promise<void> {
    if (this.navigationLocked || this.gemini.thinking$.value) return;
    if (this.state === 'speaking') this.tts.stop();
    this.state$.next('listening');
    try {
      await this.speech.startTapToTalk();
    } catch (e) {
      console.warn('Tap-to-talk start failed', e);
      this.state$.next('idle');
    }
  }

  async stopTapToTalk(): Promise<void> {
    if (this.state !== 'listening') return;
    let text = '';
    try {
      text = await this.speech.stopTapToTalk();
    } catch (e) {
      console.warn('Tap-to-talk stop failed', e);
    }
    if (!text) {
      this.state$.next('idle');
      return;
    }
    await this.handleFinal(text);
  }

  cancelTapToTalk(): void {
    if (this.state === 'listening') this.speech.cancel();
    this.state$.next('idle');
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

  private navigationLine(character: Character, destination: string, moment: 'started' | 'arrival'): string {
    const template = moment === 'started' ? character.navigationStart : character.navigationArrival;
    return template.replace('{destination}', destination);
  }
}
