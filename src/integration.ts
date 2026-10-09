import type maplibregl from 'maplibre-gl';
import { reverseGeocode } from './geo/reverse';
import { lichessTarget } from './lichess/url';
import { PgnImportError, importPgn } from './pgn/import';
import { exportPgn } from './pgn/export';
import type { LngLat, NodeId } from './domain';
import { activeMap, addMap, getState, hooks, setPlace } from './store/store';
import { download, el } from './ui/dom';
import { toast } from './ui/toast';

const inflight = new Map<NodeId, AbortController>();

/** Reverse-geocodes a node (the latest lookup per node wins; network failures are ignored). */
async function geocode(nodeId: NodeId, lngLat: LngLat): Promise<void> {
  inflight.get(nodeId)?.abort();
  const ctl = new AbortController();
  inflight.set(nodeId, ctl);
  try {
    const place = await reverseGeocode(lngLat, { signal: ctl.signal });
    // The domain drops the result if the node was removed or moved (e.g. set by city) while the lookup was in flight.
    if (!ctl.signal.aborted) setPlace(nodeId, place ?? { label: 'Open sea' }, lngLat);
  } catch {
    /* offline / rate limited: leave the place empty */
  } finally {
    if (inflight.get(nodeId) === ctl) inflight.delete(nodeId);
  }
}

/** Connects geocoding and the PGN / Lichess menu items to the store hooks. */
export function wireIntegrations(map: maplibregl.Map): void {
  hooks.onNodePlaced = (id, ll) => void geocode(id, ll);
  const root = activeMap().nodes[activeMap().rootId];
  if (root && !root.place) void geocode(root.id, root.lngLat);

  const input = el('input', '', '', { type: 'file', accept: '.pgn,text/plain', 'data-testid': 'import-pgn-input' });
  input.hidden = true;
  document.body.append(input);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const c = map.getCenter();
      const maps = importPgn(await file.text(), { name: file.name.replace(/\.pgn$/i, ''), origin: [c.lng, c.lat] });
      for (const m of maps) addMap(m);
      toast(maps.length > 1 ? `Imported ${maps.length} maps` : 'Map imported');
    } catch (e) {
      toast(e instanceof PgnImportError ? e.message : 'Could not import this PGN');
    }
  });

  hooks.menu['export-pgn'] = () => download(`${activeMap().name}.pgn`, exportPgn(activeMap()), 'application/x-chess-pgn');
  hooks.menu['import-pgn'] = () => input.click();
  hooks.menu['open-lichess'] = () => {
    const target = lichessTarget(activeMap(), getState().cursor);
    if (target.kind === 'url') {
      window.open(target.url, '_blank', 'noopener');
      return;
    }
    void navigator.clipboard
      .writeText(target.pgn)
      .then(() => {
        window.open(target.url, '_blank', 'noopener');
        toast('PGN copied — paste it into a new study chapter');
      })
      .catch(() => toast('Could not copy the PGN to the clipboard'));
  };
}
