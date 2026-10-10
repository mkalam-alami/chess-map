import type { JSX } from 'preact';

// Chessground's piece element.
declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      piece: JSX.HTMLAttributes<HTMLElement>;
    }
  }
}
