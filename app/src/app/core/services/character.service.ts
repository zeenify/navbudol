import { BehaviorSubject } from 'rxjs';
import { Injectable } from '@angular/core';
import { CHARACTERS } from '../constants/characters';
import { Character } from '../models';

const STORAGE_KEY = 'navbudol.character';

/** Character roster + selection, persisted in localStorage. */
@Injectable({ providedIn: 'root' })
export class CharacterService {
  readonly characters: Character[] = CHARACTERS;
  readonly selected$ = new BehaviorSubject<Character>(this.load());

  constructor() {}

  getAll(): Character[] {
    return this.characters;
  }

  getSelected(): Character {
    return this.selected$.value;
  }

  select(id: string): void {
    const found = this.characters.find((c) => c.id === id);
    if (!found) return;
    this.selected$.next(found);
    try {
      localStorage.setItem(STORAGE_KEY, found.id);
    } catch {
      /* storage unavailable — selection just won't persist */
    }
  }

  private load(): Character {
    try {
      const id = localStorage.getItem(STORAGE_KEY);
      const found = id ? this.characters.find((c) => c.id === id) : undefined;
      return found ?? this.characters.find((c) => c.isDefault) ?? this.characters[0];
    } catch {
      return this.characters.find((c) => c.isDefault) ?? this.characters[0];
    }
  }
}
