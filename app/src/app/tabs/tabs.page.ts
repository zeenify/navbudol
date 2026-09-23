import { AfterViewInit, Component, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-tabs',
  templateUrl: 'tabs.page.html',
  styleUrls: ['tabs.page.scss'],
  standalone: false,
})
export class TabsPage implements AfterViewInit, OnDestroy {
  private observer?: ResizeObserver;
  private readonly onWindowResize = () => this.measureTabBar();

  ngAfterViewInit(): void {
    this.measureTabBar();
    const bar = document.querySelector('ion-tab-bar');
    if (bar && typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.measureTabBar());
      this.observer.observe(bar);
    }
    window.addEventListener('resize', this.onWindowResize);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
  }

  /** Publish the real tab-bar height so overlays can anchor above it. */
  private measureTabBar(): void {
    const h = document.querySelector('ion-tab-bar')?.getBoundingClientRect().height ?? 0;
    if (h > 0) document.documentElement.style.setProperty('--nb-tabbar-h', `${Math.round(h)}px`);
  }
}
