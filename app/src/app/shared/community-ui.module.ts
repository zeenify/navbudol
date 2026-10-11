import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconPickerComponent } from './place-icon-picker/icon-picker.component';
import { PhotoTileComponent } from './photo-tile/photo-tile.component';

/**
 * Shared community-UI atoms used by the add-place flow and the place page.
 * Declared once here so both lazy modules can import them.
 */
@NgModule({
  imports: [CommonModule, FormsModule],
  declarations: [IconPickerComponent, PhotoTileComponent],
  exports: [IconPickerComponent, PhotoTileComponent],
})
export class CommunityUiModule {}
