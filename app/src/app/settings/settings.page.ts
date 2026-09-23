import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CharacterService } from '../core/services/character.service';
import { SettingsService, SimSpeed } from '../core/services/settings.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage {
  readonly speeds: SimSpeed[] = [1, 2, 5, 10];

  constructor(
    public settings: SettingsService,
    public characters: CharacterService,
    private router: Router
  ) {}

  get character() {
    return this.characters.getSelected();
  }

  get dark() {
    return this.settings.dark;
  }

  get simSpeed(): SimSpeed {
    return this.settings.simSpeed$.value;
  }

  get simMode() {
    return this.settings.simMode;
  }

  get satellite() {
    return this.settings.satellite;
  }

  get profile() {
    return this.settings.profile;
  }

  toggleDark(v: boolean): void {
    this.settings.setDark(v);
  }

  toggleSatellite(v: boolean): void {
    this.settings.setSatellite(v);
  }

  setProfile(p: 'driving-car' | 'foot-walking'): void {
    this.settings.setProfile(p);
  }

  setSimSpeed(speed: unknown): void {
    const n = Number(speed) as SimSpeed;
    if ([1, 2, 5, 10].includes(n)) this.settings.setSimSpeed(n);
  }

  toggleSim(v: boolean): void {
    this.settings.setSimMode(v);
  }

  openCharacterSelect(): void {
    void this.router.navigateByUrl('/character-select');
  }
}
