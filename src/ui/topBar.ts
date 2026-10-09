import { openingAt, type OpeningInfo } from '../chess/openings';
import { formatLine, sanPath } from '../chess/replay';
import { findTranspositions, pathTo } from '../model/tree';
import { ValidationError } from '../model/serialize';
import { getNode, type Cursor, type LngLat } from '../model/types';
import {
  activeMap, back, beginRelocate, canUndoPly, deleteMap, duplicateMap, exportActiveMapJson, flipOrientation, focus, forward,
  getState, hooks, importMapJson, newMap, renameMap, setMode, switchMap, toggleOverview, togglePin, undoPly,
} from '../store/store';
import { button, el } from './dom';
import { icon } from './icons';
import { confirmDialog, formDialog, openPopover } from './popover';
import { toast } from './toast';

export interface TopBar {
  el: HTMLElement;
  update: () => void;
}

/** `+n` suffix text for out-of-book positions. */
export const openingText = (o: OpeningInfo): string => (o.exact ? o.name : `${o.name} +${o.pliesSince}`);

export function download(name: string, text: string, type = 'application/json'): void {
  const a = el('a', '', '', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** One cursor per ply of the line leading to `cursor` (parallel to sanPath). */
function lineCursors(cursor: Cursor): Cursor[] {
  const m = activeMap();
  const out: Cursor[] = [];
  for (const id of pathTo(m, cursor.nodeId)) {
    const upto = id === cursor.nodeId ? cursor.ply : getNode(m, id).plies.length;
    for (let ply = 1; ply <= upto; ply++) out.push({ nodeId: id, ply });
  }
  return out;
}

export function createTopBar(getCenter: () => LngLat): TopBar {
  const bar = el('header', 'topbar');

  // Identity: the map switcher reads as a title (a real <select> underneath).
  const mapPick = el('label', 'map-pick');
  const mapSelect = el('select', 'map-select', '', { 'data-testid': 'map-select', 'aria-label': 'Map' });
  mapSelect.addEventListener('change', () => switchMap(mapSelect.value));
  mapPick.append(icon('knight', 20), mapSelect, icon('chevron', 14));

  // Mode: a two-state segmented control.
  const modeSeg = el('div', 'mode-seg', '', { 'data-testid': 'mode-toggle', role: 'radiogroup', 'aria-label': 'Mode' });
  const segs = (['explore', 'edit'] as const).map((m) => {
    const b = button('', `mode-${m}`, 'seg');
    b.setAttribute('role', 'radio');
    b.title = m === 'edit' ? 'Edit the repertoire (E)' : 'Explore and train (E)';
    b.append(icon(m, 16), el('span', '', m === 'edit' ? 'Edit' : 'Explore'));
    b.addEventListener('click', () => setMode(m));
    return b;
  });
  modeSeg.append(...segs);

  // Edit-only tools, visually part of the edit accent.
  const tools = el('div', 'tb-edit');
  const pinBtn = button('', 'pin-toggle', 'tool');
  pinBtn.append(icon('pin', 16), el('span', '', 'Pin'));
  pinBtn.title = 'Record moves into one pinned board (P)';
  pinBtn.addEventListener('click', togglePin);
  const undoBtn = button('', 'undo-ply', 'tool');
  undoBtn.append(icon('undo', 16), el('span', '', 'Undo ply'));
  undoBtn.title = 'Remove the last recorded ply (Ctrl+Z)';
  undoBtn.addEventListener('click', undoPly);
  tools.append(pinBtn, undoBtn);

  const overviewBtn = button('', 'overview-toggle', 'tool view-tool');
  overviewBtn.append(icon('layers', 18), el('span', 'label', 'Overview'));
  overviewBtn.title = 'Show the whole tree, faded';
  overviewBtn.addEventListener('click', toggleOverview);
  const menuBtn = button('', 'menu-button', 'tool menu-button');
  menuBtn.append(icon('more', 18));
  menuBtn.setAttribute('aria-label', 'Menu');
  menuBtn.title = 'Map, import / export, Lichess';

  const main = el('div', 'tb-main');
  const right = el('div', 'tb-right');
  right.append(tools, overviewBtn, menuBtn);
  main.append(mapPick, modeSeg, right); // the mode toggle sits in the middle, the sides share the rest equally

  // Context: the line (primary), where it is (secondary), and its transpositions.
  const ctx = el('div', 'tb-context');
  const lineCol = el('div', 'tb-linecol');
  const line = el('div', 'line', '', { 'data-testid': 'line' });
  const opening = el('div', 'opening', '', { 'data-testid': 'opening' });
  opening.hidden = true;
  const openingName = el('span', 'opening-name', '', { 'data-testid': 'opening-name' });
  opening.append(openingName);
  const chip = button('', 'transposition', 'chip');
  chip.hidden = true;
  let chipTarget: Cursor | undefined;
  chip.addEventListener('click', () => chipTarget && focus(chipTarget));
  lineCol.append(line, chip);
  const place = button('', 'place-label', 'place');
  place.addEventListener('click', () => getState().mode === 'edit' && beginRelocate(getState().cursor.nodeId));
  ctx.append(lineCol, opening, place);
  bar.append(main, ctx);
  new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`)).observe(bar);

  const fileInput = el('input', '', '', { type: 'file', accept: '.json,application/json', 'data-testid': 'import-json-input' });
  fileInput.hidden = true;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      importMapJson(await file.text());
      toast('Map imported');
    } catch (e) {
      toast(e instanceof ValidationError ? e.message : 'Could not import this file');
    }
  });
  bar.append(fileInput);

  const placeholder = (id: 'export-pgn' | 'import-pgn' | 'open-lichess') => (): void => (hooks.menu[id] ?? (() => toast('Coming soon')))();

  menuBtn.addEventListener('click', () => {
    openPopover(menuBtn, (close) => {
      const box = el('div', 'menu');
      const item = (label: string, testid: string, fn: () => void | Promise<void>): void => {
        const b = button(label, testid, 'menu-item');
        b.addEventListener('click', () => {
          close();
          void fn();
        });
        box.append(b);
      };
      const section = (t: string): void => void box.append(el('div', 'menu-label', t));
      section('View');
      item('Go to place…', 'menu-goto', () => beginRelocate(null));
      section('Import / export');
      item('Export JSON', 'menu-export-json', () => download(`${activeMap().name}.chessmap.json`, exportActiveMapJson()));
      item('Import JSON…', 'menu-import-json', () => fileInput.click());
      item('Export PGN', 'menu-export-pgn', placeholder('export-pgn'));
      item('Import PGN…', 'menu-import-pgn', placeholder('import-pgn'));
      section('Share');
      item('Open in Lichess', 'menu-open-lichess', placeholder('open-lichess'));
      section('Map');
      item('New map…', 'menu-new-map', async () => {
        const r = await formDialog('New map', [
          { name: 'name', label: 'Name', value: 'New repertoire' },
          { name: 'orientation', label: 'Play as', value: 'white', options: [['white', 'White'], ['black', 'Black']] },
        ], 'Create');
        if (r) newMap(r.name ?? '', r.orientation === 'black' ? 'black' : 'white', getCenter());
      });
      item('Rename map…', 'menu-rename-map', async () => {
        const r = await formDialog('Rename map', [{ name: 'name', label: 'Name', value: activeMap().name }], 'Rename');
        if (r) renameMap(r.name ?? '');
      });
      item('Duplicate map', 'menu-duplicate-map', duplicateMap);
      item('Flip board orientation', 'menu-flip', flipOrientation);
      item('Delete map…', 'menu-delete-map', async () => {
        if (Object.keys(getState().library.maps).length <= 1) return toast('Cannot delete the last map');
        if (await confirmDialog(`Delete map "${activeMap().name}"?`, 'Delete')) deleteMap();
      });
      return box;
    });
  });

  function update(): void {
    const s = getState();
    const m = activeMap();
    const edit = s.mode === 'edit';
    document.documentElement.dataset.mode = s.mode;

    // map switcher
    const ids = Object.keys(s.library.maps);
    const sig = ids.map((id) => `${id}:${s.library.maps[id]?.name}`).join('|');
    if (mapSelect.dataset.sig !== sig) {
      mapSelect.dataset.sig = sig;
      mapSelect.replaceChildren(...ids.map((id) => new Option(s.library.maps[id]?.name ?? id, id)));
    }
    mapSelect.value = s.activeMapId;

    modeSeg.dataset.mode = s.mode;
    segs.forEach((b, i) => {
      const on = (i === 1) === edit;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    tools.hidden = !edit;
    pinBtn.classList.toggle('active', s.pin);
    pinBtn.setAttribute('aria-pressed', String(s.pin));
    undoBtn.disabled = !canUndoPly();
    overviewBtn.classList.toggle('active', s.overview);
    overviewBtn.setAttribute('aria-pressed', String(s.overview));

    // line
    const sans = sanPath(m, s.cursor);
    const cursors = lineCursors(s.cursor);
    line.replaceChildren();
    sans.forEach((san, i) => {
      const text = i % 2 === 0 || i === 0 ? formatLine([san], i) : san;
      const span = el('button', `ply${i === sans.length - 1 ? ' current' : ''}`, text, { type: 'button', 'data-testid': 'line-ply' });
      span.addEventListener('click', () => focus(cursors[i] as Cursor));
      if (i) line.append(' ');
      line.append(span);
    });
    line.scrollLeft = line.scrollWidth;

    const op = openingAt(m, s.cursor);
    opening.hidden = !op;
    if (op) {
      openingName.textContent = openingText(op);
      opening.classList.toggle('inexact', !op.exact);
      opening.title = `${op.eco} · ${openingText(op)}`;
    }

    const pl = getNode(m, s.cursor.nodeId).place;
    place.textContent = pl ? (pl.country && !pl.label.includes(pl.country) ? `${pl.label}, ${pl.country}` : pl.label) : '';
    place.title = edit ? 'Set location by city (L)' : place.textContent;
    place.disabled = !edit;

    const others = s.cursor.ply > 0 ? findTranspositions(m, s.cursor) : [];
    chipTarget = others[0];
    chip.hidden = !chipTarget;
    if (chipTarget) chip.textContent = `⇄ also reached via ${formatLine(sanPath(m, chipTarget))}${others.length > 1 ? ` (+${others.length - 1})` : ''}`;
  }

  return { el: bar, update };
}

export function createNavButtons(): { el: HTMLElement; update: () => void } {
  const nav = el('div', 'nav-buttons');
  const prev = button('', 'btn-back', 'nav');
  prev.append(icon('chevron', 22));
  prev.setAttribute('aria-label', 'Back');
  prev.title = 'Back (←)';
  prev.addEventListener('click', back);
  const next = button('', 'btn-forward', 'nav');
  next.append(icon('chevron', 22));
  next.setAttribute('aria-label', 'Forward');
  next.title = 'Forward (→)';
  next.addEventListener('click', () => void forward());
  const count = el('span', 'ply-count', '', { 'data-testid': 'ply-count' });
  nav.append(prev, count, next);
  const update = (): void => {
    const n = sanPath(activeMap(), getState().cursor).length;
    count.textContent = n ? `Ply ${n}` : 'Start';
  };
  return { el: nav, update };
}
