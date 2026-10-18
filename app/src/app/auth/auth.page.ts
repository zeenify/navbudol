import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';
import { randomAvatar } from '../core/constants/avatars';
import { AuthService } from '../core/services/auth.service';

/**
 * Sign in / create account — the front door of the community platform.
 * One screen, two modes; the app requires an identity before anything else.
 * NOTE: the app is zoneless — every state mutation needs markForCheck().
 */
@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrls: ['./auth.page.scss'],
  standalone: false,
})
export class AuthPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private toastCtrl = inject(ToastController);
  private cdr = inject(ChangeDetectorRef);

  mode: 'login' | 'register' = 'login';
  username = '';
  password = '';
  displayName = '';
  busy = false;
  error: string | null = null;

  switchMode(mode: 'login' | 'register'): void {
    this.mode = mode;
    this.error = null;
    this.cdr.markForCheck();
  }

  async submit(): Promise<void> {
    if (this.busy) return;
    const username = this.username.trim().toLowerCase();
    const password = this.password;
    if (!username || !password) {
      this.error = 'Fill in your username and password.';
      this.cdr.markForCheck();
      return;
    }
    this.busy = true;
    this.error = null;
    this.cdr.markForCheck();
    try {
      if (this.mode === 'register') {
        await this.auth.register({
          username,
          password,
          displayName: this.displayName.trim() || undefined,
          // every new neighbor starts with a curated avatar — no bare emoji
          avatar: randomAvatar(),
        });
      } else {
        await this.auth.login(username, password);
      }
      // Straight to the map — presenting an Ionic overlay mid-navigation
      // can trip the router transition under zoneless CD.
      await this.router.navigateByUrl('/tabs/map', { replaceUrl: true });
    } catch (e) {
      this.error = e instanceof Error ? e.message.replace(/^[^:]+:\s*/, '') : 'Something went wrong.';
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2000, position: 'top', cssClass: 'nb-toast' });
    await t.present();
  }
}
