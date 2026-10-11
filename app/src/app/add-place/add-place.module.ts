import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular/lazy';
import { RouterModule, Routes } from '@angular/router';
import { ChatUiModule } from '../shared/chat-ui/chat-ui.module';
import { CommunityUiModule } from '../shared/community-ui.module';
import { AddPlacePage } from './add-place.page';

const routes: Routes = [
  {
    path: '',
    component: AddPlacePage,
  },
];

@NgModule({
  imports: [IonicModule, CommonModule, FormsModule, RouterModule.forChild(routes), ChatUiModule, CommunityUiModule],
  declarations: [AddPlacePage],
})
export class AddPlacePageModule {}
