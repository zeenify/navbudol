import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/lazy';
import { UserProfile } from '../core/models';
import { AuthService } from '../core/services/auth.service';
import { CommunityPlacesService } from '../core/services/community-places.service';

/**
 * Public contributor profile: what this neighbor added, photographed, and
 * said. Your own profile adds editing and the logout door.
 */
@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
  standalone: false,
})
export class ProfilePage implements OnInit {
  private route = inject(ActivatedRoute);
  public router = inject(Router);
  private auth = inject(AuthService);
  private community = inject(CommunityPlacesService);
  private toastCtrl = inject(ToastController);
  private cdr = inject(ChangeDetectorRef);

  profile: UserProfile | null = null;
  loading = true;
  error: string | null = null;
  isMe = false;
  editing = false;
  editName = '';
  editBio = '';
  editAvatar = '🙂';
  avatarChoices = ['🙂', '😎', '🧕', '🧔', '👩‍🍳', '👨‍🔧', '🦸', '🐱', '🌳', '☕', '🛺', '⭐'];

  get me() {
    return this.auth.currentUser;
  }

  ngOnInit(): void {
    const param = this.route.snapshot.paramMap.get('id');
    const id = !param || param === 'me' ? this.me?.id : param;
    if (!id) {
      this.error = 'Sign in to see profiles.';
      this.loading = false;
      return;
    }
    this.isMe = id === this.me?.id;
    void this.load(id);
  }

  async load(id: string): Promise<void> {
    try {
      this.profile = await this.community.profile(id);
      this.editName = this.profile.user.displayName;
      this.editBio = this.profile.user.bio;
      this.editAvatar = this.profile.user.avatar;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Could not load this profile.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  toggleEdit(): void {
    this.editing = !this.editing;
    this.cdr.markForCheck();
  }

  async saveProfile(): Promise<void> {
    if (!this.editName.trim()) return;
    try {
      await this.auth.updateProfile({
        displayName: this.editName.trim(),
        avatar: this.editAvatar,
        bio: this.editBio.trim(),
      });
      if (this.profile) {
        this.profile.user.displayName = this.editName.trim();
        this.profile.user.avatar = this.editAvatar;
        this.profile.user.bio = this.editBio.trim();
      }
      this.editing = false;
      await this.toast('Profile updated.');
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not save your profile.');
    }
    this.cdr.markForCheck();
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/auth', { replaceUrl: true });
  }

  joined(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2000, position: 'top', cssClass: 'nb-toast' });
    await t.present();
  }
}
