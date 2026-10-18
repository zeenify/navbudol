import { Component, Input } from '@angular/core';
import { isImageAvatar } from '../../core/constants/avatars';

/**
 * Renders a user avatar: a bundled image when the string is an asset/URL
 * path (the curated set), otherwise the legacy emoji string as text.
 */
@Component({
  selector: 'app-avatar',
  template: `
    @if (isImage(avatar)) {
      <img class="avatar-img" [src]="avatar" [alt]="name || 'avatar'" loading="lazy" />
    } @else {
      <span class="avatar-text">{{ avatar || '🙂' }}</span>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        flex: 0 0 auto;
      }
      .avatar-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .avatar-text {
        line-height: 1;
      }
    `,
  ],
  standalone: false,
})
export class AvatarComponent {
  /** Emoji string (legacy) or bundled avatar path. */
  @Input() avatar: string | null | undefined;
  @Input() name: string | null | undefined;

  isImage(avatar: string | null | undefined): boolean {
    return isImageAvatar(avatar);
  }
}
