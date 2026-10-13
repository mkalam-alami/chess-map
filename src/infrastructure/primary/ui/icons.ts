const PATHS = {
  explore: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  mapPin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3v2H7v-2l3-3z"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
  more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  eraser: '<path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  // Same artwork as public/favicon.svg (100x100 source, scaled to the 24 grid).
  logo: `<g transform="scale(0.24)" stroke="none"><rect width="100" height="100" rx="20" fill="#b58863"/><g fill="#f0d9b5"><path d="M50 49C43 40 33 33 33 23a17 17 0 0 1 34 0c0 10-10 17-17 26z"/><rect x="37" y="51" width="26" height="5" rx="2.5"/><path d="M43 56h14l6 21h-26z"/><path d="M25 90h50v-4q0-8-9-8h-32q-9 0-9 8z"/></g><circle cx="50" cy="23" r="6.5" fill="#b58863"/></g>`,
} as const;

export type IconName = keyof typeof PATHS;

/** Inline stroke icon markup (static, so it is safe to inject as HTML). */
export const iconSvg = (name: IconName, size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;

/** Icon as a DOM node, for the imperative map code. Components use `<Icon>`. */
export function icon(name: IconName, size = 18): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'icon';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = iconSvg(name, size);
  return s;
}
