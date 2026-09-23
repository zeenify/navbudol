import { Component, EventEmitter, HostListener, Output } from '@angular/core';
import { CharacterService } from '../../../core/services/character.service';
import { VoiceAssistantService } from '../../../core/services/voice-assistant.service';
import { SpeechService } from '../../../core/services/speech.service';

/**
 * Floating mic button — HOLD to talk. Press starts recording immediately
 * (the map opens the chat so you can see it); release sends the audio.
 */
@Component({
  selector: 'app-mic-fab',
  templateUrl: './mic-fab.component.html',
  styleUrls: ['./mic-fab.component.scss'],
  standalone: false,
})
export class MicFabComponent {
  @Output() pressStart = new EventEmitter<void>();
  @Output() pressEnd = new EventEmitter<void>();

  readonly state$ = this.voice.state$;
  readonly partial$ = this.speech.partial$;
  readonly character = this.characters.getSelected();

  private pressed = false;

  constructor(
    private voice: VoiceAssistantService,
    private speech: SpeechService,
    private characters: CharacterService
  ) {}

  onDown(event: Event): void {
    event.preventDefault();
    if (this.pressed) return;
    this.pressed = true;
    this.pressStart.emit();
  }

  // Release anywhere (the FAB may be hidden mid-hold when the chat opens).
  @HostListener('document:pointerup')
  @HostListener('document:pointercancel')
  onUp(): void {
    if (!this.pressed) return;
    this.pressed = false;
    this.pressEnd.emit();
  }
}
