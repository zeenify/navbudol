import { IonicModule } from '@ionic/angular/lazy';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatPage } from './chat.page';
import { ChatPageRoutingModule } from './chat-routing.module';
import { ChatUiModule } from '../shared/chat-ui/chat-ui.module';

@NgModule({
  imports: [IonicModule, CommonModule, FormsModule, ChatUiModule, ChatPageRoutingModule],
  declarations: [ChatPage],
})
export class ChatPageModule {}
