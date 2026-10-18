import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AvatarComponent } from './community-ui/avatar.component';
import { IconPickerComponent } from './place-icon-picker/icon-picker.component';
import { PhotoTileComponent } from './photo-tile/photo-tile.component';

/**
 * Shared community-UI atoms used by the add-place flow, the place page, and
 * the profile. Declared once here so both lazy modules can import them.
 */
@NgModule({
  imports: [CommonModule, FormsModule],
  declarations: [AvatarComponent, IconPickerComponent, PhotoTileComponent],
  exports: [AvatarComponent, IconPickerComponent, PhotoTileComponent],
})
export class CommunityUiModule {}
