const PATHS = {
  explore: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  mapPin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3v2H7v-2l3-3z"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
  more: '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  knight: '<path d="M7 21h11M8 21c0-4 1-6 3-8l-4-1 1-4 5-4c3 0 5 3 5 7 0 4-1 7-1 10"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Inline stroke icon (static markup only, so innerHTML is safe). */
export function icon(name: IconName, size = 18): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'icon';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  return s;
}
