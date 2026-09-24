import { Component, EventEmitter, Input, OnDestroy, Output } from '@angular/core';
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
export class ChatSheetComponent implements OnDestroy {
  @Input() open = false;
  @Input() locked = false;
  @Output() closed = new EventEmitter<void>();

  draft = '';
  readonly voiceState$ = this.voice.state$;
  readonly partial$ = this.speech.partial$;

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

  get isLocked(): boolean {
    return this.locked || this.gemini.thinking$.value;
  }

  get lockLabel(): string {
    return this.locked ? 'Cancel navigation to chat' : 'AI is thinking…';
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.isLocked) return;
    this.draft = '';
    const reply = await this.gemini.chat(text);
    if (reply) void this.tts.speak(reply, this.character);
  }

  onMicTap(): void {
    if (this.isLocked) return;
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

  close(): void {
    if (this.voice.state === 'listening') this.voice.deactivate();
    this.closed.emit();
  }

  ngOnDestroy(): void {
    if (this.voice.state === 'listening') this.voice.cancelTapToTalk();
  }
}
