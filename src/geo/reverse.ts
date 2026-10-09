import type { LngLat } from '../model/types';

export interface ReverseResult { label: string; country?: string }
export interface GeoOptions { signal?: AbortSignal; fetchFn?: typeof fetch }

export const MIN_INTERVAL_MS = 1100;

let lastStart = 0;
let tail: Promise<unknown> = Promise.resolve();
const cache = new Map<string, ReverseResult | null>();

/** Test helper. */
export function resetReverseGeocoder(): void {
  lastStart = 0;
  tail = Promise.resolve();
  cache.clear();
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Runs `task` no sooner than MIN_INTERVAL_MS after the previous request started (global, FIFO). */
function throttled<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const run = tail.then(async () => {
    const wait = lastStart + MIN_INTERVAL_MS - Date.now();
    if (lastStart > 0 && wait > 0) await sleep(wait, signal);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    lastStart = Date.now();
    return task();
  });
  tail = run.catch(() => undefined);
  return run;
}

interface NominatimResponse {
  error?: unknown;
  address?: Record<string, string | undefined>;
}

const PLACE_KEYS = ['city', 'town', 'village', 'municipality', 'hamlet', 'suburb', 'county', 'state_district', 'state', 'region'] as const;

export function parseNominatim(data: NominatimResponse): ReverseResult | null {
  const a = data.address;
  if (data.error || !a) return null;
  const country = a.country;
  const place = PLACE_KEYS.map((k) => a[k]).find((v) => !!v);
  if (!place && !country) return null;
  const label = place && country && place !== country ? `${place}, ${country}` : (place ?? (country as string));
  return country ? { label, country } : { label };
}

const cacheKey = (p: LngLat): string => `${p[1].toFixed(2)},${p[0].toFixed(2)}`;

/** Reverse geocode via Nominatim. null = nothing there (e.g. open sea). Throws on network/HTTP errors. */
export async function reverseGeocode(lngLat: LngLat, opts: GeoOptions = {}): Promise<ReverseResult | null> {
  const key = cacheKey(lngLat);
  if (cache.has(key)) return cache.get(key) ?? null;
  const doFetch = opts.fetchFn ?? fetch;
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lngLat[1].toFixed(5)}&lon=${lngLat[0].toFixed(5)}&zoom=10&accept-language=en`;
  const result = await throttled(async () => {
    const res = await doFetch(url, opts.signal ? { signal: opts.signal } : undefined);
    if (!res.ok) throw new Error(`Reverse geocoding failed (HTTP ${res.status})`);
    return parseNominatim((await res.json()) as NominatimResponse);
  }, opts.signal);
  cache.set(key, result);
  return result;
}
