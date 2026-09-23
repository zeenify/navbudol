import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CharacterService } from '../../../core/services/character.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { SpeechService } from '../../../core/services/speech.service';
import { TtsService } from '../../../core/services/tts.service';
import { VoiceAssistantService } from '../../../core/services/voice-assistant.service';

/** Slide-up frosted chat sheet on the map page. */
@Component({
  selector: 'app-chat-sheet',
  templateUrl: './chat-sheet.component.html',
  styleUrls: ['./chat-sheet.component.scss'],
  standalone: false,
})
export class ChatSheetComponent {
  @Input() open = false;
  @Output() closed = new EventEmitter<void>();

  draft = '';
  readonly voiceState$ = this.voice.state$;
  readonly partial$ = this.speech.partial$;

  private holding = false;

  constructor(
    public characters: CharacterService,
    private gemini: GeminiService,
    private tts: TtsService,
    private voice: VoiceAssistantService,
    private speech: SpeechService
  ) {}

  get character() {
    return this.characters.getSelected();
  }

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

  close(): void {
    // Releasing the mic / closing while recording shouldn't leave it live.
    if (this.voice.state === 'listening') this.voice.deactivate();
    this.closed.emit();
  }
}
