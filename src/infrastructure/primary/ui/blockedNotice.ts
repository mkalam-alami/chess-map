import type { ChessMapApp } from '../../../application';
import { toast } from './toast';

/**
 * One place that tells the user why an Explore attempt went nowhere, whatever the gesture: a board move that is
 * rejected, or the forward key at a dead end. At the end of a line the answer is the same for both.
 */
export function installBlockedNotices(app: ChessMapApp): void {
  const atEnd = () => app.session.mode === 'explore' && app.session.atLineEnd();
  app.on('deadEnd', () => { if (atEnd()) toast('End of the line reached'); }); // a fork with no chosen branch is not an end: no notice
  app.on('rejected', () => toast(atEnd() ? 'End of the line reached' : 'Not in repertoire'));
}
