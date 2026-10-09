import type { LngLat } from '../../../domain';

const MAX_LAT = 85.0511;

// Web Mercator normalized so x spans [0,1] over 360 degrees; y grows southwards.
const toMerc = ([lng, lat]: LngLat): [number, number] => {
  const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return [(lng + 180) / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360)) / (2 * Math.PI)];
};
const fromMerc = ([x, y]: [number, number]): LngLat => [
  x * 360 - 180,
  ((2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - Math.PI / 2) * 180) / Math.PI,
];

/**
 * Quadratic Bezier from a to b in Web Mercator space. The control point sits
 * 20% of the distance off the midpoint, always to the left of a→b. b's
 * longitude is unwrapped to be within 180° of a's, so the curve never spans
 * the whole map: output longitudes may leave [-180, 180].
 */
export function curveCoords(a: LngLat, b: LngLat, steps = 32): LngLat[] {
  const bLng = a[0] + ((((b[0] - a[0] + 180) % 360) + 360) % 360) - 180;
  const [x0, y0] = toMerc(a);
  const [x2, y2] = toMerc([bLng, b[1]]);
  const dx = x2 - x0;
  const dy = y2 - y0;
  const cx = (x0 + x2) / 2 + dy * 0.2;
  const cy = (y0 + y2) / 2 - dx * 0.2;
  const out: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push(fromMerc([u * u * x0 + 2 * u * t * cx + t * t * x2, u * u * y0 + 2 * u * t * cy + t * t * y2]));
  }
  out[0] = a;
  out[steps] = [bLng, b[1]];
  return out;
}
