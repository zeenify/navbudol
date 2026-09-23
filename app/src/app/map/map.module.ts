import { IonicModule } from '@ionic/angular/lazy';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MapPage } from './map.page';
import { MapPageRoutingModule } from './map-routing.module';
import { SearchBarComponent } from './components/search-bar/search-bar.component';
import { RoutePreviewComponent } from './components/route-preview/route-preview.component';
import { NavBannerComponent } from './components/nav-banner/nav-banner.component';
import { ChatSheetComponent } from './components/chat-sheet/chat-sheet.component';
import { MicFabComponent } from './components/mic-fab/mic-fab.component';
import { ChatUiModule } from '../shared/chat-ui/chat-ui.module';

@NgModule({
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    ChatUiModule,
    MapPageRoutingModule,
  ],
  declarations: [
    MapPage,
    SearchBarComponent,
    RoutePreviewComponent,
    NavBannerComponent,
    ChatSheetComponent,
    MicFabComponent,
  ],
})
export class MapPageModule {}
