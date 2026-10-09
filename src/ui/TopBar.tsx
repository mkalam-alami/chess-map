import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { openingAt, openingText } from '../chess/openings';
import { formatLine, sanPath } from '../chess/replay';
import { lineCursors } from '../model/cursor';
import { findTranspositions } from '../model/tree';
import { ValidationError } from '../model/serialize';
import { getNode, type Cursor, type LngLat } from '../model/types';
import {
  activeMap, back, beginRelocate, canUndoPly, deleteMap, duplicateMap, exportActiveMapJson, flipOrientation, focus, forward,
  getState, hooks, importMapJson, newMap, renameMap, setMode, switchMap, toggleOverview, togglePin, undoPly,
} from '../store/store';
import { download } from './dom';
import { Icon } from './Icon';
import { openingsLoaded, useAtom, useStore } from './hooks';
import { confirmDialog, formDialog, openPopover } from './overlay';
import { toast } from './toast';

const menuHook = (id: keyof typeof hooks.menu) => (): void => hooks.menu[id]?.();

function MenuItem({ label, testid, close, run }: { label: string; testid: string; close: () => void; run: () => void | Promise<void> }) {
  return (
    <button type="button" class="menu-item" data-testid={testid} onClick={() => { close(); void run(); }}>{label}</button>
  );
}

function Menu({ close, getCenter, pickJson }: { close: () => void; getCenter: () => LngLat; pickJson: () => void }) {
  const item = (label: string, testid: string, run: () => void | Promise<void>) => <MenuItem label={label} testid={testid} close={close} run={run} />;
  return (
    <div class="menu">
      <div class="menu-label">View</div>
      {item('Go to place…', 'menu-goto', () => beginRelocate(null))}
      <div class="menu-label">Import / export</div>
      {item('Export JSON', 'menu-export-json', () => download(`${activeMap().name}.chessmap.json`, exportActiveMapJson()))}
      {item('Import JSON…', 'menu-import-json', pickJson)}
      {item('Export PGN', 'menu-export-pgn', menuHook('export-pgn'))}
      {item('Import PGN…', 'menu-import-pgn', menuHook('import-pgn'))}
      <div class="menu-label">Share</div>
      {item('Open in Lichess', 'menu-open-lichess', menuHook('open-lichess'))}
      <div class="menu-label">Map</div>
      {item('New map…', 'menu-new-map', async () => {
        const r = await formDialog('New map', [
          { name: 'name', label: 'Name', value: 'New repertoire' },
          { name: 'orientation', label: 'Play as', value: 'white', options: [['white', 'White'], ['black', 'Black']] },
        ], 'Create');
        if (r) newMap(r.name ?? '', r.orientation === 'black' ? 'black' : 'white', getCenter());
      })}
      {item('Rename map…', 'menu-rename-map', async () => {
        const r = await formDialog('Rename map', [{ name: 'name', label: 'Name', value: activeMap().name }], 'Rename');
        if (r) renameMap(r.name ?? '');
      })}
      {item('Duplicate map', 'menu-duplicate-map', duplicateMap)}
      {item('Flip board orientation', 'menu-flip', flipOrientation)}
      {item('Delete map…', 'menu-delete-map', async () => {
        if (Object.keys(getState().library.maps).length <= 1) return toast('Cannot delete the last map');
        if (await confirmDialog(`Delete map "${activeMap().name}"?`, 'Delete')) deleteMap();
      })}
    </div>
  );
}

const placeText = (label: string, country?: string): string => (country && !label.includes(country) ? `${label}, ${country}` : label);

export function TopBar({ getCenter }: { getCenter: () => LngLat }) {
  const s = useStore();
  useAtom(openingsLoaded); // opening names arrive after the first render
  const bar = useRef<HTMLElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const m = activeMap();
  const edit = s.mode === 'edit';

  useEffect(() => {
    document.documentElement.dataset.mode = s.mode;
  }, [s.mode]);
  useEffect(() => {
    const el = bar.current as HTMLElement;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sans = sanPath(m, s.cursor);
  const cursors = lineCursors(m, s.cursor);
  useLayoutEffect(() => {
    const el = line.current as HTMLDivElement;
    el.scrollLeft = el.scrollWidth; // keep the latest ply in view
  });

  const op = openingAt(m, s.cursor);
  const pl = getNode(m, s.cursor.nodeId).place;
  const place = pl ? placeText(pl.label, pl.country) : '';
  const others = s.cursor.ply > 0 ? findTranspositions(m, s.cursor) : [];
  const chipTarget: Cursor | undefined = others[0];

  const importJson = async (e: Event): Promise<void> => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      importMapJson(await file.text());
      toast('Map imported');
    } catch (err) {
      toast(err instanceof ValidationError ? err.message : 'Could not import this file');
    }
  };

  return (
    <header class="topbar" ref={bar}>
      <div class="tb-main">
        {/* Identity: the map switcher reads as a title (a real <select> underneath). */}
        <label class="map-pick">
          <Icon name="knight" size={20} />
          <select class="map-select" data-testid="map-select" aria-label="Map" value={s.activeMapId} onChange={(e) => switchMap(e.currentTarget.value)}>
            {Object.values(s.library.maps).map((lm) => <option value={lm.id}>{lm.name}</option>)}
          </select>
          <Icon name="chevron" size={14} />
        </label>

        {/* Mode: a two-state segmented control. */}
        <div class="mode-seg" data-testid="mode-toggle" data-mode={s.mode} role="radiogroup" aria-label="Mode">
          {(['explore', 'edit'] as const).map((mode) => (
            <button
              type="button" role="radio" data-testid={`mode-${mode}`} class={mode === s.mode ? 'seg on' : 'seg'} aria-checked={mode === s.mode}
              title={mode === 'edit' ? 'Edit the repertoire (E)' : 'Explore and train (E)'} onClick={() => setMode(mode)}
            >
              <Icon name={mode} size={16} />
              <span>{mode === 'edit' ? 'Edit' : 'Explore'}</span>
            </button>
          ))}
        </div>

        <div class="tb-right">
          {/* Edit-only tools, visually part of the edit accent. */}
          <div class="tb-edit" hidden={!edit}>
            <button type="button" data-testid="pin-toggle" class={s.pin ? 'tool active' : 'tool'} aria-pressed={s.pin} title="Record moves into one pinned board (P)" onClick={togglePin}>
              <Icon name="pin" size={16} />
              <span>Pin</span>
            </button>
            <button type="button" data-testid="undo-ply" class="tool" disabled={!canUndoPly()} title="Remove the last recorded ply (Ctrl+Z)" onClick={undoPly}>
              <Icon name="undo" size={16} />
              <span>Undo ply</span>
            </button>
          </div>
          <button type="button" data-testid="overview-toggle" class={s.overview ? 'tool view-tool active' : 'tool view-tool'} aria-pressed={s.overview} title="Show the whole tree, faded" onClick={toggleOverview}>
            <Icon name="layers" size={18} />
            <span class="label">Overview</span>
          </button>
          <button
            type="button" ref={menuBtn} data-testid="menu-button" class="tool menu-button" aria-label="Menu" title="Map, import / export, Lichess"
            onClick={() => openPopover(menuBtn.current as HTMLElement, (close) => <Menu close={close} getCenter={getCenter} pickJson={() => fileInput.current?.click()} />)}
          >
            <Icon name="more" size={18} />
          </button>
        </div>
      </div>

      {/* Context: the line (primary), where it is (secondary), and its transpositions. */}
      <div class="tb-context">
        <div class="tb-linecol">
          <div class="line" data-testid="line" ref={line}>
            {sans.map((san, i) => (
              <>
                {i > 0 && ' '}
                <button type="button" class={i === sans.length - 1 ? 'ply current' : 'ply'} data-testid="line-ply" onClick={() => focus(cursors[i] as Cursor)}>
                  {i % 2 === 0 ? formatLine([san], i) : san}
                </button>
              </>
            ))}
          </div>
          <button type="button" class="chip" data-testid="transposition" hidden={!chipTarget} onClick={() => chipTarget && focus(chipTarget)}>
            {chipTarget && `⇄ also reached via ${formatLine(sanPath(m, chipTarget))}${others.length > 1 ? ` (+${others.length - 1})` : ''}`}
          </button>
        </div>
        <div class={op && !op.exact ? 'opening inexact' : 'opening'} data-testid="opening" hidden={!op} title={op ? `${op.eco} · ${openingText(op)}` : ''}>
          <span class="opening-name" data-testid="opening-name">{op && openingText(op)}</span>
        </div>
        <button type="button" class="place" data-testid="place-label" disabled={!edit} title={edit ? 'Set location by city (L)' : place} onClick={() => edit && beginRelocate(s.cursor.nodeId)}>
          {place}
        </button>
      </div>

      <input type="file" accept=".json,application/json" data-testid="import-json-input" hidden ref={fileInput} onChange={importJson} />
    </header>
  );
}

export function NavButtons() {
  const { cursor } = useStore();
  const n = sanPath(activeMap(), cursor).length;
  return (
    <div class="nav-buttons">
      <button type="button" class="nav" data-testid="btn-back" title="Back (←)" aria-label="Back" onClick={back}>
        <Icon name="chevron" size={22} />
      </button>
      <span class="ply-count" data-testid="ply-count">{n ? `Ply ${n}` : 'Start'}</span>
      <button type="button" class="nav" data-testid="btn-forward" title="Forward (→)" aria-label="Forward" onClick={() => void forward()}>
        <Icon name="chevron" size={22} />
      </button>
    </div>
  );
}
