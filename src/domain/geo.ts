export type LngLat = [lng: number, lat: number];

/** A named place (reverse-geocoded or picked from a search). */
export interface Place { label: string; country?: string }

/** Where new maps and PGN imports start when no position is given (Paris). */
export const DEFAULT_CENTER: LngLat = [2.35, 48.85];

/** Normalizes the longitude into [-180, 180). */
export const wrapLng = (ll: LngLat): LngLat => [((((ll[0] + 180) % 360) + 360) % 360) - 180, ll[1]];

/** Shifts `lng` by multiples of 360 so it is as close as possible to `ref`. */
export const wrapNear = (lng: number, ref: number): number => lng + 360 * Math.round((ref - lng) / 360);

/** Same point, up to floating-point noise. */
export const sameLngLat = (a: LngLat, b: LngLat): boolean => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 1e-6;
