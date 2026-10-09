import { describe, expect, it } from 'vitest';
import { addChild, appendPly, branchAt, createLibrary, createMap, setPinned, setSizeDelta } from '../src/model/tree';
import { DEFAULT_BOARD_ZOOM, NOMINAL_PX, boardPx, comfortPx, effectiveBoardZoom, focusZoom, maxZoomToFit } from '../src/model/scale';
import { deserializeLibrary, serializeLibrary, ValidationError } from '../src/model/serialize';
import { getNode } from '../src/model/types';
import { exportPgn } from '../src/pgn/export';
import { importPgn } from '../src/pgn/import';

const base = () => {
  const m = createMap('t', 'white', [0, 0]);
  const a = addChild(m, m.rootId, 'e4', [1, 1]);
  const b = addChild(a.map, a.nodeId, 'e5', [2, 2]);
  return { m: b.map, a: a.nodeId, b: b.nodeId };
};

describe('board scale model', () => {
  it('effectiveBoardZoom sums deltas from the root', () => {
    const { m, a, b } = base();
    expect(effectiveBoardZoom(m, b)).toBe(DEFAULT_BOARD_ZOOM);
    const m2 = setSizeDelta(setSizeDelta(m, a, 1), b, -0.5);
    expect(effectiveBoardZoom(m2, a)).toBe(DEFAULT_BOARD_ZOOM - 1);
    expect(effectiveBoardZoom(m2, b)).toBe(DEFAULT_BOARD_ZOOM - 0.5);
    expect(effectiveBoardZoom({ ...m2, boardZoom: 3 }, m.rootId)).toBe(3);
  });

  it('setSizeDelta rounds to 0.25 and clears zero', () => {
    const { m, a } = base();
    expect(getNode(setSizeDelta(m, a, 0.4), a).sizeDelta).toBe(0.5);
    expect('sizeDelta' in getNode(setSizeDelta(setSizeDelta(m, a, 1), a, 0.1), a)).toBe(false);
  });

  it('a split tail keeps the same effective board size', () => {
    let m = createMap('t', 'white', [0, 0]);
    const a = addChild(m, m.rootId, 'e4', [1, 1]);
    m = setPinned(a.map, a.nodeId, true);
    m = appendPly(appendPly(m, a.nodeId, 'e5'), a.nodeId, 'Nf3');
    m = setSizeDelta(m, a.nodeId, 1);
    const r = branchAt(m, { nodeId: a.nodeId, ply: 2 }, 'Nc3', [3, 3]);
    const tail = getNode(r.map, a.nodeId).children[0] as string;
    expect(getNode(r.map, tail).sizeDelta).toBeUndefined();
    expect(effectiveBoardZoom(r.map, tail)).toBe(effectiveBoardZoom(r.map, a.nodeId));
  });

  it('serialization validates the optional numbers', () => {
    const { m, a } = base();
    const ok = { ...setSizeDelta(m, a, 0.75), boardZoom: 2 };
    const back = deserializeLibrary(serializeLibrary(createLibrary(ok)));
    expect(back.maps[ok.id]?.boardZoom).toBe(2);
    expect(getNode(back.maps[ok.id]!, a).sizeDelta).toBe(0.75);
    const bad = JSON.parse(serializeLibrary(createLibrary(ok)));
    bad.maps[ok.id].nodes[a].sizeDelta = 'big';
    expect(() => deserializeLibrary(bad)).toThrow(ValidationError);
  });

  it('survives a PGN round trip', () => {
    const { m, a, b } = base();
    const sized = { ...setSizeDelta(setSizeDelta(m, a, 0.5), b, -1.25), boardZoom: 2.5 };
    const [back] = importPgn(exportPgn(sized));
    expect(back?.boardZoom).toBe(2.5);
    const ids = Object.values(back!.nodes).filter((n) => n.parentId);
    expect(ids.map((n) => n.sizeDelta)).toEqual([0.5, -1.25]);
  });
});

describe('board px and focus zoom', () => {
  const view = { width: 1280, height: 630 };
  it('renders at nominal size at the board zoom and doubles per zoom level', () => {
    expect(boardPx(1.5, 1.5, view, 200)).toBe(NOMINAL_PX);
    expect(boardPx(2.5 - 1, 1.5, view, 200)).toBe(NOMINAL_PX);
    expect(boardPx(0.5, 1.5, view, 100)).toBe(NOMINAL_PX / 2);
  });
  it('clamps to [min, 90% of the smaller side]', () => {
    expect(boardPx(-5, 1.5, view, 200)).toBe(200);
    expect(boardPx(10, 1.5, view, 200)).toBeCloseTo(567);
    expect(boardPx(10, 1.5, { width: 300, height: 900 }, 200)).toBeCloseTo(270);
  });
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

import { gripResize } from '../src/model/scale';

describe('gripResize', () => {
  const o = { z0: 3, bz0: 3, minPx: 200, maxPx: 500, minZoom: 0, maxZoom: 22 };
  it('keeps the camera inside the clamp range', () => {
    const r = gripResize({ ...o, desiredPx: 400 });
    expect(r.mapZoom).toBe(3);
    expect(r.extra).toBeCloseTo(Math.log2(400 / NOMINAL_PX));
  });
  it('zooms out when growing past the max, keeping the rendered size pinned', () => {
    const r = gripResize({ ...o, desiredPx: 2000 });
    expect(r.mapZoom).toBeCloseTo(3 - 2); // log2(2000/500)
    const rendered = NOMINAL_PX * 2 ** (r.mapZoom - (o.bz0 - r.extra));
    expect(rendered).toBeCloseTo(500);
    expect(r.extra).toBeCloseTo(Math.log2(2000 / NOMINAL_PX));
  });
  it('zooms in when shrinking past the min', () => {
    const r = gripResize({ ...o, desiredPx: 50 });
    expect(r.mapZoom).toBeCloseTo(3 + 2);
    expect(NOMINAL_PX * 2 ** (r.mapZoom - (o.bz0 - r.extra))).toBeCloseTo(200);
  });
  it('stops changing the size once the camera hits its zoom limit', () => {
    const a = gripResize({ ...o, minZoom: 2, desiredPx: 1000 });
    const b = gripResize({ ...o, minZoom: 2, desiredPx: 8000 });
    expect(a.mapZoom).toBeCloseTo(2);
    expect(b.mapZoom).toBe(2);
    expect(b.extra).toBeCloseTo(a.extra, 5); // same limit => same extra
  });
});
