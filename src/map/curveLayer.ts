import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import { getNode, type LngLat, type MapNode } from '../model/types';
import { pathTo } from '../model/tree';
import { activeMap, getState, subscribe, subscribePlacing } from '../store/store';
import { sameLngLat } from '../geo/lngLat';
import { curveCoords } from './curves';
import { onOverride, overrides } from './live';

type Kind = 'active' | 'ancestor' | 'overview' | 'ghost';
const RANK: Record<Kind, number> = { overview: 0, ancestor: 1, active: 2, ghost: 3 };

const SOURCE = 'chess-map-curves';
const ARROW = 'chess-map-arrow';

/** Small right-pointing triangle drawn on a canvas (no font glyphs needed). */
function arrowImage(): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#6b4423';
  ctx.strokeStyle = '#fbf5e9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(6, 4);
  ctx.lineTo(20, 12);
  ctx.lineTo(6, 20);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  return ctx.getImageData(0, 0, 24, 24);
}

/** One GeoJSON source of curved edges; layers are added once the style has loaded. */
export function createCurveLayer(map: MlMap): { update: () => void } {
  let ready = false;
  let queued = false;

  function edges(): { a: MapNode; b: MapNode; kind: Kind }[] {
    const s = getState();
    const m = activeMap();
    const found = new Map<string, { a: MapNode; b: MapNode; kind: Kind }>();
    const add = (a: MapNode, b: MapNode, kind: Kind): void => {
      const key = `${a.id}>${b.id}`;
      const old = found.get(key);
      if (!old || RANK[kind] > RANK[old.kind]) found.set(key, { a, b, kind });
    };
    const node = getNode(m, s.cursor.nodeId);
    if (s.overview) for (const n of Object.values(m.nodes)) if (n.parentId) add(getNode(m, n.parentId), n, 'overview');
    const path = pathTo(m, node.id);
    for (let i = 1; i < path.length; i++) add(getNode(m, path[i - 1] as string), getNode(m, path[i] as string), 'ancestor');
    if (s.cursor.ply === node.plies.length) for (const c of node.children) add(node, getNode(m, c), 'active');
    const rel = s.relocating;
    const target = rel?.nodeId ? m.nodes[rel.nodeId] : undefined;
    if (rel?.preview && target?.parentId) add(getNode(m, target.parentId), { ...target, id: '__relocate', lngLat: rel.preview }, 'ghost');
    if (s.placing) add(node, { ...node, id: '__ghost', lngLat: s.placing.lngLat }, 'ghost');
    return [...found.values()];
  }

  function draw(): void {
    queued = false;
    if (!ready) return;
    const pos = (n: MapNode): LngLat => overrides.get(n.id) ?? n.lngLat;
    const features = edges().flatMap(({ a, b, kind }) => {
      const pa = pos(a);
      const pb = pos(b);
      if (sameLngLat(pa, pb)) return [];
      return [{ type: 'Feature' as const, properties: { kind }, geometry: { type: 'LineString' as const, coordinates: curveCoords(pa, pb) } }];
    });
    (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  const update = (): void => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(draw);
  };

  function addLayers(): void {
    if (map.getSource(SOURCE)) return;
    map.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const line = (kind: Kind, paint: Record<string, unknown>): void => {
      map.addLayer({
        id: `${SOURCE}-${kind}`, type: 'line', source: SOURCE, filter: ['==', ['get', 'kind'], kind],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint,
      } as never);
    };
    line('overview', { 'line-color': '#5a4130', 'line-width': 1.5, 'line-opacity': 0.25 });
    line('ancestor', { 'line-color': '#8a5a2b', 'line-width': 2.5, 'line-opacity': 0.4, 'line-dasharray': [2, 2] });
    line('ghost', { 'line-color': '#d9902a', 'line-width': 3.5, 'line-opacity': 0.9, 'line-dasharray': [1.5, 1.5] });
    line('active', { 'line-color': '#6b4423', 'line-width': 3.5, 'line-opacity': 0.9 });
    if (!map.hasImage(ARROW)) map.addImage(ARROW, arrowImage());
    const arrow = (kind: Kind, opacity: number): void => {
      map.addLayer({
        id: `${SOURCE}-${kind}-arrow`, type: 'symbol', source: SOURCE, filter: ['==', ['get', 'kind'], kind],
        layout: { 'symbol-placement': 'line-center', 'icon-image': ARROW, 'icon-size': 0.7, 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true },
        paint: { 'icon-opacity': opacity },
      } as never);
    };
    arrow('ancestor', 0.45);
    arrow('active', 1);
    ready = true;
    draw();
  }

  map.on('load', addLayers);
  map.on('style.load', () => {
    ready = false;
    addLayers();
  });
  subscribe(update);
  subscribePlacing(update);
  onOverride(update);
  return { update };
}
