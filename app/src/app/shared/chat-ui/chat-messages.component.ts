import {
  AfterViewChecked,
  Component,
  ElementRef,
  ViewChild,
} from '@angular/core';
import { CharacterService } from '../../core/services/character.service';
import { GeminiService } from '../../core/services/gemini.service';

@Component({
  selector: 'app-chat-messages',
  templateUrl: './chat-messages.component.html',
  styleUrls: ['./chat-messages.component.scss'],
  standalone: false,
})
export class ChatMessagesComponent implements AfterViewChecked {
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

  pick(place: import('../../core/models').PlaceResult): void {
    void this.gemini.choosePlace(place);
  }

  start(): void {
    void this.gemini.startPreviewedRoute();
  }

  showMap(): void {
    void this.gemini.showRouteOnMap();
  }

  private scrollToBottom(): void {
    const el = this.scroller?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
