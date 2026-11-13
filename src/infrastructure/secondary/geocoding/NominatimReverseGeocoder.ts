import { isWikidataId, type LngLat, type Place } from '../../../domain';
import type { ReverseGeocoder } from '../../../application';

/** Nominatim's usage policy allows about one request per second. */
export const MIN_INTERVAL_MS = 1100;

const abortError = (): DOMException => new DOMException('Aborted', 'AbortError');

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

interface NominatimResponse {
  error?: unknown;
  name?: string;
  address?: Record<string, string | undefined>;
  extratags?: Record<string, string | undefined> | null;
}

const PLACE_KEYS = ['city', 'town', 'village', 'municipality', 'hamlet', 'suburb', 'county', 'state_district', 'state', 'region'] as const;

export function parseNominatim(data: NominatimResponse): Place | null {
  const a = data.address;
  if (data.error || !a) return null;
  const country = a.country;
  const place = PLACE_KEYS.map((k) => a[k]).find((v) => !!v);
  if (!place && !country) return null;
  const label = place && country && place !== country ? `${place}, ${country}` : (place ?? (country as string));
  const result: Place = country ? { label, country } : { label };
  // The tags describe the object Nominatim returned, which is not always the one named in the label (e.g. a suburb).
  const wikidata = data.extratags?.wikidata;
  if (wikidata && isWikidataId(wikidata) && data.name && data.name === (place ?? country)) result.wikidata = wikidata;
  return result;
}

const cacheKey = (p: LngLat): string => `${p[1].toFixed(2)},${p[0].toFixed(2)}`;

/** Reverse geocoding via Nominatim: rate limited (FIFO, one request per MIN_INTERVAL_MS) and cached by position (~1 km). */
export class NominatimReverseGeocoder implements ReverseGeocoder {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private lastStart = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<string, Place | null>();

  constructor(opts: { fetch?: typeof fetch; now?: () => number; baseUrl?: string } = {}) {
    this.baseUrl = opts.baseUrl ?? 'https://nominatim.openstreetmap.org';
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.now = opts.now ?? Date.now;
  }

  /** null = nothing there (e.g. open sea). Rejects on network / HTTP errors and when aborted. */
  async placeAt(at: LngLat, signal: AbortSignal): Promise<Place | null> {
    const key = cacheKey(at);
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const url = `${this.baseUrl}/reverse?format=jsonv2&lat=${at[1].toFixed(5)}&lon=${at[0].toFixed(5)}&zoom=10&accept-language=en&extratags=1`;
    const result = await this.throttled(async () => {
      const res = await this.fetchFn(url, { signal });
      if (!res.ok) throw new Error(`Reverse geocoding failed (HTTP ${res.status})`);
      return parseNominatim((await res.json()) as NominatimResponse);
    }, signal);
    this.cache.set(key, result);
    return result;
  }

  /** Runs `task` no sooner than MIN_INTERVAL_MS after the previous request started. */
  private throttled<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const run = this.tail.then(async () => {
      const wait = this.lastStart + MIN_INTERVAL_MS - this.now();
      if (this.lastStart > 0 && wait > 0) await sleep(wait, signal);
      if (signal.aborted) throw abortError();
      this.lastStart = this.now();
      return task();
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
