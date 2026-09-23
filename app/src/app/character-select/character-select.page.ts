import { ChangeDetectorRef, Component } from '@angular/core';
import { Location } from '@angular/common';
import { Character } from '../core/models';
import { CharacterService } from '../core/services/character.service';
import { TtsService } from '../core/services/tts.service';

@Component({
  selector: 'app-character-select',
  templateUrl: './character-select.page.html',
  styleUrls: ['./character-select.page.scss'],
  standalone: false,
})
export class CharacterSelectPage {
  previewingId: string | null = null;

  constructor(
    public characters: CharacterService,
    private tts: TtsService,
    private location: Location,
    private cdr: ChangeDetectorRef
  ) {}

  get selected(): Character {
    return this.characters.getSelected();
  }

  pick(character: Character): void {
    this.characters.select(character.id);
  }

  isSelected(character: Character): boolean {
    return this.selected.id === character.id;
  }

  preview(character: Character, event: Event): void {
    event.stopPropagation();
    this.previewingId = character.id;
    void this.tts.speak(character.greeting, character).then(() => {
      if (this.previewingId === character.id) this.previewingId = null;
      this.cdr.markForCheck(); // zoneless: repaint the Play/Preview button
    });
  }

  back(): void {
    this.location.back();
  }
}
