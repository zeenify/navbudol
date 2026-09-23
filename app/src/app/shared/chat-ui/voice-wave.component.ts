import {
  AfterViewInit,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
} from '@angular/core';

/**
 * Claude-style voice indicator: a flat row of thin bars in one muted color
 * that quietly react to the microphone level. Falls back to a gentle idle
 * motion when the mic level is unavailable (no permission / unsupported).
 */
@Component({
  selector: 'app-voice-wave',
  standalone: false,
  template: '<div class="wave" #wave><span *ngFor="let b of bars"></span></div>',
  styles: [
    `
      .wave {
        display: flex;
        align-items: center;
        gap: 3px;
        height: 26px;
        flex-shrink: 0;
      }
      span {
        width: 2.5px;
        border-radius: 2px;
        background: rgba(235, 235, 245, 0.72);
        transition: height 0.09s linear;
      }
    `,
  ],
})
export class VoiceWaveComponent implements AfterViewInit, OnDestroy {
  @ViewChild('wave', { static: true }) wave!: ElementRef<HTMLDivElement>;

  readonly bars = Array(26);

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private levels: number[] = [];

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    for (let i = 0; i < this.bars.length; i++) this.levels.push(0.2);
    void this.start();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private async start(): Promise<void> {
    // Run outside Angular: this loop mutates styles directly, never state.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.stream = stream;
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.75;
      src.connect(this.analyser);
    } catch {
      this.analyser = null; // idle fallback
    }
    this.zone.runOutsideAngular(() => this.loop());
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const nodes = this.wave.nativeElement.children;
    const n = this.levels.length;

    if (this.analyser) {
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(data);
      // Squash the spectrum into the bar count (skip the near-silent top end).
      const usable = Math.floor(data.length * 0.7);
      for (let i = 0; i < n; i++) {
        const from = Math.floor((i * usable) / n);
        const to = Math.max(from + 1, Math.floor(((i + 1) * usable) / n));
        let sum = 0;
        for (let j = from; j < to; j++) sum += data[j];
        const v = sum / (to - from) / 255;
        this.levels[i] = this.levels[i] * 0.65 + v * 0.35;
      }
    } else {
      // Idle: a slow travelling ripple so it never looks frozen.
      const t = Date.now() / 500;
      for (let i = 0; i < n; i++) {
        this.levels[i] = 0.2 + 0.1 * Math.sin(t + i * 0.55);
      }
    }

    for (let i = 0; i < n; i++) {
      const el = nodes[i] as HTMLElement | undefined;
      if (!el) continue;
      const h = 12 + Math.min(1, this.levels[i]) * 88; // percent of 26px row
      el.style.height = `${h}%`;
    }
  };
}
