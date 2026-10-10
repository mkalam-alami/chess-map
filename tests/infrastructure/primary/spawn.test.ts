import { describe, expect, it } from 'vitest';
import { angDist, spawnAngles } from '../../../src/infrastructure/primary/map/spawn';

const deg = (a: number): number => Math.round((a * 180) / Math.PI);

describe('angDist', () => {
  it('wraps around the circle', () => {
    expect(angDist(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angDist(-Math.PI * 0.9, Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2);
  });
});

describe('spawnAngles', () => {
  it('starts up-right, then goes opposite to what is taken', () => {
    expect(spawnAngles([], 2).map(deg)).toEqual([-45, 135]);
  });
  it('avoids existing children', () => {
    const [a] = spawnAngles([-Math.PI / 4], 1);
    expect(deg(a as number)).toBe(135);
  });
  it('skips directions that are not allowed, falling back to the start one', () => {
    const [a] = spawnAngles([], 1, (x) => deg(x) === 90);
    expect(deg(a as number)).toBe(90);
    expect(spawnAngles([], 1, () => false).map(deg)).toEqual([-45]);
  });
});
