import { Component } from '@angular/core';
import { AuthService } from './core/services/auth.service';
import { CommunityPlacesService } from './core/services/community-places.service';
import { PlacesService } from './core/services/places.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(
    // Boot-time warmups: re-verify the session, warm the POI cache, and sweep
    // all community places so search + the AI know the whole town.
    auth: AuthService,
    places: PlacesService,
    community: CommunityPlacesService
  ) {
    void auth.restore();
    void places.ensureLocalIndex();
    void community.ensureTownSweep();
  }
}
