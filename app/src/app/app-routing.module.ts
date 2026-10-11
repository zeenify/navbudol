import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

const routes: Routes = [
  { path: 'auth', loadChildren: () => import('./auth/auth.module').then(m => m.AuthPageModule) },
  {
    path: 'character-select',
    canActivate: [authGuard],
    loadChildren: () => import('./character-select/character-select.module').then(m => m.CharacterSelectPageModule)
  },
  {
    path: 'add-place',
    canActivate: [authGuard],
    loadChildren: () => import('./add-place/add-place.module').then(m => m.AddPlacePageModule)
  },
  {
    path: 'place/:id',
    canActivate: [authGuard],
    loadChildren: () => import('./place/place.module').then(m => m.PlacePageModule)
  },
  {
    path: 'profile/:id',
    canActivate: [authGuard],
    loadChildren: () => import('./profile/profile.module').then(m => m.ProfilePageModule)
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadChildren: () => import('./profile/profile.module').then(m => m.ProfilePageModule)
  },
  {
    path: '',
    canActivate: [authGuard],
    loadChildren: () => import('./tabs/tabs.module').then(m => m.TabsPageModule)
  },
  { path: '**', redirectTo: '/tabs/map' }
];
@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
