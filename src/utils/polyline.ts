import { ActivityPoint } from '../types';

/**
 * Decode a Google Maps polyline string into an array of coordinates
 * This is a simplified version - for production, consider using a library like @mapbox/polyline
 */
export function decodePolyline(encoded: string): ActivityPoint[] {
  const points: ActivityPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    // Decode latitude
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : (result >> 1);
    lat += deltaLat;

    shift = 0;
    result = 0;

    // Decode longitude
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : (result >> 1);
    lng += deltaLng;

    points.push({
      lat: lat * 1e-5,
      lng: lng * 1e-5,
    });
  }

  return points;
}

