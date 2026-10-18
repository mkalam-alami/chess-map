import type maplibregl from 'maplibre-gl';
import { render } from 'preact';
import type { ChessMapApp } from '../../../application';
import type { ViewState } from '../viewState';
import { LocatePanel } from './Locate';
import { MapShortcuts } from './Recenter';
import { TopBar } from './TopBar';
import { AppContext } from './hooks';
import { OverlayHost } from './overlay';
import { ToastHost } from './toast';

/** Mounts the Preact UI. `root` is laid out with `display: contents`, so its children position against #app like before. */
export function mountUi(root: HTMLElement, map: maplibregl.Map, app: ChessMapApp, view: ViewState): void {
  render(
    <AppContext.Provider value={{ app, view }}>
      <TopBar getCenter={() => { const c = map.getCenter(); return [c.lng, c.lat]; }} />
      <MapShortcuts map={map} />
      <LocatePanel map={map} />
      <OverlayHost />
      <ToastHost />
    </AppContext.Provider>,
    root,
  );
}
