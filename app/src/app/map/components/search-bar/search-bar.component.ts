import { ChangeDetectorRef, Component, EventEmitter, Output } from '@angular/core';
import { PlaceResult } from '../../../core/models';
import { isSamePlace } from '../../../core/geo.utils';
import { PlacesService } from '../../../core/services/places.service';
import { LocationService } from '../../../core/services/location.service';

const RECENTS_KEY = 'navbudol.recentSearches';

@Component({
  selector: 'app-search-bar',
  templateUrl: './search-bar.component.html',
  styleUrls: ['./search-bar.component.scss'],
  standalone: false,
})
export class SearchBarComponent {
  @Output() placeSelected = new EventEmitter<PlaceResult>();

  results: PlaceResult[] = [];
  recents: string[] = this.loadRecents();
  showResults = false;
  searching = false;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private places: PlacesService,
    private location: LocationService,
    private cdr: ChangeDetectorRef
  ) {}

  onInput(event: { detail: { value?: string | null } }): void {
    const value = event.detail.value ?? '';
    if (this.debounce) clearTimeout(this.debounce);
    if (!value.trim()) {
      this.results = [];
      this.searching = false;
      return;
    }
    // Instant: curated landmarks + local index (no network)
    this.results = this.places.searchLocal(value, this.location.position);
    this.showResults = true;
    // Online results follow shortly and get merged in
    this.searching = true;
    this.debounce = setTimeout(() => void this.runSearch(value), 250);
  }

  onFocus(): void {
    this.showResults = true;
    void this.places.ensureLocalIndex();
  }

  async runSearch(query: string): Promise<void> {
    // This app is zoneless (no zone.js): state written after an `await` only
    // repaints if we mark the view dirty ourselves.
    try {
      const local = this.places.searchLocal(query, this.location.position);
      let remote: PlaceResult[] = [];
      try {
        remote = await this.places.search(query, this.location.position, 8);
      } catch {
        /* local results already shown */
      }
      // local first, then online entries our dataset doesn't already cover
      const fresh = remote.filter((r) => !local.some((l) => isSamePlace(l, r)));
      this.results = [...local, ...fresh].slice(0, 10);
      this.showResults = true;
    } finally {
      this.searching = false;
      this.cdr.markForCheck();
    }
  }

  select(place: PlaceResult): void {
    this.saveRecent(place.name);
    this.showResults = false;
    this.results = [];
    this.placeSelected.emit(place);
  }

  dismiss(): void {
    this.showResults = false;
    this.results = [];
  }

  get showRecents(): boolean {
    return this.recents.length > 0 && this.results.length === 0 && !this.searching;
  }

  searchRecent(q: string): void {
    void this.runSearch(q);
  }

  // --- recents ------------------------------------------------------------

  private saveRecent(name: string): void {
    this.recents = [name, ...this.recents.filter((r) => r !== name)].slice(0, 5);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(this.recents));
    } catch {
      /* ignore */
    }
  }

  private loadRecents(): string[] {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }
}
