import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CharacterService } from '../core/services/character.service';
import { SettingsService, SimSpeed } from '../core/services/settings.service';
import { AuthService } from '../core/services/auth.service';
import { PilotRunService } from '../core/pilot/run.service';
import { PilotAuditEntry, auditClear, auditList } from '../core/pilot/audit';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage {
  readonly speeds: SimSpeed[] = [1, 2, 5, 10];
  pilotHistory: PilotAuditEntry[] = auditList();
  readonly pilotOn$ = this.pilot.enabled$;

  constructor(
    public settings: SettingsService,
    public characters: CharacterService,
    public auth: AuthService,
    private pilot: PilotRunService,
    private router: Router
  ) {}

  get character() {
    return this.characters.getSelected();
  }

  togglePilot(): void {
    this.pilot.setEnabled(!this.pilotOn$.value);
  }

  refreshPilotHistory(): void {
    this.pilotHistory = auditList();
  }

  clearPilotHistory(): void {
    auditClear();
    this.refreshPilotHistory();
  }

  pilotTime(ts: number): string {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
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

  openProfile(): void {
    void this.router.navigateByUrl(this.auth.currentUser ? '/profile/me' : '/auth');
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    void this.router.navigateByUrl('/auth', { replaceUrl: true });
  }
}
