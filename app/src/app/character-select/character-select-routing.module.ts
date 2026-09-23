import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CharacterSelectPage } from './character-select.page';

const routes: Routes = [
  {
    path: '',
    component: CharacterSelectPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class CharacterSelectPageRoutingModule {}
