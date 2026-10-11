import { Component } from '@angular/core';
import { AuthService } from './core/services/auth.service';
import { PlacesService } from './core/services/places.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(
    // Boot-time refreshes: re-verify the stored session and warm the POI cache.
    auth: AuthService,
    places: PlacesService
  ) {
    void auth.restore();
    void places.ensureLocalIndex();
  }
}
