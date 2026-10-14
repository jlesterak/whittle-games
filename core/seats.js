// Seats/turns helper for turn-based games: a ring of players, some human, some bots.
// players: [{ name, kind: 'human' | 'bot', level?: 'easy' | 'medium' | 'hard', colour? }]
// The UI for picking seats and the "pass to <name>" card live in seats-ui.js.

// Seat colours in seat order: Ludo's four, shared by every seated game.
export const SEAT_COLOURS = [
  { id: 'red', name: 'Red', hex: '#e0473f' },
  { id: 'green', name: 'Green', hex: '#35a352' },
  { id: 'yellow', name: 'Yellow', hex: '#efb22a' },
  { id: 'blue', name: 'Blue', hex: '#3a7bd5' },
];

export const BOT_LEVELS = [
  ['easy', 'Easy'],
  ['medium', 'Medium'],
  ['hard', 'Hard'],
];

const BOT_NAMES = ['Rusty', 'Pip', 'Dot', 'Bolt'];
export const defaultName = (kind, i) => (kind === 'bot' ? BOT_NAMES[i % 4] : `Player ${i + 1}`);

// Seats read back from a save, made safe: each a { name, kind, level } with a known kind and level and a short
// name; between min and max of them, or the fallback list when there are too few to play.
export function cleanPlayers(players, { min = 1, max = 4, fallback }) {
  if (!Array.isArray(players)) return fallback.map((p) => ({ ...p }));
  const levels = BOT_LEVELS.map(([v]) => v);
  const out = players
    .filter((p) => p && typeof p === 'object' && (p.kind === 'human' || p.kind === 'bot'))
    .slice(0, max)
    .map((p, i) => ({
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 12) : defaultName(p.kind, i),
      kind: p.kind,
      level: levels.includes(p.level) ? p.level : 'medium',
    }));
  return out.length >= min ? out : fallback.map((p) => ({ ...p }));
}

export function createSeats(players, { first = 0 } = {}) {
  const seats = {
    players: players.map((p, i) => ({ seat: i, out: false, score: 0, ...p })),
    current: first,
    turn: 0,
    get player() {
      return seats.players[seats.current];
    },
    get active() {
      return seats.players.filter((p) => !p.out);
    },
    // Advance to the next seat still in the game. Returns the new current player.
    next() {
      const n = seats.players.length;
      for (let k = 1; k <= n; k++) {
        const i = (seats.current + k) % n;
        if (!seats.players[i].out) {
          seats.current = i;
          break;
        }
      }
      seats.turn++;
      return seats.player;
    },
    isBot: () => seats.player.kind === 'bot',
    humans: () => seats.players.filter((p) => p.kind === 'human').length,
    toJSON: () => ({ players: seats.players, current: seats.current, turn: seats.turn }),
  };
  return seats;
}

// Pass-and-play: hand the device over when the turn reaches a human, two or more humans share
// it, and this human is not the one who played last (bots in between play in the open).
export function needsPass(seats, lastHuman) {
  return needsPassAt(seats.players, seats.current, lastHuman);
}

// The same rule for games that keep their own turn: players [{ kind }], current seat index.
export function needsPassAt(players, current, lastHuman) {
  return players[current].kind === 'human' && players.filter((p) => p.kind === 'human').length > 1 && current !== lastHuman;
}

export function restoreSeats(data) {
  const s = createSeats(data.players, { first: data.current });
  s.turn = data.turn;
  return s;
}
