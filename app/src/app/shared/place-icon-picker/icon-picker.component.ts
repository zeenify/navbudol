import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { COMMON_PLACE_ICONS, PLACE_ICONS, PlaceIconDef, searchPlaceIcons } from '../../core/constants/place-icons';

/**
 * The place-type picker: a shortcut grid of common categories plus a
 * searchable full library, so contributors can label anything.
 */
@Component({
  selector: 'app-icon-picker',
  standalone: false,
  template: `
    <div class="icon-picker">
      <div class="picker-search">
        <span class="material-symbols-rounded search-glyph">search</span>
        <input
          type="text"
          placeholder="Search icons — church, pharmacy, arcade…"
          [(ngModel)]="query"
          (ngModelChange)="onQueryChange()"
          autocomplete="off"
        />
      </div>
      <div class="picker-grid">
        @for (icon of shown; track icon.key) {
          <button
            type="button"
            class="picker-cell"
            [class.selected]="icon.key === selected"
            (click)="pick(icon)"
            [attr.aria-label]="icon.label"
          >
            <span class="material-symbols-rounded">{{ icon.key }}</span>
            <span class="picker-label">{{ icon.label }}</span>
          </button>
        }
        @if (shown.length === 0) {
          <div class="picker-empty">No icon matches — pick the closest one.</div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .picker-search {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(16, 35, 63, 0.05);
        border-radius: 12px;
        padding: 8px 12px;
        margin-bottom: 10px;
      }
      .search-glyph {
        font-size: 18px;
        color: #7c8aa0;
      }
      .picker-search input {
        flex: 1;
        border: none;
        background: transparent;
        outline: none;
        font-size: 14px;
        color: #10233f;
      }
      .picker-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(74px, 1fr));
        gap: 8px;
        max-height: 240px;
        overflow-y: auto;
        padding: 2px;
      }
      .picker-cell {
        border: 1.5px solid rgba(16, 35, 63, 0.1);
        background: #fff;
        border-radius: 14px;
        padding: 10px 4px 7px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .picker-cell .material-symbols-rounded {
        font-size: 24px;
        color: #3d4d63;
        font-variation-settings: 'FILL' 1;
      }
      .picker-label {
        font-size: 10px;
        color: #5b6b7f;
        text-align: center;
        line-height: 1.15;
      }
      .picker-cell.selected {
        border-color: #007aff;
        background: #eaf3ff;
        box-shadow: 0 3px 10px rgba(0, 122, 255, 0.25);
      }
      .picker-cell.selected .material-symbols-rounded {
        color: #007aff;
      }
      .picker-empty {
        grid-column: 1 / -1;
        font-size: 13px;
        color: #7c8aa0;
        text-align: center;
        padding: 16px 0;
      }
    `,
  ],
})
export class IconPickerComponent {
  @Input() selected: string | null = null;
  @Output() selectedChange = new EventEmitter<string>();

  query = '';
  shown: PlaceIconDef[] = COMMON_PLACE_ICONS;

  onQueryChange(): void {
    this.shown = searchPlaceIcons(this.query).slice(0, 60);
  }

  pick(icon: PlaceIconDef): void {
    this.selected = icon.key;
    this.selectedChange.emit(icon.key);
  }

  get librarySize(): number {
    return PLACE_ICONS.length;
  }
}
