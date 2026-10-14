// The 19 piece colours sampled from the original (ref 6.2). Index = colour id used everywhere.
// sym = colourblind symbol id (see sprites.js drawSymbol).

export const COLORS = [
  { name: 'red', bead: '#de3840', crate: '#d02a30' },
  { name: 'blue', bead: '#3f7fe2', crate: '#367be1' },
  { name: 'green', bead: '#29c411', crate: '#28b318' },
  { name: 'yellow', bead: '#ddd42c', crate: '#e0d921' },
  { name: 'pink', bead: '#e25fdf', crate: '#e155dc' },
  { name: 'cyan', bead: '#4abee1', crate: '#24b2e2' },
  { name: 'orange', bead: '#dc5e27', crate: '#e15c1c' },
  { name: 'white', bead: '#cfcfd0', crate: '#cccbce' },
  { name: 'violet', bead: '#7018c6', crate: '#8c0be2' },
  { name: 'teal', bead: '#0fbb93', crate: '#06b49a' },
  { name: 'navy', bead: '#374ab3', crate: '#3446a2' },
  { name: 'amber', bead: '#e09513', crate: '#e08f16' },
  { name: 'brown', bead: '#934d21', crate: '#944d16' },
  { name: 'lavender', bead: '#9a94e2', crate: '#8c8ce1' },
  { name: 'crimson', bead: '#921654', crate: '#940c51' },
  { name: 'dark green', bead: '#128f17', crate: '#027e1a' },
  { name: 'olive', bead: '#7f8c13', crate: '#798500' },
  { name: 'gray', bead: '#6b7480', crate: '#667685' },
  { name: 'dark purple', bead: '#64186c', crate: '#670b71' },
];

export const NCOLORS = COLORS.length;
export const HIDDEN_BEAD = '#242b31';
export const C = Object.fromEntries(COLORS.map((c, i) => [c.name.replace(' ', ''), i]));

// UI themes (ref 6.2): background and empty-slot colours.
export const THEMES = [
  { name: 'lavender', bg: '#a0a8e1', slot: '#c3c5e0', rail: '#8596e0', rail2: '#97a9ec' },
  { name: 'blue', bg: '#a6c8e2', slot: '#c3d8e1', rail: '#7fa6d6', rail2: '#93b8e0' },
];
