import type { ChessMapApp } from '../../application';

/** Presentation-only state: not part of the domain session, never persisted. */
export interface ViewData {
  /** Show the whole tree, faded. */
  readonly overview: boolean;
  /** Bumped by every focus: the map view should ease to the cursor node. */
  readonly recenter: number;
  /** The board is shown on the map. Closing it leaves only pins; focusing reopens it. */
  readonly boardOpen: boolean;
  /** Centered mode: the map view follows the board (zoom stays on it). Panning the map leaves it; any board switch restores it. */
  readonly centered: boolean;
  /** Set with `recenter` by back() / forward(): keep the board's on-screen size instead of fitting the children. */
  readonly keepSize: boolean;
  /** Bumped when forward had nowhere to go: the children pins should pulse. */
  readonly pulse: number;
}

/**
 * Observable presentation state shared by the Preact UI and the map views. It follows the application's view events
 * (they run before the app notifies, so views see the patch) and re-broadcasts every application change, so a view
 * only needs `subscribe` here to hear about both.
 */
export class ViewState implements ViewData {
  private data: ViewData;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly app: ChessMapApp) {
    // A loaded repertoire opens as pins only; the board shows up at once only in the empty (forced Edit) case.
    const rep = app.session.repertoire;
    const empty = rep.node(rep.rootId).children.length === 0;
    this.data = { overview: true, recenter: 0, boardOpen: empty, centered: true, keepSize: false, pulse: 0 };
    app.on('focused', (e) => this.patch({ recenter: this.data.recenter + 1, keepSize: e.keepSize, boardOpen: true, centered: true }, false));
    app.on('deadEnd', () => this.patch({ pulse: this.data.pulse + 1 }, false));
    app.on('mapEntered', () => this.patch({ boardOpen: true, centered: true }, false));
    app.subscribe(() => this.notify());
  }

  /** Stable between changes (a new object per change), so it can be compared by identity. */
  get state(): ViewData { return this.data; }
  get overview(): boolean { return this.data.overview; }
  get recenter(): number { return this.data.recenter; }
  get boardOpen(): boolean { return this.data.boardOpen; }
  get centered(): boolean { return this.data.centered; }
  get keepSize(): boolean { return this.data.keepSize; }
  get pulse(): number { return this.data.pulse; }

  /** Called after every application or presentation change. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Enters or leaves centered mode (leaving happens when the user pans the map). */
  setCentered(centered: boolean): void {
    if (this.data.centered !== centered) this.patch({ centered });
  }

  /** Hides the board (every board may be closed, the root included); refused while a transient flow owns the input. */
  closeBoard(): void {
    if (this.data.boardOpen && !this.app.session.busy) this.patch({ boardOpen: false });
  }

  toggleOverview(): void {
    this.patch({ overview: !this.data.overview });
  }

  private patch(p: Partial<ViewData>, notify = true): void {
    this.data = { ...this.data, ...p };
    if (notify) this.notify();
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
