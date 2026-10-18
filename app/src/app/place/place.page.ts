import { ChangeDetectorRef, Component, ElementRef, inject, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, ToastController } from '@ionic/angular/lazy';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import {
  CommunityPlaceComment,
  CommunityPlaceDetail,
  CommunityPlacePhoto,
  PlaceResult,
} from '../core/models';
import { LocationService } from '../core/services/location.service';
import { CommunityPlacesService } from '../core/services/community-places.service';
import { AuthService } from '../core/services/auth.service';
import { ChatActionsService } from '../core/services/chat-actions.service';

/** One image in the fullscreen viewer (gallery, community photo or comment). */
interface ViewerItem {
  url: string;
  caption: string;
  authorName: string | null;
  /** when set, the viewer's ••• manages this photo (creator/uploader) */
  photo?: CommunityPlacePhoto;
}

/**
 * The place page — everything the community knows about one pin: the
 * creator's photo carousel, live ratings, likes, and visit-verified
 * comments (with photo attachments).
 */
@Component({
  selector: 'app-place',
  templateUrl: './place.page.html',
  styleUrls: ['./place.page.scss'],
  standalone: false,
})
export class PlacePage implements OnInit {
  @ViewChild('photoFileInput') photoFileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('commentFileInput') commentFileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('heroStrip') heroStrip!: ElementRef<HTMLDivElement>;

  private route = inject(ActivatedRoute);
  public router = inject(Router);
  public community = inject(CommunityPlacesService);
  private auth = inject(AuthService);
  private location = inject(LocationService);
  private chatActions = inject(ChatActionsService);
  private toastCtrl = inject(ToastController);
  private actionSheetCtrl = inject(ActionSheetController);
  private cdr = inject(ChangeDetectorRef);

  place: CommunityPlaceDetail | null = null;
  loading = true;
  error: string | null = null;
  commentText = '';
  /** data URL of the image attached to the comment being written */
  commentImage: string | null = null;
  busy = false;
  editing = false;
  editName = '';
  editDescription = '';
  editIcon: string | null = null;
  /** which community section is open — comments live under the reviews */
  segment: 'overview' | 'gallery' = 'overview';
  /** the comment being replied to (inline reply composer) */
  replyTo: CommunityPlaceComment | null = null;
  replyText = '';
  /** carousel position over the creator's gallery */
  heroIndex = 0;
  /** fullscreen photo viewer state */
  viewer: { items: ViewerItem[]; index: number } | null = null;

  get me() {
    return this.auth.currentUser;
  }

  /** Photos may be full CDN URLs or backend-relative /uploads paths. */
  imgUrl(path: string): string {
    return this.community.absoluteUrl(path);
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error = 'No place specified.';
      this.loading = false;
      return;
    }
    try {
      this.place = await this.community.detail(id);
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Could not load this place.';
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  // --- ratings + votes ------------------------------------------------------

  async rate(stars: number): Promise<void> {
    if (!this.place) return;
    this.busy = true;
    try {
      this.place.rating = await this.community.rate(this.place.id, stars);
      this.place.myRating = stars;
      await this.toast(`Rated ${stars} star${stars > 1 ? 's' : ''}.`);
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not save your rating.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  async vote(value: 1 | -1): Promise<void> {
    if (!this.place) return;
    const next = this.place.myVote === value ? 0 : value;
    this.busy = true;
    try {
      const res = await this.community.vote(this.place.id, next);
      this.place.likes = res.likes;
      this.place.dislikes = res.dislikes;
      this.place.myVote = res.myVote;
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not save your vote.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  // --- photos -----------------------------------------------------------------

  async takePhoto(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        const photo = await Camera.getPhoto({
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera,
          quality: 70,
          width: 1600,
        });
        if (photo.dataUrl) await this.uploadPhoto(photo.dataUrl);
      } catch {
        /* cancelled */
      }
      return;
    }
    this.photoFileInput.nativeElement.click();
  }

  openPhotoPicker(): void {
    this.photoFileInput.nativeElement.click();
  }

  onFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') await this.uploadPhoto(reader.result);
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  private async uploadPhoto(dataUrl: string): Promise<void> {
    if (!this.place) return;
    const pos = this.location.position;
    this.busy = true;
    try {
      const photo = await this.community.addPhoto(
        this.place.id,
        dataUrl,
        '',
        pos ? { lat: pos.lat, lng: pos.lng } : undefined
      );
      if (photo.verifiedVisit ?? false) this.place.hasVisited = true;
      this.place.communityPhotos = [photo, ...this.place.communityPhotos];
      this.place.photoCount += 1;
      await this.toast('Photo added — thank you for contributing!');
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not upload that photo.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  async photoActions(photo: CommunityPlacePhoto): Promise<void> {
    if (!this.place) return;
    const isCreator = this.place.isCreator === true;
    const isUploader = photo.uploader?.id === this.me?.id;
    if (!isCreator && !isUploader) return;
    const buttons: Array<{ text: string; handler?: () => void; role?: string }> = [];
    if (isCreator) {
      buttons.push({
        text: photo.inGallery ? 'Remove from gallery' : 'Add to gallery',
        handler: () => void this.toggleGallery(photo),
      });
    }
    if (isUploader || isCreator) {
      buttons.push({ text: 'Delete photo', role: 'destructive', handler: () => void this.deletePhoto(photo) });
    }
    buttons.push({ text: 'Cancel', role: 'cancel' });
    const sheet = await this.actionSheetCtrl.create({
      header: photo.caption || 'Community photo',
      buttons,
    });
    await sheet.present();
  }

  private async toggleGallery(photo: CommunityPlacePhoto): Promise<void> {
    if (!this.place) return;
    try {
      const updated = await this.community.setPhotoInGallery(this.place.id, photo.id, !photo.inGallery);
      photo.inGallery = updated.inGallery;
      if (updated.inGallery) {
        this.place.gallery = [updated, ...this.place.gallery.filter((p) => p.id !== photo.id)];
      } else {
        this.place.gallery = this.place.gallery.filter((p) => p.id !== photo.id);
      }
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not update the gallery.');
    }
    this.cdr.markForCheck();
  }

  private async deletePhoto(photo: CommunityPlacePhoto): Promise<void> {
    if (!this.place) return;
    try {
      await this.community.deletePhoto(this.place.id, photo.id);
      this.place.gallery = this.place.gallery.filter((p) => p.id !== photo.id);
      this.place.communityPhotos = this.place.communityPhotos.filter((p) => p.id !== photo.id);
      this.place.photoCount = Math.max(0, this.place.photoCount - 1);
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not delete that photo.');
    }
    this.cdr.markForCheck();
  }

  // --- carousel + viewer ---------------------------------------------------------

  onHeroScroll(): void {
    const strip = this.heroStrip?.nativeElement;
    if (!strip || !this.place?.gallery.length) return;
    const index = Math.round(strip.scrollLeft / strip.clientWidth);
    if (index !== this.heroIndex) {
      this.heroIndex = Math.max(0, Math.min(index, this.place.gallery.length - 1));
      this.cdr.markForCheck();
    }
  }

  get ratingRows(): Array<{ stars: number; count: number; pct: number }> {
    const dist = this.place?.rating.distribution ?? {};
    const max = Math.max(1, ...Object.values(dist).map((n) => Number(n) || 0));
    return [5, 4, 3, 2, 1].map((stars) => {
      const count = Number(dist[String(stars)] ?? 0);
      return { stars, count, pct: Math.round((count / max) * 100) };
    });
  }

  openViewer(items: ViewerItem[], index: number): void {
    if (!items.length) return;
    this.viewer = { items, index: Math.max(0, Math.min(index, items.length - 1)) };
    this.cdr.markForCheck();
  }

  openPhoto(photo: CommunityPlacePhoto, list: CommunityPlacePhoto[]): void {
    const items: ViewerItem[] = list.map((p) => ({
      url: this.community.absoluteUrl(p.url),
      caption: p.caption,
      authorName: p.uploader?.displayName ?? null,
      photo: p,
    }));
    this.openViewer(items, Math.max(0, list.indexOf(photo)));
  }

  openCommentImage(comment: CommunityPlaceComment): void {
    if (!comment.imageUrl) return;
    this.openViewer(
      [
        {
          url: this.community.absoluteUrl(comment.imageUrl),
          caption: comment.text,
          authorName: comment.author?.displayName ?? null,
        },
      ],
      0
    );
  }

  viewerStep(delta: number): void {
    if (!this.viewer) return;
    const next = this.viewer.index + delta;
    if (next < 0 || next >= this.viewer.items.length) return;
    this.viewer.index = next;
    this.cdr.markForCheck();
  }

  closeViewer(): void {
    this.viewer = null;
    this.cdr.markForCheck();
  }

  async viewerMenu(): Promise<void> {
    const item = this.viewer?.items[this.viewer.index];
    if (!item?.photo) return;
    this.closeViewer();
    await this.photoActions(item.photo);
  }

  get viewerPhoto(): CommunityPlacePhoto | null {
    return this.viewer?.items[this.viewer.index]?.photo ?? null;
  }

  // --- comments -----------------------------------------------------------------

  attachCommentImage(): void {
    this.commentFileInput.nativeElement.click();
  }

  onCommentFileChosen(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        this.commentImage = reader.result;
        this.cdr.markForCheck();
      }
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  removeCommentImage(): void {
    this.commentImage = null;
    this.cdr.markForCheck();
  }

  get canPostComment(): boolean {
    return !!this.commentText.trim() || !!this.commentImage;
  }

  async addComment(): Promise<void> {
    if (!this.place || (!this.commentText.trim() && !this.commentImage)) return;
    this.busy = true;
    try {
      const comment = await this.community.addComment(
        this.place.id,
        this.commentText.trim(),
        this.commentImage ?? undefined
      );
      this.place.comments = [comment, ...this.place.comments];
      this.place.commentCount += 1;
      this.commentText = '';
      this.commentImage = null;
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not post that comment.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  async submitReply(): Promise<void> {
    const parent = this.replyTo;
    if (!this.place || !parent || (!this.replyText.trim() && !this.commentImage)) return;
    this.busy = true;
    try {
      const reply = await this.community.addComment(
        this.place.id,
        this.replyText.trim(),
        this.commentImage ?? undefined,
        parent.id
      );
      parent.replies = [...(parent.replies ?? []), reply];
      this.place.commentCount += 1;
      this.replyTo = null;
      this.replyText = '';
      this.commentImage = null;
      await this.toast('Reply posted.');
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not post that reply.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  startReply(comment: CommunityPlaceComment): void {
    this.replyTo = this.replyTo?.id === comment.id ? null : comment;
    this.replyText = '';
    this.cdr.markForCheck();
  }

  /** Like / dislike a comment — optimistic, reconciled by the server call. */
  async commentVote(comment: CommunityPlaceComment, value: 1 | -1): Promise<void> {
    if (!this.place) return;
    const mine = comment.myVote === value;
    const next = mine ? 0 : value;
    // optimistic: apply immediately, then reconcile with the server counts
    const before = { likes: comment.likes, dislikes: comment.dislikes, myVote: comment.myVote ?? 0 };
    comment.likes += next === 1 && !mine ? 1 : next === 0 && before.myVote === 1 ? -1 : 0;
    comment.dislikes += next === -1 && !mine ? 1 : next === 0 && before.myVote === -1 ? -1 : 0;
    comment.myVote = next;
    this.cdr.markForCheck();
    try {
      const res = await this.community.voteComment(this.place.id, comment.id, next);
      comment.likes = res.likes;
      comment.dislikes = res.dislikes;
      comment.myVote = res.myVote;
      this.cdr.markForCheck();
    } catch {
      comment.likes = before.likes;
      comment.dislikes = before.dislikes;
      comment.myVote = before.myVote;
      this.cdr.markForCheck();
      await this.toast('Could not save that vote.');
    }
  }

  async deleteComment(commentId: string): Promise<void> {
    if (!this.place) return;
    try {
      await this.community.deleteComment(this.place.id, commentId);
      const removed = this.place.comments.find((c) => c.id === commentId);
      const replyCount = removed?.replies?.length ?? 0;
      this.place.comments = this.place.comments.filter((c) => c.id !== commentId);
      for (const c of this.place.comments) {
        c.replies = (c.replies ?? []).filter((r) => r.id !== commentId);
      }
      this.place.commentCount = Math.max(0, this.place.commentCount - 1 - replyCount);
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not delete that comment.');
    }
    this.cdr.markForCheck();
  }

  // --- navigation + creator tools ------------------------------------------------

  async navigate(): Promise<void> {
    if (!this.place) return;
    const dest: PlaceResult = {
      name: this.place.name,
      detail: 'Community place',
      lat: this.place.lat,
      lng: this.place.lng,
      communityPlaceId: this.place.id,
    };
    const route = await this.chatActions.routeToPlace(dest);
    if (route) {
      await this.router.navigateByUrl('/tabs/map');
    }
  }

  startEditing(): void {
    if (!this.place) return;
    this.editing = true;
    this.editName = this.place.name;
    this.editDescription = this.place.description;
    this.editIcon = this.place.icon;
    this.cdr.markForCheck();
  }

  async saveEdits(): Promise<void> {
    if (!this.place || !this.editName.trim() || !this.editIcon) return;
    this.busy = true;
    try {
      const updated = await this.community.update(this.place.id, {
        name: this.editName.trim(),
        description: this.editDescription.trim(),
        icon: this.editIcon,
      });
      this.place.name = updated.name;
      this.place.description = updated.description;
      this.place.icon = updated.icon;
      this.editing = false;
      await this.toast('Place updated.');
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not save the edits.');
    } finally {
      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  async retirePlace(): Promise<void> {
    if (!this.place) return;
    const sheet = await this.actionSheetCtrl.create({
      header: `Remove "${this.place.name}" from the map?`,
      buttons: [
        { text: 'Remove place', role: 'destructive', handler: () => void this.confirmRetire() },
        { text: 'Cancel', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async confirmRetire(): Promise<void> {
    if (!this.place) return;
    try {
      await this.community.retire(this.place.id);
      await this.toast('Place removed.');
      await this.router.navigateByUrl('/tabs/map', { replaceUrl: true });
    } catch (e) {
      await this.toast(e instanceof Error ? e.message : 'Could not remove the place.');
    }
  }

  timeAgo(iso: string): string {
    const seconds = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = seconds / 60;
    if (minutes < 60) return `${Math.floor(minutes)}m ago`;
    const hours = minutes / 60;
    if (hours < 24) return `${Math.floor(hours)}h ago`;
    const days = hours / 24;
    if (days < 30) return `${Math.floor(days)}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toastCtrl.create({ message, duration: 2200, position: 'top', cssClass: 'nb-toast' });
    await t.present();
  }
}
