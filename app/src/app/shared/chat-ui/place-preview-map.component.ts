import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import maplibregl, { GeoJSONSource, Map as MlMap, Marker } from 'maplibre-gl';
import type { Feature } from 'geojson';
import { environment } from '../../../environments/environment';
import { LatLng, PlaceResult } from '../../core/models';

@Component({
  selector: 'app-place-preview-map',
  templateUrl: './place-preview-map.component.html',
  styleUrls: ['./place-preview-map.component.scss'],
  standalone: false,
})
export class PlacePreviewMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() place: PlaceResult | null = null;
  @Input() routeGeometry: LatLng[] | null = null;
  @ViewChild('map', { static: true }) mapElement!: ElementRef<HTMLDivElement>;

  private map: MlMap | null = null;
  private marker: Marker | null = null;
  private routeCoords: [number, number][] | null = null;

  ngAfterViewInit(): void {
    this.createMap();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['place'] && !changes['routeGeometry']) return;
    if (!this.map) {
      this.createMap();
      return;
    }
    if (this.place) this.updatePlace();
    this.updateRoute();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
    this.marker = null;
    this.routeCoords = null;
  }

  private createMap(): void {
    const element = this.mapElement?.nativeElement;
    if (!element || !this.place || this.map) return;

    this.map = new maplibregl.Map({
      container: element,
      style: `${environment.maptilerStyles.light}/style.json?key=${environment.maptilerKey}`,
      center: [this.place.lng, this.place.lat],
      zoom: 15,
      interactive: false,
      attributionControl: false,
    });
    this.map.on('style.load', () => {
      const map = this.map;
      if (!map || map.getSource('nb-route')) return;
      map.addSource('nb-route', { type: 'geojson', data: this.routeFeature() });
      map.addLayer({
        id: 'nb-route-casing',
        type: 'line',
        source: 'nb-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.7 },
      });
      map.addLayer({
        id: 'nb-route-line',
        type: 'line',
        source: 'nb-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#007aff', 'line-width': 4.5, 'line-opacity': 0.9 },
      });
      this.updateRoute();
    });
    this.updatePlace();
    this.updateRoute();
    setTimeout(() => this.map?.resize(), 0);
  }

  private updatePlace(): void {
    const map = this.map;
    if (!map || !this.place) return;
    if (!this.marker) {
      const el = document.createElement('div');
      el.style.cssText =
        'width:18px;height:18px;border-radius:50%;background:#007aff;border:3px solid #ffffff;box-shadow:0 1px 6px rgba(0,0,0,0.35);box-sizing:border-box;';
      this.marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([this.place.lng, this.place.lat])
        .addTo(map);
    } else {
      this.marker.setLngLat([this.place.lng, this.place.lat]);
    }
    map.jumpTo({ center: [this.place.lng, this.place.lat] });
  }

  private updateRoute(): void {
    const map = this.map;
    if (!map || !this.place) return;
    const points = this.routeGeometry ?? [];
    if (points.length < 2) {
      this.routeCoords = null;
      this.pushRoute();
      map.jumpTo({ center: [this.place.lng, this.place.lat], zoom: 15 });
      return;
    }
    this.routeCoords = points.map((point) => [point.lng, point.lat] as [number, number]);
    this.pushRoute();
    const lons = this.routeCoords.map((c) => c[0]);
    const lats = this.routeCoords.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 24, duration: 0, maxZoom: 17 }
    );
  }

  private routeFeature(): Feature {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: this.routeCoords ?? [] },
    };
  }

  private pushRoute(): void {
    const source = this.map?.getSource('nb-route') as GeoJSONSource | undefined;
    source?.setData(this.routeFeature());
  }
}
