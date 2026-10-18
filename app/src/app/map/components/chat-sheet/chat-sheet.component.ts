import { Component, EventEmitter, Input, OnDestroy, Output } from '@angular/core';
import { CharacterService } from '../../../core/services/character.service';
import { GeminiService } from '../../../core/services/gemini.service';
import { PilotRunService } from '../../../core/pilot/run.service';
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
  /** During navigation the sheet stays short so the map + banner stay visible. */
  @Input() compact = false;
  @Output() closed = new EventEmitter<void>();

  draft = '';
  readonly voiceState$ = this.voice.state$;
  readonly partial$ = this.speech.partial$;
  /** Pilot consent gate + mode toggle. */
  readonly consent$ = this.pilot.consent$;
  readonly pilotOn$ = this.pilot.enabled$;

  constructor(
    public characters: CharacterService,
    private gemini: GeminiService,
    private pilot: PilotRunService,
    private tts: TtsService,
    private voice: VoiceAssistantService,
    private speech: SpeechService
  ) {}

  get character() {
    return this.characters.getSelected();
  }

  get isLocked(): boolean {
    return this.gemini.thinking$.value;
  }

  get lockLabel(): string {
    return 'AI is thinking…';
  }

  togglePilot(): void {
    this.pilot.setEnabled(!this.pilotOn$.value);
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.isLocked) return;
    this.draft = '';
    const reply = await this.gemini.chat(text);
    if (reply) void this.tts.speak(reply, this.character);
  }

  approvePilot(): void {
    this.pilot.approve();
  }

  declinePilot(): void {
    this.pilot.decline();
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
