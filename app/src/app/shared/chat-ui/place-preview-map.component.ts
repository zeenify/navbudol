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
import * as L from 'leaflet';
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

  private map: L.Map | null = null;
  private marker: L.CircleMarker | null = null;
  private routeLine: L.Polyline | null = null;

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
    this.routeLine = null;
  }

  private createMap(): void {
    const element = this.mapElement?.nativeElement;
    if (!element || !this.place || this.map) return;

    this.map = L.map(element, {
      attributionControl: false,
      zoomControl: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
    });
    L.tileLayer(`${environment.maptilerStyles.light}/{z}/{x}/{y}@2x.png?key=${environment.maptilerKey}`, {
      maxZoom: 19,
    }).addTo(this.map);
    this.marker = L.circleMarker([this.place.lat, this.place.lng], {
      radius: 9,
      color: '#ffffff',
      weight: 3,
      fillColor: '#007aff',
      fillOpacity: 1,
      interactive: false,
    }).addTo(this.map);
    this.updateRoute();
    setTimeout(() => this.map?.invalidateSize(), 0);
  }

  private updatePlace(): void {
    if (!this.map || !this.place) return;
    this.marker?.setLatLng([this.place.lat, this.place.lng]);
    this.map.setView([this.place.lat, this.place.lng], this.map.getZoom(), { animate: false });
  }

  private updateRoute(): void {
    if (!this.map || !this.place) return;
    const points = (this.routeGeometry ?? []).map((point) => [point.lat, point.lng] as [number, number]);
    if (points.length < 2) {
      this.routeLine?.remove();
      this.routeLine = null;
      this.map.setView([this.place.lat, this.place.lng], 15, { animate: false });
      return;
    }
    if (this.routeLine) {
      this.routeLine.setLatLngs(points);
    } else {
      this.routeLine = L.polyline(points, {
        color: '#007aff',
        weight: 5,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(this.map);
    }
    this.map.fitBounds(L.latLngBounds(points), { padding: [24, 24], animate: false });
  }
}
