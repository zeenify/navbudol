import { Component } from '@angular/core';
import { AuthService } from './core/services/auth.service';
import { CommunityPlacesService } from './core/services/community-places.service';
import { GeminiService } from './core/services/gemini.service';
import { PlacesService } from './core/services/places.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {
  constructor(
    // Boot-time warmups: re-verify the session, warm the POI cache, sweep
    // all community places so search + the AI know the whole town, and
    // construct the chat thread service on EVERY boot route — its saved
    // thread + mid-run kill note must apply even when the app boots into
    // Settings or Chat (not where GeminiService would otherwise be built).
    auth: AuthService,
    places: PlacesService,
    community: CommunityPlacesService,
    gemini: GeminiService
  ) {
    void auth.restore();
    void places.ensureLocalIndex();
    void community.ensureTownSweep();
    void gemini;
  }
}
