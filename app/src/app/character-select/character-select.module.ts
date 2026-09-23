import { IonicModule } from '@ionic/angular/lazy';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CharacterSelectPage } from './character-select.page';
import { CharacterSelectPageRoutingModule } from './character-select-routing.module';

@NgModule({
  imports: [IonicModule, CommonModule, FormsModule, CharacterSelectPageRoutingModule],
  declarations: [CharacterSelectPage],
})
export class CharacterSelectPageModule {}
