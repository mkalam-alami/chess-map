import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { formatLine, openingText, type Cursor, type LngLat } from '../../../domain';
import type { ChessMapApp } from '../../../application';
import { importFile, openInAnalysis } from './actions';
import { Icon } from './Icon';
import { useApp, useViewState } from './hooks';
import { confirmDialog, formDialog, openPopover } from './overlay';
import { toast } from './toast';

function MenuItem({ label, testid, close, run }: { label: string; testid: string; close: () => void; run: () => void | Promise<void> }) {
  return (
    <button type="button" class="menu-item" data-testid={testid} onClick={() => { close(); void run(); }}>{label}</button>
  );
}

function Menu({ app, close, getCenter, pickJson, pickPgn }: { app: ChessMapApp; close: () => void; getCenter: () => LngLat; pickJson: () => void; pickPgn: () => void }) {
  const item = (label: string, testid: string, run: () => void | Promise<void>) => <MenuItem label={label} testid={testid} close={close} run={run} />;
  return (
    <div class="menu">
      <div class="menu-label">View</div>
      {item('Go to place…', 'menu-goto', () => app.startRelocating(null))}
      <div class="menu-label">Import / export</div>
      {item('Export JSON', 'menu-export-json', () => app.exportMap('json'))}
      {item('Import JSON…', 'menu-import-json', pickJson)}
      {item('Export PGN', 'menu-export-pgn', () => app.exportMap('pgn'))}
      {item('Import PGN…', 'menu-import-pgn', pickPgn)}
      <div class="menu-label">Share</div>
      {item('Open in Lichess', 'menu-open-lichess', () => openInAnalysis(app))}
      <div class="menu-label">Map</div>
      {item('New map…', 'menu-new-map', async () => {
        const r = await formDialog('New map', [
          { name: 'name', label: 'Name', value: 'New repertoire' },
          { name: 'orientation', label: 'Play as', value: 'white', options: [['white', 'White'], ['black', 'Black']] },
        ], 'Create');
        if (r) app.createMap(r.name ?? '', r.orientation === 'black' ? 'black' : 'white', getCenter());
      })}
      {item('Rename map…', 'menu-rename-map', async () => {
        const r = await formDialog('Rename map', [{ name: 'name', label: 'Name', value: app.session.repertoire.name }], 'Rename');
        if (r) app.renameMap(r.name ?? '');
      })}
      {item('Duplicate map', 'menu-duplicate-map', () => app.duplicateMap())}
      {item('Flip board orientation', 'menu-flip', () => app.flipOrientation())}
      {item('Delete map…', 'menu-delete-map', async () => {
        if (app.session.library.size <= 1) return toast('Cannot delete the last map');
        if (await confirmDialog(`Delete map "${app.session.repertoire.name}"?`, 'Delete')) app.deleteMap();
      })}
    </div>
  );
}

const placeText = (label: string, country?: string): string => (country && !label.includes(country) ? `${label}, ${country}` : label);

export function TopBar({ getCenter }: { getCenter: () => LngLat }) {
  const app = useApp();
  const view = useViewState();
  const s = app.session;
  const bar = useRef<HTMLElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const pgnInput = useRef<HTMLInputElement>(null);

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

  const rep = s.repertoire;
  const sans = rep.sanPath(s.cursor);
  const cursors = rep.lineCursors(s.cursor);
  useLayoutEffect(() => {
    const el = line.current as HTMLDivElement;
    el.scrollLeft = el.scrollWidth; // keep the latest ply in view
  });

  const op = app.openingAt(s.cursor);
  const pl = rep.node(s.cursor.nodeId).place;
  const place = pl ? placeText(pl.label, pl.country) : '';
  const others = s.cursor.ply > 0 ? rep.transpositions(s.cursor) : [];
  const chipTarget: Cursor | undefined = others[0];

  const importPicked = (format: 'json' | 'pgn') => async (e: Event): Promise<void> => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await importFile(app, format, file, getCenter());
  };

  return (
    <header class="topbar" ref={bar}>
      <div class="tb-main">
        {/* Identity: the map switcher reads as a title (a real <select> underneath). */}
        <label class="map-pick">
          <Icon name="knight" size={20} />
          <select class="map-select" data-testid="map-select" aria-label="Map" value={s.library.activeId} onChange={(e) => app.switchMap(e.currentTarget.value)}>
            {s.library.repertoires().map((lm) => <option value={lm.id}>{lm.name}</option>)}
          </select>
          <Icon name="chevron" size={14} />
        </label>

        {/* Mode: a two-state segmented control. */}
        <div class="mode-seg" data-testid="mode-toggle" data-mode={s.mode} role="radiogroup" aria-label="Mode">
          {(['explore', 'edit'] as const).map((mode) => (
            <button
              type="button" role="radio" data-testid={`mode-${mode}`} class={mode === s.mode ? 'seg on' : 'seg'} aria-checked={mode === s.mode}
              title={mode === 'edit' ? 'Edit the repertoire (E)' : 'Explore and train (E)'} onClick={() => app.switchMode(mode)}
            >
              <Icon name={mode} size={16} />
              <span>{mode === 'edit' ? 'Edit' : 'Explore'}</span>
            </button>
          ))}
        </div>

        <div class="tb-right">
          {/* Edit-only tools, visually part of the edit accent. */}
          <div class="tb-edit" hidden={!edit}>
            <button type="button" data-testid="pin-toggle" class={s.recording ? 'tool active' : 'tool'} aria-pressed={s.recording} title="Record moves into one pinned board (P)" onClick={() => app.toggleRecording()}>
              <Icon name="pin" size={16} />
              <span>Pin</span>
            </button>
            <button type="button" data-testid="undo-ply" class="tool" disabled={!s.canTakeBack} title="Remove the last recorded ply (Ctrl+Z)" onClick={() => app.takeBack()}>
              <Icon name="undo" size={16} />
              <span>Undo ply</span>
            </button>
          </div>
          <button type="button" data-testid="overview-toggle" class={view.overview ? 'tool view-tool active' : 'tool view-tool'} aria-pressed={view.overview} title="Show the whole tree, faded" onClick={() => view.toggleOverview()}>
            <Icon name="layers" size={18} />
            <span class="label">Overview</span>
          </button>
          <button
            type="button" ref={menuBtn} data-testid="menu-button" class="tool menu-button" aria-label="Menu" title="Map, import / export, Lichess"
            onClick={() => openPopover(menuBtn.current as HTMLElement, (close) => <Menu app={app} close={close} getCenter={getCenter} pickJson={() => jsonInput.current?.click()} pickPgn={() => pgnInput.current?.click()} />)}
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
                <button type="button" class={i === sans.length - 1 ? 'ply current' : 'ply'} data-testid="line-ply" onClick={() => app.goTo(cursors[i] as Cursor)}>
                  {i % 2 === 0 ? formatLine([san], i) : san}
                </button>
              </>
            ))}
          </div>
          <button type="button" class="chip" data-testid="transposition" hidden={!chipTarget} onClick={() => chipTarget && app.goTo(chipTarget)}>
            {chipTarget && `⇄ also reached via ${formatLine(rep.sanPath(chipTarget))}${others.length > 1 ? ` (+${others.length - 1})` : ''}`}
          </button>
        </div>
        <div class={op && !op.exact ? 'opening inexact' : 'opening'} data-testid="opening" hidden={!op} title={op ? `${op.eco} · ${openingText(op)}` : ''}>
          <span class="opening-name" data-testid="opening-name">{op && openingText(op)}</span>
        </div>
        <button type="button" class="place" data-testid="place-label" disabled={!edit} title={edit ? 'Set location by city (L)' : place} onClick={() => edit && app.startRelocating(s.cursor.nodeId)}>
          {place}
        </button>
      </div>

      <input type="file" accept=".json,application/json" data-testid="import-json-input" hidden ref={jsonInput} onChange={importPicked('json')} />
      <input type="file" accept=".pgn,text/plain" data-testid="import-pgn-input" hidden ref={pgnInput} onChange={importPicked('pgn')} />
    </header>
  );
}

export function NavButtons() {
  const app = useApp();
  const n = app.session.repertoire.sanPath(app.session.cursor).length;
  return (
    <div class="nav-buttons">
      <button type="button" class="nav" data-testid="btn-back" title="Back (←)" aria-label="Back" onClick={() => app.back()}>
        <Icon name="chevron" size={22} />
      </button>
      <span class="ply-count" data-testid="ply-count">{n ? `Ply ${n}` : 'Start'}</span>
      <button type="button" class="nav" data-testid="btn-forward" title="Forward (→)" aria-label="Forward" onClick={() => void app.forward()}>
        <Icon name="chevron" size={22} />
      </button>
    </div>
  );
}
