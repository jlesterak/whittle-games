// Build a small Purl level by hand: a board plus column stacks (bottom first).
export function knitLevel({ cols = 6, rows, cells, columns, slots = 7 }) {
  return { n: 0, slots, board: { cols, rows, cells, dispVanish: false }, columns };
}
