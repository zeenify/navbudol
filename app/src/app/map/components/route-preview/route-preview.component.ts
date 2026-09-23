import { Component } from '@angular/core';
import { EventEmitter, Output } from '@angular/core';
import { formatDistance, formatDuration } from '../../../core/geo.utils';
import { NavigationService } from '../../../core/services/navigation.service';

@Component({
  selector: 'app-route-preview',
  templateUrl: './route-preview.component.html',
  styleUrls: ['./route-preview.component.scss'],
  standalone: false,
})
export class RoutePreviewComponent {
  @Output() onStart = new EventEmitter<void>();
  @Output() onCancel = new EventEmitter<void>();

  constructor(private nav: NavigationService) {}

  get state() {
    return this.nav.navState$.value;
  }

  get distanceLabel(): string {
    return formatDistance(this.state.remainingDistanceM).replace(' meters', ' m').replace(' kilometers', ' km');
  }

  get durationLabel(): string {
    return formatDuration(this.state.remainingDurationS);
  }

  get ascentLabel(): string | null {
    const a = this.state.route?.ascentM;
    return a && a > 1 ? `↑ ${Math.round(a)} m climb` : null;
  }
}
