import { describe, expect, it } from 'vitest';
import { curveCoords } from '../src/map/curves';

describe('curveCoords', () => {
  it('has steps+1 points and keeps endpoints', () => {
    const pts = curveCoords([2, 48], [10, 40], 16);
    expect(pts).toHaveLength(17);
    expect(pts[0]).toEqual([2, 48]);
    expect(pts[16]).toEqual([10, 40]);
  });

  it('bulges to the left of a→b, consistently', () => {
    const mid = curveCoords([0, 0], [20, 0], 32)[16] as [number, number];
    expect(mid[0]).toBeCloseTo(10, 5);
    expect(mid[1]).toBeGreaterThan(1.5);
    expect(mid[1]).toBeLessThan(3);
    const back = curveCoords([20, 0], [0, 0], 32)[16] as [number, number];
    expect(back[1]).toBeLessThan(-1.5);
  });

  it('unwraps across the antimeridian', () => {
    const pts = curveCoords([170, 10], [-170, 10], 32);
    expect(pts[32]?.[0]).toBeCloseTo(190, 9);
    for (const [lng] of pts) {
      expect(lng).toBeGreaterThanOrEqual(170 - 1e-9);
      expect(lng).toBeLessThanOrEqual(190 + 1e-9);
    }
  });

  it('handles coincident points', () => {
    const pts = curveCoords([5, 5], [5, 5], 4);
    expect(pts).toHaveLength(5);
    for (const p of pts) expect(p[0]).toBeCloseTo(5, 9);
  });
});
