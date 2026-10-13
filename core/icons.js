// Small UI icons (inline SVG strings) shared by the seated games. `cut` is the colour of the holes
// (the game's background), since the shapes themselves use currentColor.

export const icons = {
  back: () => `<svg viewBox="0 0 64 64"><path d="M40 12L20 32l20 20" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  gear: (cut) => `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-width="11" stroke-dasharray="8.4 7.3"/><circle cx="32" cy="32" r="16" fill="currentColor"/><circle cx="32" cy="32" r="7" fill="${cut}"/></svg>`,
  bot: (cut) => `<svg viewBox="0 0 64 64"><path d="M32 6v8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="6" r="4" fill="currentColor"/><rect x="10" y="16" width="44" height="36" rx="10" fill="currentColor"/><circle cx="23" cy="32" r="5" fill="${cut}"/><circle cx="41" cy="32" r="5" fill="${cut}"/><rect x="22" y="42" width="20" height="4" rx="2" fill="${cut}"/></svg>`,
  crown: () => `<svg viewBox="0 0 64 64"><path d="M6 50L10 18l14 14 8-20 8 20 14-14 4 32z" fill="#f4b828" stroke="#a0700a" stroke-width="3" stroke-linejoin="round"/></svg>`,
};
