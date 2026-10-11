import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommunityPlacePhoto } from '../../core/models';

/**
 * One community photo tile with the right ownership actions surfaced:
 * creator curates the gallery; uploader (or creator) can delete.
 */
@Component({
  selector: 'app-photo-tile',
  standalone: false,
  template: `
    <div class="photo-tile">
      <img [src]="photo.url" [alt]="photo.caption || 'Community photo'" loading="lazy" />
      @if (photo.caption) {
        <div class="photo-caption">{{ photo.caption }}</div>
      }
      @if (photo.inGallery) {
        <div class="gallery-flag"><span class="material-symbols-rounded">star</span> In gallery</div>
      }
      @if (actions) {
        <button type="button" class="tile-menu" (click)="openMenu()" aria-label="Photo actions">
          <span class="material-symbols-rounded">more_horiz</span>
        </button>
      }
    </div>
  `,
  styles: [
    `
      .photo-tile {
        position: relative;
        border-radius: 14px;
        overflow: hidden;
        aspect-ratio: 1;
        background: #e7ecf3;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .photo-caption {
        position: absolute;
        left: 6px;
        right: 6px;
        bottom: 6px;
        font-size: 10px;
        color: #fff;
        background: rgba(16, 35, 63, 0.55);
        border-radius: 8px;
        padding: 2px 7px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .gallery-flag {
        position: absolute;
        top: 6px;
        left: 6px;
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: 10px;
        font-weight: 700;
        color: #8a5b00;
        background: rgba(255, 214, 102, 0.92);
        border-radius: 8px;
        padding: 2px 7px;
      }
      .gallery-flag .material-symbols-rounded {
        font-size: 12px;
      }
      .tile-menu {
        position: absolute;
        top: 4px;
        right: 4px;
        border: none;
        background: rgba(16, 35, 63, 0.55);
        color: #fff;
        border-radius: 50%;
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .tile-menu .material-symbols-rounded {
        font-size: 16px;
      }
    `,
  ],
})
export class PhotoTileComponent {
  @Input({ required: true }) photo!: CommunityPlacePhoto;
  @Input() actions = false;
  @Output() menu = new EventEmitter<void>();

  openMenu(): void {
    this.menu.emit();
  }
}
