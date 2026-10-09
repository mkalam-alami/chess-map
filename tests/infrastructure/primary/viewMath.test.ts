import { describe, expect, it } from 'vitest';
import { NOMINAL_PX } from '../../../src/domain';
import { boardPx, comfortPx, focusZoom, gripResize, maxZoomToFit } from '../../../src/map/viewMath';

describe('boardPx', () => {
  const view = { width: 1280, height: 630 };
  it('renders at nominal size at the board zoom and doubles per zoom level', () => {
    expect(boardPx(1.5, 1.5, view, 200)).toBe(NOMINAL_PX);
    expect(boardPx(2.5, 1.5, { width: 2000, height: 2000 }, 200)).toBe(NOMINAL_PX * 2);
    expect(boardPx(0.5, 1.5, view, 100)).toBe(NOMINAL_PX / 2);
  });
  it('clamps to [min, 90% of the smaller side]', () => {
    expect(boardPx(-5, 1.5, view, 200)).toBe(200);
    expect(boardPx(10, 1.5, view, 200)).toBeCloseTo(567);
    expect(boardPx(10, 1.5, { width: 300, height: 900 }, 200)).toBeCloseTo(270);
  });
});

describe('focus zoom', () => {
  it('comfort size follows the desktop and mobile formulas', () => {
    expect(comfortPx({ width: 1280, height: 720 }, false)).toBeCloseTo(302.4);
    expect(comfortPx({ width: 3000, height: 3000 }, false)).toBe(480);
    expect(comfortPx({ width: 375, height: 667 }, true)).toBeCloseTo(306.82);
  });
  it('focusZoom puts the board at comfort size unless children force zooming out', () => {
    const o = { boardZoom: 1.5, comfort: 640, fit: Infinity, minZoom: 0, maxZoom: 22 };
    expect(focusZoom(o)).toBeCloseTo(2.5);
    expect(focusZoom({ ...o, boardZoom: 4.5 })).toBeCloseTo(5.5); // smaller sub-board: zoom in
    expect(focusZoom({ ...o, fit: 1.2 })).toBe(1.2);
    expect(focusZoom({ ...o, fit: -3 })).toBe(0);
    expect(focusZoom({ ...o, boardZoom: 30 })).toBe(22);
  });
  it('maxZoomToFit limits by the farthest child', () => {
    expect(maxZoomToFit([], 100, 100)).toBe(Infinity);
    const z = maxZoomToFit([{ dx: 0.1, dy: 0 }, { dx: 0, dy: 0.05 }], 400, 200);
    expect(z).toBeCloseTo(Math.min(Math.log2(400 / 51.2), Math.log2(200 / 25.6)));
  });
});

describe('gripResize', () => {
  const o = { z0: 3, bz0: 3, minPx: 200, maxPx: 500, minZoom: 0, maxZoom: 22 };
  /** Width the board renders at after the resize. */
  const rendered = (r: { mapZoom: number; extra: number }): number => NOMINAL_PX * 2 ** (r.mapZoom - (o.bz0 - r.extra));

  it('keeps the camera inside the clamp range', () => {
    const r = gripResize({ ...o, desiredPx: 400 });
    expect(r.mapZoom).toBe(3);
    expect(r.extra).toBeCloseTo(Math.log2(400 / NOMINAL_PX));
  });
  it('zooms out when growing past the max, keeping the rendered size pinned', () => {
    const r = gripResize({ ...o, desiredPx: 2000 });
    expect(r.mapZoom).toBeCloseTo(3 - 2); // log2(2000/500)
    expect(rendered(r)).toBeCloseTo(500);
    expect(r.extra).toBeCloseTo(Math.log2(2000 / NOMINAL_PX));
  });
  it('zooms in when shrinking past the min', () => {
    const r = gripResize({ ...o, desiredPx: 50 });
    expect(r.mapZoom).toBeCloseTo(3 + 2);
    expect(rendered(r)).toBeCloseTo(200);
  });
  it('stops changing the size once the camera hits its zoom limit', () => {
    const a = gripResize({ ...o, minZoom: 2, desiredPx: 1000 });
    const b = gripResize({ ...o, minZoom: 2, desiredPx: 8000 });
    expect(a.mapZoom).toBeCloseTo(2);
    expect(b.mapZoom).toBe(2);
    expect(b.extra).toBeCloseTo(a.extra, 5); // same limit => same extra
  });
});
