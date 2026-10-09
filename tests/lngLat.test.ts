import { describe, expect, it } from 'vitest';
import { sameLngLat, wrapLng, wrapNear } from '../src/geo/lngLat';

describe('lngLat helpers', () => {
  it('wrapLng normalizes into [-180, 180)', () => {
    expect(wrapLng([190, 5])).toEqual([-170, 5]);
    expect(wrapLng([-540, 0])).toEqual([-180, 0]);
    expect(wrapLng([12, 3])).toEqual([12, 3]);
  });
  it('wrapNear picks the copy closest to the reference', () => {
    expect(wrapNear(-170, 175)).toBe(190);
    expect(wrapNear(10, -350)).toBe(-350);
  });
  it('sameLngLat ignores floating-point noise only', () => {
    expect(sameLngLat([1, 2], [1 + 1e-9, 2])).toBe(true);
    expect(sameLngLat([1, 2], [1.001, 2])).toBe(false);
  });
});
