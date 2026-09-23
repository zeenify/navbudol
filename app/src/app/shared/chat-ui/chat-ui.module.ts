import { IonicModule } from '@ionic/angular/lazy';
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatMessagesComponent } from './chat-messages.component';
import { VoiceWaveComponent } from './voice-wave.component';

/** Shared chat rendering (bubbles + status chips + voice indicator) used by
 *  the map's slide-up sheet and the full Chat tab. */
@NgModule({
  imports: [IonicModule, CommonModule, FormsModule],
  declarations: [ChatMessagesComponent, VoiceWaveComponent],
  exports: [ChatMessagesComponent, VoiceWaveComponent],
})
export class ChatUiModule {}
