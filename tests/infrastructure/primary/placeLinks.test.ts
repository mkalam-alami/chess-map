import { describe, expect, it } from 'vitest';
import { placeLinks } from '../../../src/infrastructure/primary/ui/placeLinks';

describe('placeLinks', () => {
  it('without a Wikidata id, searches Wikipedia for the city alone and Tripadvisor for the full label', () => {
    const [wiki, trip] = placeLinks({ label: 'Saint-Étienne, France', country: 'France' });
    expect(wiki?.url).toBe('https://en.wikipedia.org/wiki/Special:Search?search=Saint-%C3%89tienne');
    expect(trip?.url).toBe('https://www.tripadvisor.com/Search?q=Saint-%C3%89tienne%2C%20France');
  });

  it('links straight to the article of a known Wikidata item', () => {
    expect(placeLinks({ label: 'Portland, United States', country: 'United States', wikidata: 'Q6106' })[0]?.url)
      .toBe('https://www.wikidata.org/wiki/Special:GoToLinkedPage/enwiki/Q6106');
  });

  it('keeps a label that is only a country, or has no country', () => {
    expect(placeLinks({ label: 'France', country: 'France' })[0]?.url).toContain('search=France');
    expect(placeLinks({ label: 'Atlantic Ocean' })[0]?.url).toContain('search=Atlantic%20Ocean');
  });
});
