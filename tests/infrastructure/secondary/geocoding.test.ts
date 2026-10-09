import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_INTERVAL_MS, NominatimReverseGeocoder, parseNominatim } from '../../../src/infrastructure/secondary/geocoding/NominatimReverseGeocoder';
import { PhotonPlaceSearch, parsePhoton } from '../../../src/infrastructure/secondary/geocoding/PhotonPlaceSearch';

const json = (data: unknown, status = 200): Response => ({ ok: status < 400, status, json: async () => data }) as Response;
const brokenJson = (): Response => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }) as unknown as Response;
const asFetch = (f: unknown): typeof fetch => f as typeof fetch;
const signal = (): AbortSignal => new AbortController().signal;

describe('parseNominatim', () => {
  it('uses city then falls back', () => {
    expect(parseNominatim({ address: { city: 'Porto', country: 'Portugal' } })).toEqual({ label: 'Porto, Portugal', country: 'Portugal' });
    expect(parseNominatim({ address: { village: 'Nowhere', state: 'X', country: 'France' } })).toEqual({ label: 'Nowhere, France', country: 'France' });
    expect(parseNominatim({ address: { state: 'Bavaria', country: 'Germany' } })?.label).toBe('Bavaria, Germany');
    expect(parseNominatim({ address: { country: 'Iceland' } })?.label).toBe('Iceland');
  });
  it('does not repeat a place that is the country', () => {
    expect(parseNominatim({ address: { state: 'Monaco', country: 'Monaco' } })?.label).toBe('Monaco');
  });
  it('keeps a place without a country', () => {
    expect(parseNominatim({ address: { city: 'Atlantis' } })).toEqual({ label: 'Atlantis' });
  });
  it('returns null for errors / open sea', () => {
    expect(parseNominatim({ error: 'Unable to geocode' })).toBeNull();
    expect(parseNominatim({})).toBeNull();
    expect(parseNominatim({ address: {} })).toBeNull();
  });
});

describe('NominatimReverseGeocoder', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('builds the Nominatim URL and parses the label', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => json({ address: { town: 'Lagos', country: 'Portugal' } }));
    const geocoder = new NominatimReverseGeocoder({ fetch: asFetch(fetchFn) });
    const ac = new AbortController();
    expect(await geocoder.placeAt([-8.6, 37.1], ac.signal)).toEqual({ label: 'Lagos, Portugal', country: 'Portugal' });
    const url = String(fetchFn.mock.calls[0]?.[0]);
    expect(url).toContain('https://nominatim.openstreetmap.org/reverse?format=jsonv2');
    expect(url).toContain('lat=37.10000');
    expect(url).toContain('lon=-8.60000');
    expect(url).toContain('zoom=10');
    expect(fetchFn.mock.calls[0]?.[1]).toEqual({ signal: ac.signal });
  });

  it('caches by 2-decimal rounded coordinates (including null)', async () => {
    const fetchFn = vi.fn(async () => json({ error: 'Unable to geocode' }));
    const geocoder = new NominatimReverseGeocoder({ fetch: asFetch(fetchFn) });
    expect(await geocoder.placeAt([10.001, 20.002], signal())).toBeNull();
    expect(await geocoder.placeAt([10.004, 20.001], signal())).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json({}, 500)).mockResolvedValue(json({ address: { city: 'A', country: 'B' } }));
    const geocoder = new NominatimReverseGeocoder({ fetch: asFetch(fetchFn) });
    await expect(geocoder.placeAt([1, 1], signal())).rejects.toThrow();
    const retry = geocoder.placeAt([1, 1], signal());
    await vi.advanceTimersByTimeAsync(MIN_INTERVAL_MS);
    expect((await retry)?.label).toBe('A, B');
  });

  it(`spaces requests at least ${MIN_INTERVAL_MS} ms apart, in order`, async () => {
    const times: number[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      times.push(Date.now());
      return json({ address: { city: url.includes('lat=1.') ? 'A' : 'B', country: 'X' } });
    });
    const geocoder = new NominatimReverseGeocoder({ fetch: asFetch(fetchFn) });
    const ps = [geocoder.placeAt([1, 1], signal()), geocoder.placeAt([2, 2], signal()), geocoder.placeAt([3, 3], signal())];
    await vi.advanceTimersByTimeAsync(5000);
    expect((await Promise.all(ps)).map((p) => p?.label)).toEqual(['A, X', 'B, X', 'B, X']);
    expect(times).toHaveLength(3);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });

  it('uses the injected clock to decide how long to wait', async () => {
    let t = 10_000;
    const fetchFn = vi.fn(async () => json({ address: { city: 'A', country: 'B' } }));
    const geocoder = new NominatimReverseGeocoder({ fetch: asFetch(fetchFn), now: () => t });
    await geocoder.placeAt([1, 1], signal());
    t += MIN_INTERVAL_MS; // the interval has passed: no waiting, so no timers are needed
    await geocoder.placeAt([2, 2], signal());
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('rejects on HTTP errors without poisoning the queue', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json({}, 429)).mockResolvedValue(json({ address: { city: 'C', country: 'D' } }));
    const geocoder = new NominatimReverseGeocoder({ fetch: asFetch(fetchFn) });
    await expect(geocoder.placeAt([5, 5], signal())).rejects.toThrow(/HTTP 429/);
    const next = geocoder.placeAt([6, 6], signal());
    await vi.advanceTimersByTimeAsync(5000);
    expect((await next)?.label).toBe('C, D');
  });

  it('rejects on malformed JSON and on network failures', async () => {
    const geocoder = new NominatimReverseGeocoder({ fetch: asFetch(vi.fn().mockResolvedValueOnce(brokenJson()).mockRejectedValueOnce(new TypeError('Failed to fetch'))) });
    await expect(geocoder.placeAt([5, 5], signal())).rejects.toThrow(SyntaxError);
    const offline = geocoder.placeAt([6, 6], signal());
    const settled = offline.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await settled).toBeInstanceOf(TypeError);
  });

  it('an aborted request waiting for its turn never reaches the network, and the others still run', async () => {
    const ok = vi.fn(async () => json({ address: { city: 'C', country: 'D' } }));
    const geocoder = new NominatimReverseGeocoder({ fetch: asFetch(ok) });
    const ac = new AbortController();
    const p1 = geocoder.placeAt([6, 6], signal());
    const p2 = geocoder.placeAt([7, 7], ac.signal);
    const settled = p2.catch((e: Error) => e.name);
    ac.abort();
    await vi.advanceTimersByTimeAsync(5000);
    expect((await p1)?.label).toBe('C, D');
    expect(await settled).toBe('AbortError');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('rejects at once when already aborted', async () => {
    const ok = vi.fn(async () => json({}));
    const geocoder = new NominatimReverseGeocoder({ fetch: asFetch(ok) });
    const ac = new AbortController();
    await geocoder.placeAt([1, 1], signal()).catch(() => undefined);
    ac.abort();
    const p = geocoder.placeAt([2, 2], ac.signal).catch((e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBe('AbortError');
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('PhotonPlaceSearch', () => {
  it('queries Photon and maps features', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({
        features: [
          { geometry: { coordinates: [-9.13, 38.72] }, properties: { name: 'Lisbon', country: 'Portugal', extent: [-9.2, 38.8, -9.0, 38.6] } },
          { geometry: { coordinates: [1, 2] }, properties: { name: 'Paris', city: 'Paris', state: 'Ile-de-France', country: 'France' } },
          { properties: { name: 'broken' } },
        ],
      }),
    );
    const r = await new PhotonPlaceSearch({ fetch: asFetch(fetchFn) }).search(' Lis bon ');
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('https://photon.komoot.io/api/?q=Lis%20bon&limit=6&lang=en');
    expect(r).toEqual([
      { label: 'Lisbon, Portugal', lngLat: [-9.13, 38.72], bbox: [-9.2, 38.6, -9.0, 38.8] },
      { label: 'Paris, Ile-de-France, France', lngLat: [1, 2] },
    ]);
  });

  it('passes the abort signal to fetch', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => json({ features: [] }));
    const ac = new AbortController();
    await new PhotonPlaceSearch({ fetch: asFetch(fetchFn) }).search('x', ac.signal);
    expect(fetchFn.mock.calls[0]?.[1]).toEqual({ signal: ac.signal });
  });

  it('returns [] for blank queries without fetching', async () => {
    const fetchFn = vi.fn(async () => json({}, 500));
    expect(await new PhotonPlaceSearch({ fetch: asFetch(fetchFn) }).search('  ')).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns [] when there are no features', async () => {
    expect(await new PhotonPlaceSearch({ fetch: asFetch(async () => json({})) }).search('nowhere')).toEqual([]);
  });

  it('rejects on HTTP errors, malformed JSON and network failures', async () => {
    await expect(new PhotonPlaceSearch({ fetch: asFetch(async () => json({}, 503)) }).search('x')).rejects.toThrow(/HTTP 503/);
    await expect(new PhotonPlaceSearch({ fetch: asFetch(async () => brokenJson()) }).search('x')).rejects.toThrow(SyntaxError);
    await expect(new PhotonPlaceSearch({ fetch: asFetch(async () => { throw new TypeError('Failed to fetch'); }) }).search('x')).rejects.toThrow('Failed to fetch');
  });
});

describe('parsePhoton', () => {
  it('skips features without a usable label or coordinates and de-duplicates label parts', () => {
    expect(parsePhoton({ features: [{ geometry: { coordinates: [1, 2] }, properties: {} }, { geometry: { coordinates: [1] as unknown as [number, number] }, properties: { name: 'x' } }] })).toEqual([]);
    expect(parsePhoton({ features: [{ geometry: { coordinates: [1, 2] }, properties: { name: 'Berlin', state: 'Berlin', country: 'Germany' } }] })[0]?.label).toBe('Berlin, Germany');
  });
});
