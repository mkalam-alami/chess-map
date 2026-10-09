import type maplibregl from 'maplibre-gl';
import { searchPlaces, type PlaceHit } from '../geo/search';
import { isMobile, padding } from '../map/mapView';
import { pinLabel } from '../map/pinMarker';
import { activeMap, endRelocate, focus, getState, moveNodeTo, previewRelocate, setCentered, subscribe } from '../store/store';
import { button, el, shieldFromMap } from './dom';
import { icon } from './icons';
import { toast } from './toast';

/**
 * "Set location by city" panel (desktop: floating card, mobile: bottom sheet). The target comes from the store
 * (`relocating`); with no target it is a plain "Go to place". Arrow keys / hover preview a result (the map flies there
 * and a ghost of the target appears), Enter / click confirms, Escape restores the previous camera.
 */
export function createLocate(app: HTMLElement, map: maplibregl.Map): void {
  const panel = el('section', 'locate', '', { 'data-testid': 'locate', role: 'dialog', 'aria-label': 'Set location' });
  const title = el('h2', 'locate-title', '', { 'data-testid': 'locate-title' });
  const current = el('div', 'locate-current muted');
  const close = button('', 'locate-cancel', 'locate-close');
  close.append(icon('close', 18));
  close.setAttribute('aria-label', 'Cancel');
  const head = el('div', 'locate-head');
  const heading = el('div');
  heading.append(title, current);
  head.append(heading, close);
  const input = el('input', 'locate-input', '', { type: 'search', placeholder: 'Type a city…', 'data-testid': 'locate-input', autocomplete: 'off', 'aria-label': 'City' });
  const status = el('div', 'locate-status muted', '', { 'data-testid': 'locate-status' });
  const list = el('div', 'locate-results', '', { 'data-testid': 'locate-results', role: 'listbox' });
  const branchLabel = el('label', 'locate-branch', ' Move the whole branch too');
  const branch = el('input', '', '', { type: 'checkbox', 'data-testid': 'locate-subtree' });
  branchLabel.prepend(branch);
  const hint = el('span', 'locate-hint muted', '↑↓ preview · Enter confirm · Esc cancel');
  const ok = button('Move here', 'locate-confirm', 'primary');
  const foot = el('div', 'locate-foot');
  foot.append(hint, ok);
  panel.append(head, input, status, list, branchLabel, foot);
  panel.hidden = true;
  shieldFromMap(panel);
  app.append(panel);

  let open = false;
  let hits: PlaceHit[] = [];
  let rows: HTMLButtonElement[] = [];
  let active = -1;
  let saved = { center: map.getCenter(), zoom: map.getZoom(), centered: getState().centered };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hover: ReturnType<typeof setTimeout> | undefined;
  let abort: AbortController | undefined;

  /** Flies to a hit, keeping it clear of the panel. */
  function fly(hit: PlaceHit): void {
    const p = padding();
    const side = isMobile() ? { right: 0, bottom: (p.bottom ?? 0) + panel.offsetHeight } : { right: panel.offsetWidth + 32, bottom: 0 };
    const pad = { top: (p.top ?? 0) + 20, bottom: side.bottom + 20, left: 20, right: side.right + 20 };
    if (hit.bbox) map.fitBounds(hit.bbox, { padding: pad, maxZoom: 10, duration: 800 });
    else map.easeTo({ center: hit.lngLat, zoom: 8, padding: { ...p, ...side }, duration: 800 });
  }

  function select(i: number): void {
    const hit = hits[i];
    if (!hit) return;
    active = i;
    rows.forEach((r, k) => {
      r.classList.toggle('active', k === i);
      r.setAttribute('aria-selected', String(k === i));
    });
    rows[i]?.scrollIntoView({ block: 'nearest' });
    ok.disabled = false;
    if (getState().relocating?.nodeId) previewRelocate(hit.lngLat);
    fly(hit);
  }

  function confirm(): void {
    const hit = hits[active];
    const target = getState().relocating?.nodeId;
    if (!hit) return;
    endRelocate();
    if (!target) return; // plain go-to: the camera is already there
    const wasCursor = target === getState().cursor.nodeId;
    moveNodeTo(target, hit.lngLat, branch.checked, { label: hit.label });
    if (wasCursor) focus(getState().cursor);
    else toast(`Moved to ${hit.label.split(', ')[0]}`);
  }

  function cancel(): void {
    const from = saved;
    endRelocate();
    setCentered(from.centered);
    map.easeTo({ center: from.center, zoom: from.zoom, padding: padding(), duration: 500 });
  }

  function renderResults(): void {
    list.replaceChildren();
    rows = hits.map((hit, i) => {
      const [first = hit.label, ...rest] = hit.label.split(', ');
      const row = button('', 'locate-result', 'locate-row');
      row.setAttribute('role', 'option');
      row.append(el('strong', '', first), el('span', 'muted', rest.length ? ` ${rest.join(', ')}` : ''));
      row.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse' || i === active) return;
        clearTimeout(hover);
        hover = setTimeout(() => select(i), 120);
      });
      row.addEventListener('click', (e) => {
        clearTimeout(hover);
        select(i);
        const type = (e as PointerEvent).pointerType;
        if (type !== 'touch' && type !== 'pen') confirm();
      });
      list.append(row);
      return row;
    });
    active = -1;
    ok.disabled = true;
    if (hits.length) select(0);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    abort?.abort();
    const q = input.value.trim();
    hits = [];
    renderResults();
    if (!q) {
      status.textContent = 'Type a city, region or address';
      return;
    }
    status.textContent = 'Searching…';
    timer = setTimeout(async () => {
      abort = new AbortController();
      try {
        hits = await searchPlaces(q, { signal: abort.signal });
        status.textContent = hits.length ? '' : 'No results';
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        hits = [];
        status.textContent = 'Search unavailable';
      }
      renderResults();
    }, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cancel();
    else if (e.key === 'Enter') confirm();
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) select((active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
    else return;
    e.preventDefault();
  });
  window.addEventListener('keydown', (e) => {
    if (open && e.key === 'Escape') cancel();
  });
  close.addEventListener('click', cancel);
  ok.addEventListener('click', confirm);

  subscribe(() => {
    const r = getState().relocating;
    if (r && !open) {
      open = true;
      saved = { center: map.getCenter(), zoom: map.getZoom(), centered: getState().centered };
      setCentered(false); // the map flies around to preview places
      const m = activeMap();
      const node = r.nodeId ? m.nodes[r.nodeId] : undefined;
      title.textContent = node ? (node.parentId === null ? 'Move the start board to…' : `Move ${pinLabel(m, node)} to…`) : 'Go to place';
      current.textContent = node ? (node.place?.label ? `Now: ${node.place.label}` : '') : 'Look around without changing anything';
      branchLabel.hidden = !node || node.children.length === 0;
      branch.checked = false;
      ok.textContent = node ? 'Move here' : 'Go';
      input.value = '';
      hits = [];
      renderResults();
      status.textContent = 'Type a city, region or address';
      panel.hidden = false;
      document.documentElement.dataset.locating = '';
      setTimeout(() => input.focus(), 0);
    } else if (!r && open) {
      open = false;
      clearTimeout(timer);
      clearTimeout(hover);
      abort?.abort();
      panel.hidden = true;
      delete document.documentElement.dataset.locating;
    }
  });
}
