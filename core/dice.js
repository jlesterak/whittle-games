// Dice helper for dice games (Yacht, Ludo). Pass an rng from rng.js for replayable rolls.

export function rollDie(rng, sides = 6) {
  return 1 + rng.int(sides);
}

export function rollDice(rng, n, sides = 6) {
  return Array.from({ length: n }, () => rollDie(rng, sides));
}

// Re-roll only the dice not held: held[i] true keeps dice[i].
export function reroll(rng, dice, held, sides = 6) {
  return dice.map((d, i) => (held[i] ? d : rollDie(rng, sides)));
}

// counts[v] = how many dice show v (index 0 unused).
export function counts(dice, sides = 6) {
  const c = new Array(sides + 1).fill(0);
  for (const d of dice) c[d]++;
  return c;
}

export const sum = (dice) => dice.reduce((a, b) => a + b, 0);

// Bot pacing for dice games: a base delay in ms scaled by the game's bot-speed setting, so bots
// play at a pace you can follow. Reduced motion drops animation, not these pauses.
export const BOT_SPEEDS = [
  ['slow', 'Slow'],
  ['normal', 'Normal'],
  ['fast', 'Fast'],
];
// Normal was Fast until 2026-10-09 (owner: bots felt slow); everything moved one step quicker.
const PACE = { slow: 1, normal: 0.45, fast: 0.2 };
export const botDelay = (speed, ms) => Math.round(ms * (PACE[speed] ?? 1));
