import type { Place } from '../../../domain';

export interface PlaceLink { label: string; testid: string; url: string }

/** The place name without its trailing country (`Lyon, France` → `Lyon`), which is what Wikipedia titles look like. */
const cityName = (p: Place): string =>
  p.country && p.label.endsWith(`, ${p.country}`) ? p.label.slice(0, -`, ${p.country}`.length) : p.label;

/**
 * The English Wikipedia article of the place. With its Wikidata id, Wikidata redirects to exactly that article (or shows
 * the item when there is none). Without (places picked from a search, or named before ids were kept), a search by name:
 * it opens the article on an exact title, but a disambiguation page for common names (Portland, Bath…).
 */
const wikipediaUrl = (p: Place): string =>
  p.wikidata
    ? `https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/${p.wikidata}`
    : `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(cityName(p))}`;

/** Pages about a place. URLs only: nothing is requested until the user clicks. */
export function placeLinks(p: Place): PlaceLink[] {
  return [
    { label: 'Wikipedia', testid: 'place-wikipedia', url: wikipediaUrl(p) },
    { label: 'Tripadvisor', testid: 'place-tripadvisor', url: `https://www.tripadvisor.com/Search?q=${encodeURIComponent(p.label)}` },
  ];
}
