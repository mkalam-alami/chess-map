import type { ChessMapApp } from '../../../application';
import type { LibraryStats, RankedCount } from '../../../domain';
import { infoDialog } from './overlay';

/** Opens the library statistics (all maps) in a dialog. A snapshot: it is not live while open. */
export const showStats = (app: ChessMapApp): Promise<void> => infoDialog('Statistics', <Stats stats={app.stats()} />, 'stats').then(() => undefined);

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function Figures({ items }: { items: [label: string, value: number][] }) {
  return (
    <section class="stats-section">
      <dl class="stats-figures">
        {items.map(([label, value]) => (
          <div>
            <dt>{label}</dt>
            <dd data-testid={`stat-${label.toLowerCase().replace(/\W+/g, '-')}`}>{fmt(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Top({ title, testid, byColor }: { title: string; testid: string; byColor: LibraryStats['openings'] }) {
  return (
    <section class="stats-section" data-testid={testid}>
      <h4>{title}</h4>
      {(['white', 'black'] as const).map((color) => (
        <div class="stats-top">
          <h5>As {color}</h5>
          {byColor[color].length === 0 ? <p class="stats-none">None yet</p> : <Ranking rows={byColor[color]} />}
        </div>
      ))}
    </section>
  );
}

const Ranking = ({ rows }: { rows: RankedCount[] }) => (
  <ol>
    {rows.map((r) => <li><span class="stats-name">{r.name}</span><span class="stats-count">{r.count}</span></li>)}
  </ol>
);

function Stats({ stats: s }: { stats: LibraryStats }) {
  return (
    <>
      <Figures items={[['Maps', s.maps], ['Markers', s.markers], ['Moves', s.moves], ['Lines', s.leaves], ['Max depth', s.maxDepth], ['Average length', s.averageDepth], ['Notes', s.notes]]} />
      <Top title="Top openings (markers)" testid="stats-openings" byColor={s.openings} />
      <Top title="Top places (markers)" testid="stats-places" byColor={s.places} />
    </>
  );
}
