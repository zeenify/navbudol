import { Component, EventEmitter, Output } from '@angular/core';
import { shortDistance } from '../../../core/geo.utils';
import { NavigationService } from '../../../core/services/navigation.service';

@Component({
  selector: 'app-nav-banner',
  templateUrl: './nav-banner.component.html',
  styleUrls: ['./nav-banner.component.scss'],
  standalone: false,
})
export class NavBannerComponent {
  @Output() onCancel = new EventEmitter<void>();

  constructor(private nav: NavigationService) {}

  get state() {
    return this.nav.navState$.value;
  }

  get remainingLabel(): string {
    return shortDistance(this.state.remainingDistanceM);
  }

  get etaLabel(): string {
    const mins = Math.max(0, Math.round(this.state.remainingDurationS / 60));
    const eta = new Date(Date.now() + this.state.remainingDurationS * 1000);
    const hh = eta.getHours() % 12 || 12;
    const mm = eta.getMinutes().toString().padStart(2, '0');
    return `${mins} min · Arrive ≈ ${hh}:${mm}`;
  }

}
