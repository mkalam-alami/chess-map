import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseNominatim, resetReverseGeocoder, reverseGeocode } from '../src/geo/reverse';
import { searchPlaces } from '../src/geo/search';

const json = (data: unknown, ok = true): Response => ({ ok, status: ok ? 200 : 500, json: async () => data }) as Response;
const asFetch = (f: unknown): typeof fetch => f as typeof fetch;

describe('parseNominatim', () => {
  it('uses city then falls back', () => {
    expect(parseNominatim({ address: { city: 'Porto', country: 'Portugal' } })).toEqual({ label: 'Porto, Portugal', country: 'Portugal' });
    expect(parseNominatim({ address: { village: 'Nowhere', state: 'X', country: 'France' } })).toEqual({ label: 'Nowhere, France', country: 'France' });
    expect(parseNominatim({ address: { state: 'Bavaria', country: 'Germany' } })?.label).toBe('Bavaria, Germany');
    expect(parseNominatim({ address: { country: 'Iceland' } })?.label).toBe('Iceland');
  });
  it('returns null for errors / open sea', () => {
    expect(parseNominatim({ error: 'Unable to geocode' })).toBeNull();
    expect(parseNominatim({})).toBeNull();
  });
});

describe('reverseGeocode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetReverseGeocoder();
  });
  afterEach(() => vi.useRealTimers());

  it('builds the Nominatim URL and parses the label', async () => {
    const fetchFn = vi.fn(async (_url: string) => json({ address: { town: 'Lagos', country: 'Portugal' } }));
    const r = await reverseGeocode([-8.6, 37.1], { fetchFn: asFetch(fetchFn) });
    expect(r).toEqual({ label: 'Lagos, Portugal', country: 'Portugal' });
    const url = String(fetchFn.mock.calls[0]?.[0]);
    expect(url).toContain('https://nominatim.openstreetmap.org/reverse?format=jsonv2');
    expect(url).toContain('lat=37.10000');
    expect(url).toContain('lon=-8.60000');
    expect(url).toContain('zoom=10');
  });

  it('caches by 2-decimal rounded coordinates (including null)', async () => {
    const fetchFn = vi.fn(async () => json({ error: 'Unable to geocode' }));
    expect(await reverseGeocode([10.001, 20.002], { fetchFn: asFetch(fetchFn) })).toBeNull();
    expect(await reverseGeocode([10.004, 20.001], { fetchFn: asFetch(fetchFn) })).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('spaces requests at least 1100 ms apart', async () => {
    const times: number[] = [];
    const fetchFn = vi.fn(async () => {
      times.push(Date.now());
      return json({ address: { city: 'A', country: 'B' } });
    });
    const f = asFetch(fetchFn);
    const ps = [reverseGeocode([1, 1], { fetchFn: f }), reverseGeocode([2, 2], { fetchFn: f }), reverseGeocode([3, 3], { fetchFn: f })];
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(ps);
    expect(times).toHaveLength(3);
    expect((times[1] as number) - (times[0] as number)).toBeGreaterThanOrEqual(1100);
    expect((times[2] as number) - (times[1] as number)).toBeGreaterThanOrEqual(1100);
  });

  it('rejects on HTTP errors without poisoning the queue, and supports abort', async () => {
    const bad = vi.fn(async () => json({}, false));
    await expect(reverseGeocode([5, 5], { fetchFn: asFetch(bad) })).rejects.toThrow(/HTTP 500/);
    const ok = vi.fn(async () => json({ address: { city: 'C', country: 'D' } }));
    const ac = new AbortController();
    const p1 = reverseGeocode([6, 6], { fetchFn: asFetch(ok) });
    const p2 = reverseGeocode([7, 7], { fetchFn: asFetch(ok), signal: ac.signal });
    const settled = p2.catch((e: Error) => e.name);
    ac.abort();
    await vi.advanceTimersByTimeAsync(5000);
    expect((await p1)?.label).toBe('C, D');
    expect(await settled).toBe('AbortError');
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('searchPlaces', () => {
  it('queries Photon and maps features', async () => {
    const fetchFn = vi.fn(async (_url: string) =>
      json({
        features: [
          { geometry: { coordinates: [-9.13, 38.72] }, properties: { name: 'Lisbon', country: 'Portugal', extent: [-9.2, 38.8, -9.0, 38.6] } },
          { geometry: { coordinates: [1, 2] }, properties: { name: 'Paris', city: 'Paris', state: 'Ile-de-France', country: 'France' } },
          { properties: { name: 'broken' } },
        ],
      }),
    );
    const r = await searchPlaces(' Lis bon ', { fetchFn: asFetch(fetchFn) });
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('https://photon.komoot.io/api/?q=Lis%20bon&limit=6&lang=en');
    expect(r).toEqual([
      { label: 'Lisbon, Portugal', lngLat: [-9.13, 38.72], bbox: [-9.2, 38.6, -9.0, 38.8] },
      { label: 'Paris, Ile-de-France, France', lngLat: [1, 2] },
    ]);
  });
  it('returns [] for blank queries without fetching and throws on HTTP errors', async () => {
    const fetchFn = vi.fn(async () => json({}, false));
    expect(await searchPlaces('  ', { fetchFn: asFetch(fetchFn) })).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(searchPlaces('x', { fetchFn: asFetch(fetchFn) })).rejects.toThrow(/HTTP 500/);
  });
});
