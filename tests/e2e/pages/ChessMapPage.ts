import { expect, type Page } from '@playwright/test';
import type { ChessMapData as ChessMap, MapNodeData as MapNode } from '../../../src/domain';
import { Board } from './Board';
import { Dialog } from './Dialog';
import { LocatePanel } from './LocatePanel';
import { MapView } from './MapView';
import { Menu } from './Menu';
import { TopBar } from './TopBar';

/** Serializable copy of the active map and the camera. */
export interface Snapshot { id: string; rootId: string; nodes: Record<string, MapNode>; zoom: number; center: [number, number] }

/** The `window.__chessMap` handle set in src/main.ts. */
interface ChessMapDebug {
  map: { getZoom(): number; getCenter(): { lng: number; lat: number } };
  activeMap(): ChessMap;
}

/** Root-to-leaf path following child indexes (`nodeAt(s)` is the root). */
export const nodeAt = (s: Snapshot, ...path: number[]): MapNode =>
  path.reduce((n, i) => s.nodes[n.children[i] as string] as MapNode, s.nodes[s.rootId] as MapNode);

/**
 * Entry point of the page objects: the app is a tree of components (`topBar`, `board`, `map`, `menu`, `dialog`,
 * `locate`), each owning its selectors and gestures. This class only holds what crosses several of them.
 */
export class ChessMapPage {
  readonly topBar: TopBar;
  readonly board: Board;
  readonly map: MapView;
  readonly menu: Menu;
  readonly dialog: Dialog;
  readonly locate: LocatePanel;

  constructor(readonly page: Page) {
    this.topBar = new TopBar(page);
    this.board = new Board(page);
    this.map = new MapView(page);
    this.menu = new Menu(page);
    this.dialog = new Dialog(page);
    this.locate = new LocatePanel(page);
  }

  /** Opens the app and waits until the board is on screen. */
  async open(): Promise<void> {
    await this.page.goto('./');
    await expect(this.board.root).toBeVisible();
  }

  snapshot(): Promise<Snapshot> {
    return this.page.evaluate(() => {
      const d = (window as unknown as { __chessMap: ChessMapDebug }).__chessMap;
      const m = d.activeMap();
      const c = d.map.getCenter();
      return { id: m.id, rootId: m.rootId, nodes: m.nodes, zoom: d.map.getZoom(), center: [c.lng, c.lat] as [number, number] };
    });
  }

  nodeCount = async (): Promise<number> => Object.keys((await this.snapshot()).nodes).length;

  /** Raw localStorage value (the library is saved a moment after a change; leaving the page flushes it). */
  stored = (key: string): Promise<string | null> => this.page.evaluate((k) => localStorage.getItem(k), key);

  /** While a move is carried as a ghost pin: drops it to the right of the board (`slot` stacks several one below the other). */
  async placeHere(slot = 0): Promise<void> {
    await expect(this.board.card).toHaveClass(/placing/);
    const box = await this.board.settled();
    const at = { x: box.x + box.width + 120, y: box.y + 40 + slot * 70 };
    await this.page.mouse.move(at.x, at.y);
    await this.page.mouse.click(at.x, at.y);
    await expect(this.board.card).not.toHaveClass(/placing/);
  }

  /** Edit mode: plays a move, then drops the carried ghost pin to the right of the board. */
  async spawn(from: string, to: string, slot = 0): Promise<void> {
    await this.board.playMove(from, to);
    await this.placeHere(slot);
  }

  /** e4 spawned, entered, e5 spawned, back at the start (3 nodes). */
  async buildTwoLevels(): Promise<void> {
    await this.topBar.edit();
    await this.spawn('e2', 'e4');
    await this.map.enter();
    await this.spawn('e7', 'e5');
    await expect(this.map.pins).toHaveCount(1);
    await this.topBar.back();
    await expect(this.topBar.line).toHaveText('');
  }
}
