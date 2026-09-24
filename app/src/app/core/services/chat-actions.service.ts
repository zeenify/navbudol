import { Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';
import { PlaceResult, RouteProfile, RouteResult } from '../models';
import { LocationService } from './location.service';
import { NavigationService } from './navigation.service';
import { RoutingService } from './routing.service';
import { SettingsService } from './settings.service';
import { SimulationService } from './simulation.service';

/**
 * Turns chat-tap actions into real navigation: plot a route from a place
 * card, and jump to the map tab with navigation already running.
 */
@Injectable({ providedIn: 'root' })
export class ChatActionsService {
  constructor(
    private router: Router,
    private nav: NavigationService,
    private routing: RoutingService,
    private settings: SettingsService,
    private location: LocationService,
    private sim: SimulationService,
    private zone: NgZone,
    private toastCtrl: ToastController
  ) {}

  /** Route from the user to `place`; returns the plotted route or null. */
  async routeToPlace(place: PlaceResult): Promise<RouteResult | null> {
    if (!this.location.hasFix) {
      await this.toast('Turn on your location to get a route there.');
      return null;
    }
    const from = this.location.position!;
    if (place.distanceM != null && place.distanceM > 25000) {
      await this.toast('That place is too far from General Tinio for a route.');
      return null;
    }
    try {
      const profile: RouteProfile = this.settings.profile;
      const route = await this.routing.getRoute(from, place, profile);
      this.zone.run(() => this.nav.previewRoute(route));
      return route;
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not find a route there.');
      return null;
    }
  }

  /**
   * Start the previewed route: jumps to the map tab. With Simulate Travel
   * on it drives the dot itself; otherwise real GPS must be available.
   */
  async startPreviewedRoute(): Promise<void> {
    if (!this.nav.hasRoute) return;
    if (!this.settings.simMode && !this.location.hasFix) {
      await this.toast('Turn on your location to start navigating.');
      return;
    }
    await this.router.navigateByUrl('/tabs/map');
    this.zone.run(() => {
      this.nav.startNavigation();
      if (this.settings.simMode) {
        const route = this.nav.navState$.value.route;
        if (route) this.sim.start(route, this.settings.simSpeed$.value, this.settings.profile);
      }
    });
  }

  /** Show the previewed route on the map without starting. */
  async showOnMap(): Promise<void> {
    if (!this.nav.hasRoute) return;
    await this.router.navigateByUrl('/tabs/map');
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toastCtrl.create({
      message,
      duration: 2600,
      position: 'top',
      cssClass: 'nb-toast',
    });
    await t.present();
  }
}
