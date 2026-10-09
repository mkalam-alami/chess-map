import type maplibregl from 'maplibre-gl';
import { ImportError } from './application';
import { app, hooks } from './store/store';
import { el } from './ui/dom';
import { toast } from './ui/toast';

/** Connects the PGN file input and the PGN / Lichess menu items to the application. */
export function wireIntegrations(map: maplibregl.Map): void {
  const input = el('input', '', '', { type: 'file', accept: '.pgn,text/plain', 'data-testid': 'import-pgn-input' });
  input.hidden = true;
  document.body.append(input);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const c = map.getCenter();
      const count = app.importMaps('pgn', await file.text(), { name: file.name, origin: [c.lng, c.lat] });
      toast(count > 1 ? `Imported ${count} maps` : 'Map imported');
    } catch (e) {
      toast(e instanceof ImportError ? e.message : 'Could not import this PGN');
    }
  });

  hooks.menu['export-pgn'] = () => app.exportMap('pgn');
  hooks.menu['import-pgn'] = () => input.click();
  hooks.menu['open-lichess'] = () => {
    app.openInAnalysis().then(
      (outcome) => outcome === 'copied' && toast('PGN copied — paste it into a new study chapter'),
      () => toast('Could not copy the PGN to the clipboard'),
    );
  };
}
