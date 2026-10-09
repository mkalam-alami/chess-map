import type { LngLat } from '../domain';
import type { GeoOptions } from './reverse';

export interface PlaceHit { label: string; lngLat: LngLat; bbox?: [west: number, south: number, east: number, north: number] }

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown> & { extent?: number[] };
}

const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export function parsePhoton(data: { features?: PhotonFeature[] }): PlaceHit[] {
  const out: PlaceHit[] = [];
  for (const f of data.features ?? []) {
    const c = f.geometry?.coordinates;
    const p = f.properties;
    if (!c || c.length < 2 || !p) continue;
    const parts = [s(p.name), s(p.city) !== s(p.name) ? s(p.city) : undefined, s(p.state), s(p.country)].filter((x): x is string => !!x);
    const label = parts.filter((x, i) => parts.indexOf(x) === i).join(', ');
    if (!label) continue;
    const hit: PlaceHit = { label, lngLat: [c[0], c[1]] };
    // Photon extent = [minLon, maxLat, maxLon, minLat]
    const e = p.extent;
    if (Array.isArray(e) && e.length === 4) hit.bbox = [e[0] as number, e[3] as number, e[2] as number, e[1] as number];
    out.push(hit);
  }
  return out;
}

export async function searchPlaces(q: string, opts: GeoOptions = {}): Promise<PlaceHit[]> {
  const query = q.trim();
  if (!query) return [];
  const doFetch = opts.fetchFn ?? fetch;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en`;
  const res = await doFetch(url, opts.signal ? { signal: opts.signal } : undefined);
  if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status})`);
  return parsePhoton((await res.json()) as { features?: PhotonFeature[] });
}
