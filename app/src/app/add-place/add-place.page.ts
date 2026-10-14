import { ChangeDetectorRef, Component, ElementRef, inject, NgZone, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { ToastController } from '@ionic/angular/lazy';
import { PlaceResult } from '../core/models';
import { LocationService } from '../core/services/location.service';
import { CommunityPlacesService } from '../core/services/community-places.service';
import { GeminiService } from '../core/services/gemini.service';
import { placeIconDef } from '../core/constants/place-icons';

/**
 * Add a community place — a full flow, because this is the feature that
 * grows the map. Rule of the product: you can only place a pin where you
 * are physically standing, so the location IS your current GPS fix and the
 * geofence is checked server-side.
 */
@Component({
  selector: 'app-add-place',
  templateUrl: './add-place.page.html',
  styleUrls: ['./add-place.page.scss'],
  standalone: false,
})
export class AddPlacePage {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  private location = inject(LocationService);
  public community = inject(CommunityPlacesService);
  private gemini = inject(GeminiService);
  private router = inject(Router);
  private zone = inject(NgZone);
  private toastCtrl = inject(ToastController);
  private cdr = inject(ChangeDetectorRef);

  name = '';
  description = '';
  selectedIcon: string | null = null;
  customIconUrl: string | null = null;
  photos: string[] = []; // data URLs
  submitting = false;
  error: string | null = null;
  aiPicking = false;
  /** What the AI just picked — shown as explicit feedback, never silent. */
  aiPickResult: string | null = null;

  /** Feeds the mini preview map; identity-stable per fix. */
  previewPlace: PlaceResult | null = null;

  constructor() {
    void this.location.startWatch();
    // Zoneless CD: the page reads position through getters, so a fix that
    // arrives AFTER this page opened must still repaint it (otherwise the
    // form sits on "Getting your location…" forever).
    this.location.position$.subscribe(() => this.cdr.markForCheck());
  }

  get position() {
    return this.location.position;
  }

  get hasFix(): boolean {
    return this.location.hasFix && !!this.position;
  }

  /** Human label of the currently chosen icon (library key or custom image). */
  chosenIconLabel(): string {
    if (this.customIconUrl) return 'Your uploaded image';
    if (this.selectedIcon) return placeIconDef(this.selectedIcon)?.label ?? 'Custom icon';
    return 'None yet';
  }

  /** Accuracy pill copy — honest about what the phone knows. */
  accuracyLabel(): string | null {
    const pos = this.position;
    if (!pos) return null;
    return pos.accuracy ? `±${Math.round(pos.accuracy)} m` : null;
  }

  async pickIcon(key: string): Promise<void> {
    this.selectedIcon = key;
    this.customIconUrl = null;
    this.aiPickResult = null;
    this.cdr.markForCheck();
  }

  /** Uploaded a custom icon image — store it and prefer it over the library. */
  async pickCustomIcon(dataUrl: string): Promise<void> {
    try {
      const res = await this.community.uploadCustomIcon(dataUrl);
      this.customIconUrl = res.url;
      this.selectedIcon = null;
      this.aiPickResult = null;
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Could not upload that icon.';
    }
    this.cdr.markForCheck();
  }

  /**
   * AI matches the name/description to a LIBRARY icon (not generation — the
   * pin renders a crisp Material symbol that matches every other pin). The
   * result is announced in place so it never looks like the button did
   * nothing.
   */
  async aiPickIcon(): Promise<void> {
    if (this.aiPicking) return;
    const hint = `${this.name} ${this.description}`.trim();
    if (!hint) {
      this.error = 'Write the place name (or description) first, then let the AI pick.';
      this.cdr.markForCheck();
      return;
    }
    this.aiPicking = true;
    this.aiPickResult = null;
    this.error = null;
    this.cdr.markForCheck();
    const key = await this.gemini.matchIcon(hint);
    this.aiPicking = false;
    if (key) {
      this.selectedIcon = key;
      this.customIconUrl = null;
      this.aiPickResult = `AI picked “${placeIconDef(key)?.label ?? key}” for this place.`;
    } else {
      this.error = 'The AI could not pick an icon — choose one from the grid below.';
    }
    this.cdr.markForCheck();
  }

  async takePhoto(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        const photo = await Camera.getPhoto({
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Prompt,
          quality: 70,
          width: 1600,
        });
        if (photo.dataUrl) this.addPhoto(photo.dataUrl);
      } catch {
        /* user cancelled */
      }
      return;
    }
    // Browser: hidden file input (camera or library per the capture flag).
    this.fileInput.nativeElement.click();
  }

  onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') this.addPhoto(reader.result);
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  private addPhoto(dataUrl: string): void {
    this.zone.run(() => {
      if (this.photos.length < 6) this.photos.push(dataUrl);
      this.cdr.markForCheck();
    });
  }

  removePhoto(index: number): void {
    this.photos.splice(index, 1);
    this.cdr.markForCheck();
  }

  async submit(): Promise<void> {
    const pos = this.position;
    if (!this.hasFix || !pos) {
      this.error = 'Wait for a GPS fix — you can only add a place where you are.';
      return;
    }
    if (!this.name.trim()) {
      this.error = 'Give the place a name.';
      return;
    }
    if (!this.selectedIcon && !this.customIconUrl) {
      this.error = 'Pick an icon so neighbors recognize it on the map.';
      return;
    }
    this.submitting = true;
    this.error = null;
    try {
      const place = await this.community.create({
        name: this.name.trim(),
        icon: this.selectedIcon ?? 'location_on',
        customIconUrl: this.customIconUrl,
        description: this.description.trim(),
        lat: pos.lat,
        lng: pos.lng,
        at: { lat: pos.lat, lng: pos.lng },
      });
      for (const dataUrl of this.photos) {
        try {
          await this.community.addPhoto(place.id, dataUrl, '', { lat: pos.lat, lng: pos.lng });
        } catch {
          /* one bad photo shouldn't lose the place */
        }
      }
      await this.toast(`"${place.name}" is on the map — you're the creator!`);
      await this.router.navigateByUrl(`/place/${place.id}`, { replaceUrl: true });
    } catch (e) {
      this.error = e instanceof Error ? e.message.replace(/^[^:]+:\s*/, '') : 'Could not add the place.';
    } finally {
      this.submitting = false;
      this.cdr.markForCheck();
    }
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2400, position: 'top', cssClass: 'nb-toast' });
    await t.present();
  }
}
