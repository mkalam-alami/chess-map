import type { Place } from '../../../domain';

export interface PlaceLink { label: string; testid: string; url: string }

/** The place name without its trailing country (`Lyon, France` → `Lyon`), which is what Wikipedia titles look like. */
const cityName = (p: Place): string =>
  p.country && p.label.endsWith(`, ${p.country}`) ? p.label.slice(0, -`, ${p.country}`.length) : p.label;

/**
 * Pages about a place. Search URLs, not lookups: Wikipedia's search jumps straight to the article when the name is an
 * exact title (else it lists results), so no request is made until the user clicks.
 */
export function placeLinks(p: Place): PlaceLink[] {
  return [
    { label: 'Wikipedia', testid: 'place-wikipedia', url: `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(cityName(p))}` },
    { label: 'Tripadvisor', testid: 'place-tripadvisor', url: `https://www.tripadvisor.com/Search?q=${encodeURIComponent(p.label)}` },
  ];
}
