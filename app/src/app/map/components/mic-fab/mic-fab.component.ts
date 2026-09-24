import { Component, EventEmitter, Input, Output } from '@angular/core';
import { VoiceAssistantService } from '../../../core/services/voice-assistant.service';
import { SpeechService } from '../../../core/services/speech.service';

/**
 * Floating mic button — tap to talk. Recording stays active until stopped,
 * cancelled, or sent.
 */
@Component({
  selector: 'app-mic-fab',
  templateUrl: './mic-fab.component.html',
  styleUrls: ['./mic-fab.component.scss'],
  standalone: false,
})
export class MicFabComponent {
  @Input() disabled = false;
  @Output() voiceToggle = new EventEmitter<void>();

  readonly state$ = this.voice.state$;
  readonly partial$ = this.speech.partial$;

  constructor(
    private voice: VoiceAssistantService,
    private speech: SpeechService
  ) {}

  onTap(): void {
    if (this.disabled) return;
    this.voiceToggle.emit();
  }
}
