import type maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'preact/hooks';
import { searchPlaces, type PlaceHit } from '../geo/search';
import { isMobile, padding } from '../map/mapView';
import { activeRepertoire, endRelocate, focus, getState, moveNodeTo, previewRelocate, setCentered } from '../store/store';
import { shieldProps } from './dom';
import { Icon } from './Icon';
import { useStore } from './hooks';
import { toast } from './toast';

const HINT_IDLE = 'Type a city, region or address';

/**
 * "Set location by city" panel (desktop: floating card, mobile: bottom sheet). The target comes from the store
 * (`relocating`); with no target it is a plain "Go to place". Arrow keys / hover preview a result (the map flies there
 * and a ghost of the target appears), Enter / click confirms, Escape restores the previous camera.
 */
export function LocatePanel({ map }: { map: maplibregl.Map }) {
  const { relocating } = useStore();
  const open = !!relocating;
  const target = relocating?.nodeId ?? null;

  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState(HINT_IDLE);
  const [wholeBranch, setWholeBranch] = useState(false);
  // Latest values for timers, async results and window listeners, which outlive a render.
  const live = useRef({ hits, active, wholeBranch, target });
  live.current = { hits, active, wholeBranch, target };
  const timers = useRef({ search: undefined as ReturnType<typeof setTimeout> | undefined, hover: undefined as ReturnType<typeof setTimeout> | undefined, abort: undefined as AbortController | undefined });
  const saved = useRef({ center: map.getCenter(), zoom: map.getZoom(), centered: getState().centered });

  const stopPending = (): void => {
    clearTimeout(timers.current.search);
    clearTimeout(timers.current.hover);
    timers.current.abort?.abort();
  };

  // Opening resets the form and remembers the camera; closing drops pending work.
  useEffect(() => {
    if (!open) return;
    saved.current = { center: map.getCenter(), zoom: map.getZoom(), centered: getState().centered };
    setCentered(false); // the map flies around to preview places
    setQuery('');
    setHits([]);
    setActive(-1);
    setWholeBranch(false);
    setStatus(HINT_IDLE);
    document.documentElement.dataset.locating = '';
    setTimeout(() => input.current?.focus(), 0);
    return () => {
      stopPending();
      delete document.documentElement.dataset.locating;
    };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (open && e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    panel.current?.querySelector('.locate-row.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  /** Flies to a hit, keeping it clear of the panel. */
  function fly(hit: PlaceHit): void {
    const p = padding();
    const w = panel.current as HTMLElement;
    const side = isMobile() ? { right: 0, bottom: (p.bottom ?? 0) + w.offsetHeight } : { right: w.offsetWidth + 32, bottom: 0 };
    const pad = { top: (p.top ?? 0) + 20, bottom: side.bottom + 20, left: 20, right: side.right + 20 };
    if (hit.bbox) map.fitBounds(hit.bbox, { padding: pad, maxZoom: 10, duration: 800 });
    else map.easeTo({ center: hit.lngLat, zoom: 8, padding: { ...p, ...side }, duration: 800 });
  }

  function select(i: number, list = live.current.hits): void {
    const hit = list[i];
    if (!hit) return;
    setActive(i);
    live.current.active = i;
    if (getState().relocating?.nodeId) previewRelocate(hit.lngLat);
    fly(hit);
  }

  function confirm(): void {
    const { hits: list, active: i, wholeBranch: withBranch, target: node } = live.current;
    const hit = list[i];
    if (!hit) return;
    endRelocate();
    if (!node) return; // plain go-to: the camera is already there
    const wasCursor = node === getState().cursor.nodeId;
    moveNodeTo(node, hit.lngLat, withBranch, { label: hit.label });
    if (wasCursor) focus(getState().cursor);
    else toast(`Moved to ${hit.label.split(', ')[0]}`);
  }

  function cancel(): void {
    const from = saved.current;
    endRelocate();
    setCentered(from.centered);
    map.easeTo({ center: from.center, zoom: from.zoom, padding: padding(), duration: 500 });
  }

  function onInput(value: string): void {
    stopPending();
    setQuery(value);
    setHits([]);
    setActive(-1);
    live.current.hits = [];
    live.current.active = -1;
    const q = value.trim();
    if (!q) return setStatus(HINT_IDLE);
    setStatus('Searching…');
    timers.current.search = setTimeout(async () => {
      const ctl = (timers.current.abort = new AbortController());
      let found: PlaceHit[] = [];
      try {
        found = await searchPlaces(q, { signal: ctl.signal });
        setStatus(found.length ? '' : 'No results');
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setStatus('Search unavailable');
      }
      setHits(found);
      live.current.hits = found;
      select(0, found);
    }, 300);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') cancel();
    else if (e.key === 'Enter') confirm();
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length) select((active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
    else return;
    e.preventDefault();
  }

  const rep = activeRepertoire();
  const node = target && rep.hasNode(target) ? rep.node(target) : undefined;
  const title = node ? (node.parentId === null ? 'Move the start board to…' : `Move ${rep.pinLabel(node.id)} to…`) : 'Go to place';
  const current = node ? (node.place?.label ? `Now: ${node.place.label}` : '') : 'Look around without changing anything';

  return (
    <section class="locate" data-testid="locate" role="dialog" aria-label="Set location" hidden={!open} ref={panel} {...shieldProps}>
      <div class="locate-head">
        <div>
          <h2 class="locate-title" data-testid="locate-title">{title}</h2>
          <div class="locate-current muted">{current}</div>
        </div>
        <button type="button" class="locate-close" data-testid="locate-cancel" aria-label="Cancel" onClick={cancel}>
          <Icon name="close" />
        </button>
      </div>
      <input
        ref={input} class="locate-input" type="search" placeholder="Type a city…" data-testid="locate-input" autocomplete="off" aria-label="City"
        value={query} onInput={(e) => onInput(e.currentTarget.value)} onKeyDown={onKeyDown}
      />
      <div class="locate-status muted" data-testid="locate-status">{status}</div>
      <div class="locate-results" data-testid="locate-results" role="listbox">
        {hits.map((hit, i) => {
          const [first = hit.label, ...rest] = hit.label.split(', ');
          return (
            <button
              type="button" class={i === active ? 'locate-row active' : 'locate-row'} data-testid="locate-result" role="option" aria-selected={i === active}
              onPointerMove={(e) => {
                if (e.pointerType !== 'mouse' || i === live.current.active) return;
                clearTimeout(timers.current.hover);
                timers.current.hover = setTimeout(() => select(i), 120);
              }}
              onClick={(e) => {
                clearTimeout(timers.current.hover);
                select(i);
                const type = (e as unknown as PointerEvent).pointerType;
                if (type !== 'touch' && type !== 'pen') confirm();
              }}
            >
              <strong>{first}</strong>
              <span class="muted">{rest.length ? ` ${rest.join(', ')}` : ''}</span>
            </button>
          );
        })}
      </div>
      <label class="locate-branch" hidden={!node || node.children.length === 0}>
        <input type="checkbox" data-testid="locate-subtree" checked={wholeBranch} onChange={(e) => setWholeBranch(e.currentTarget.checked)} />
        {' Move the whole branch too'}
      </label>
      <div class="locate-foot">
        <span class="locate-hint muted">↑↓ preview · Enter confirm · Esc cancel</span>
        <button type="button" class="primary" data-testid="locate-confirm" disabled={active < 0} onClick={confirm}>{node ? 'Move here' : 'Go'}</button>
      </div>
    </section>
  );
}
