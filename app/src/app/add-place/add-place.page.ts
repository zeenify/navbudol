import { ChangeDetectorRef, Component, ElementRef, inject, NgZone, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { ToastController } from '@ionic/angular/lazy';
import { PlaceResult } from '../core/models';
import { LocationService } from '../core/services/location.service';
import { CommunityPlacesService } from '../core/services/community-places.service';
import { GeminiService } from '../core/services/gemini.service';

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
  private community = inject(CommunityPlacesService);
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

  /** Feeds the mini preview map; identity-stable per fix. */
  previewPlace: PlaceResult | null = null;

  constructor() {
    void this.location.startWatch();
  }

  get position() {
    return this.location.position;
  }

  get hasFix(): boolean {
    return this.location.hasFix && !!this.position;
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
    this.cdr.markForCheck();
  }

  /** Uploaded a custom icon image — store it and prefer it over the library. */
  async pickCustomIcon(dataUrl: string): Promise<void> {
    try {
      const res = await this.community.uploadCustomIcon(dataUrl);
      this.customIconUrl = res.url;
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Could not upload that icon.';
    }
    this.cdr.markForCheck();
  }

  /** AI matches the description to a library icon — never blocks the form. */
  async aiPickIcon(): Promise<void> {
    if (this.aiPicking) return;
    const hint = `${this.name} ${this.description}`.trim();
    if (!hint) {
      this.error = 'Write the place name (or description) first, then let the AI pick.';
      this.cdr.markForCheck();
      return;
    }
    this.aiPicking = true;
    this.error = null;
    this.cdr.markForCheck();
    const key = await this.gemini.matchIcon(hint);
    if (key) await this.pickIcon(key);
    else this.error = 'The AI could not pick an icon — choose one manually.';
    this.aiPicking = false;
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
