import {
  AfterViewChecked,
  Component,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
} from '@angular/core';
import { ChatMessage, PlaceResult } from '../../core/models';
import { CharacterService } from '../../core/services/character.service';
import { GeminiService } from '../../core/services/gemini.service';

@Component({
  selector: 'app-chat-messages',
  templateUrl: './chat-messages.component.html',
  styleUrls: ['./chat-messages.component.scss'],
  standalone: false,
})
export class ChatMessagesComponent implements AfterViewChecked {
  @Output() placeChosen = new EventEmitter<void>();
  @Output() routeMapRequested = new EventEmitter<void>();
  @ViewChild('scroller') scroller!: ElementRef<HTMLDivElement>;

  readonly messages$ = this.gemini.messages$;
  readonly thinkingLabel$ = this.gemini.thinkingLabel$;

  constructor(
    private gemini: GeminiService,
    public characters: CharacterService
  ) {}

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  distanceLabel(m?: number): string {
    if (!m && m !== 0) return '';
    return m < 1000 ? `${Math.round(m / 10) * 10} m away` : `${(m / 1000).toFixed(1)} km away`;
  }

  durationLabel(s: number): string {
    const min = Math.max(1, Math.round(s / 60));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
  }

  distanceKm(m: number): string {
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  }

  singlePlace(msg: ChatMessage): PlaceResult | null {
    return msg.places?.length === 1 ? msg.places[0] : null;
  }

  async pick(place: PlaceResult, messageId?: number): Promise<void> {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const selected = await this.gemini.choosePlace(place, messageId);
    if (selected) this.placeChosen.emit();
  }

  async showMap(): Promise<void> {
    await this.gemini.showRouteOnMap();
    this.routeMapRequested.emit();
  }

  private scrollToBottom(): void {
    const el = this.scroller?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
