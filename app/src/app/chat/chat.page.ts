import { Component, HostListener } from '@angular/core';
import { CharacterService } from '../core/services/character.service';
import { GeminiService } from '../core/services/gemini.service';
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
export class ChatPage {
  draft = '';
  readonly voiceState$ = this.voice.state$;
  readonly partial$ = this.speech.partial$;

  get character() {
    return this.characters.getSelected();
  }

  private holding = false;

  constructor(
    public characters: CharacterService,
    private gemini: GeminiService,
    private tts: TtsService,
    private voice: VoiceAssistantService,
    private speech: SpeechService
  ) {}

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text) return;
    this.draft = '';
    const reply = await this.gemini.chat(text);
    if (reply) void this.tts.speak(reply, this.character);
  }

  onMicDown(event: Event): void {
    event.preventDefault();
    if (this.holding) return;
    this.holding = true;
    void this.voice.beginPushToTalk();
  }

  // Release anywhere ends the recording.
  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  onMicUp(): void {
    if (!this.holding) return;
    this.holding = false;
    void this.voice.endPushToTalk();
  }
}
