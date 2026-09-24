import { Component, OnDestroy } from '@angular/core';
import { CharacterService } from '../core/services/character.service';
import { GeminiService } from '../core/services/gemini.service';
import { NavigationService } from '../core/services/navigation.service';
import { SpeechService } from '../core/services/speech.service';
import { TtsService } from '../core/services/tts.service';
import { VoiceAssistantService } from '../core/services/voice-assistant.service';

/** Full-page conversation (Tab 2). Shares state with the map's chat sheet. */
@Component({
  selector: 'app-chat',
  templateUrl: './chat.page.html',
  styleUrls: ['./chat.page.scss'],
  standalone: false,
})
export class ChatPage implements OnDestroy {
  draft = '';
  readonly voiceState$ = this.voice.state$;
  readonly partial$ = this.speech.partial$;

  get character() {
    return this.characters.getSelected();
  }

  get chatLocked(): boolean {
    return this.nav.phase === 'navigating' || this.nav.phase === 'rerouting' || this.gemini.thinking$.value;
  }

  get lockLabel(): string {
    return this.nav.phase === 'navigating' || this.nav.phase === 'rerouting'
      ? 'Cancel navigation to chat'
      : 'AI is thinking…';
  }

  constructor(
    public characters: CharacterService,
    private gemini: GeminiService,
    private nav: NavigationService,
    private tts: TtsService,
    private voice: VoiceAssistantService,
    private speech: SpeechService
  ) {}

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.chatLocked) return;
    this.draft = '';
    const reply = await this.gemini.chat(text);
    if (reply) void this.tts.speak(reply, this.character);
  }

  onMicTap(): void {
    if (this.chatLocked) return;
    if (this.voice.state === 'listening') {
      void this.voice.stopTapToTalk();
      return;
    }
    void this.voice.startTapToTalk();
  }

  stopMic(): void {
    void this.voice.stopTapToTalk();
  }

  cancelMic(): void {
    this.voice.cancelTapToTalk();
  }

  sendMic(): void {
    void this.voice.stopTapToTalk();
  }

  ngOnDestroy(): void {
    if (this.voice.state === 'listening') this.voice.cancelTapToTalk();
  }
}
