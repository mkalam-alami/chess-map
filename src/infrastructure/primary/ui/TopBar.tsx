import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { formatLine, type Cursor, type LngLat, type Repertoire } from '../../../domain';
import type { ChessMapApp } from '../../../application';
import { importFile, openInAnalysis } from './actions';
import { Icon } from './Icon';
import { SyncIndicator } from './SyncIndicator';
import { SyncMenuSection } from './SyncMenuSection';
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
      <SyncMenuSection app={app} close={close} />
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
  const future = s.future; // what the forward key walks through: shown muted after the current move
  useLayoutEffect(() => {
    const el = line.current as HTMLDivElement;
    const cur = el.querySelector('.current'); // keep the current move in view (the muted future may extend past it)
    if (!cur) el.scrollLeft = 0;
    else {
      const c = cur.getBoundingClientRect();
      const v = el.getBoundingClientRect();
      if (c.right > v.right) el.scrollLeft += c.right - v.right;
      else if (c.left < v.left) el.scrollLeft -= v.left - c.left;
    }
  });

  const others = s.cursor.played > 0 ? rep.transpositions(s.cursor) : [];
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
          <Icon name="logo" size={20} />
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
              <span>Pin board</span>
            </button>
            <button type="button" data-testid="undo-move" class="tool" disabled={!s.canTakeBack} title="Remove the last recorded move (Backspace)" onClick={() => app.takeBack()}>
              <Icon name="undo" size={16} />
              <span>Undo move</span>
            </button>
            <button type="button" data-testid="undo" class="tool" disabled={!app.canUndo} title="Undo the last change (Ctrl+Z)" onClick={() => app.undo()}>
              <Icon name="undo" size={16} />
              <span>Undo</span>
            </button>
            <button type="button" data-testid="redo" class="tool" disabled={!app.canRedo} title="Redo (Ctrl+Shift+Z)" onClick={() => app.redo()}>
              <Icon name="redo" size={16} />
              <span>Redo</span>
            </button>
          </div>
          <button type="button" data-testid="overview-toggle" class={view.overview ? 'tool view-tool active' : 'tool view-tool'} aria-pressed={view.overview} title="Show the whole tree, faded" onClick={() => view.toggleOverview()}>
            <Icon name="layers" size={18} />
            <span class="label">Overview</span>
          </button>
          <SyncIndicator />
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
          <div class="line" ref={line}>
            <span data-testid="line">
            {sans.map((san, i) => (
              <>
                {i > 0 && ' '}
                <button type="button" class={i === sans.length - 1 ? 'move current' : 'move'} data-testid="line-move" onClick={() => app.goTo(cursors[i] as Cursor, { keepSize: true })}>
                  {i % 2 === 0 ? formatLine([san], i) : san}
                </button>
              </>
            ))}
            </span>
            <span data-testid="line-future-list">
              {future.map((c, i) => (
              <>
                {' '}
                <button type="button" class="move future" data-testid="line-future" onClick={() => app.goTo(c, { keepSize: true })}>
                  {(sans.length + i) % 2 === 0 ? formatLine([futureSan(rep, c)], sans.length + i) : futureSan(rep, c)}
                </button>
              </>
            ))}
            </span>
          </div>
          <button type="button" class="chip" data-testid="transposition" hidden={!chipTarget} onClick={() => chipTarget && app.goTo(chipTarget, { keepSize: true })}>
            {chipTarget && `⇄ also reached via ${formatLine(rep.sanPath(chipTarget))}${others.length > 1 ? ` (+${others.length - 1})` : ''}`}
          </button>
        </div>
      </div>

      <input type="file" accept=".json,application/json" data-testid="import-json-input" hidden ref={jsonInput} onChange={importPicked('json')} />
      <input type="file" accept=".pgn,text/plain" data-testid="import-pgn-input" hidden ref={pgnInput} onChange={importPicked('pgn')} />
    </header>
  );
}

/** The move that reaching `c` plays. */
const futureSan = (rep: Repertoire, c: Cursor): string => rep.node(c.nodeId).moves[c.played - 1] as string;
