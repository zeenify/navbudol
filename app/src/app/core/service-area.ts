import { environment } from '../../environments/environment';
import { LatLng } from './models';
import { haversineM } from './geo.utils';

export const GENERAL_TINIO_SERVICE_RADIUS_M = 20000;

export function distanceFromGeneralTinio(point: LatLng): number {
  return haversineM(environment.defaultCenter, point);
}

export function isWithinGeneralTinioServiceArea(point: LatLng): boolean {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
  return distanceFromGeneralTinio(point) <= GENERAL_TINIO_SERVICE_RADIUS_M;
}
