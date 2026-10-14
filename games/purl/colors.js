// Purl colours sampled from the original (ref 6.2), plus a tenth (pink) for the top of
// the 3 -> 10 colour range. Index = colour id used everywhere. yarn = the knit in the picture,
// bobbin = the spool body, cap = the top-down cap of a buried bobbin. sym = colourblind glyph.

export const COLORS = [
  { name: 'red', yarn: '#cd464f', bobbin: '#e15565', cap: '#e04d5f', sym: '▲' },
  { name: 'yellow', yarn: '#d8b345', bobbin: '#e2d44c', cap: '#e2d44c', sym: '●' },
  { name: 'purple', yarn: '#9758da', bobbin: '#a06ed2', cap: '#b287da', sym: '★' },
  { name: 'beige', yarn: '#cb9d80', bobbin: '#d0a994', cap: '#d0a994', sym: '☰' },
  { name: 'gray', yarn: '#9289a0', bobbin: '#9794a7', cap: '#9a97a8', sym: '■' },
  { name: 'green', yarn: '#28955c', bobbin: '#2fa572', cap: '#48ab6a', sym: '♣' },
  { name: 'blue', yarn: '#1d67c8', bobbin: '#2c6fe2', cap: '#2c6fe2', sym: '◆' },
  { name: 'cyan', yarn: '#28b1cf', bobbin: '#5fcce3', cap: '#5fcce3', sym: '≈' },
  { name: 'orange', yarn: '#db6e28', bobbin: '#e17b13', cap: '#e17b13', sym: '✖' },
  { name: 'pink', yarn: '#d75fa8', bobbin: '#ec7cc0', cap: '#ec7cc0', sym: '♥' },
];

export const NCOLORS = COLORS.length;
export const C = Object.fromEntries(COLORS.map((c, i) => [c.name, i]));
export const HIDDEN = { cap: '#cccfd6', mark: '#746a79' };
export const UI = {
  wallpaper: '#9f4e45',
  wallpaper2: '#934840',
  floorBand: '#daafa7',
  floorBand2: '#d7a097',
  surround: '#7f4645',
  bottom: '#8a5a58',
  slot: '#e2e0de',
  tile: '#e1ccc6',
  grout: '#c9b1aa',
  void: '#7e4544',
  wood: '#c98b61',
  woodEdge: '#e5c1a0',
  back: '#6e504f',
  glass: '#9fb6cf',
  plate: '#b8a6d6',
  pill: '#bab3b3',
};
