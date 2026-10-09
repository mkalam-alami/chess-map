import type maplibregl from 'maplibre-gl';
import { render } from 'preact';
import { LocatePanel } from './Locate';
import { RecenterButton } from './Recenter';
import { NavButtons, TopBar } from './TopBar';
import { OverlayHost } from './overlay';
import { ToastHost } from './toast';

/** Mounts the Preact UI. `root` is laid out with `display: contents`, so its children position against #app like before. */
export function mountUi(root: HTMLElement, map: maplibregl.Map): void {
  render(
    <>
      <TopBar getCenter={() => { const c = map.getCenter(); return [c.lng, c.lat]; }} />
      <NavButtons />
      <RecenterButton />
      <LocatePanel map={map} />
      <OverlayHost />
      <ToastHost />
    </>,
    root,
  );
}
