// Ludo bots (docs/ludo-spec.md 3.1). Every bot picks from legalMoves(), so none can break a rule.
// Easy: random. Medium: fixed priorities, with a random move one time in four. Hard: scores each move by captures, progress and how much
// it lowers the risk to its own tokens (the chance an opponent can land on each next turn, times
// what that token would lose).
import { KINDS } from './powerups.js';
import { legalMoves, absOf, onTrack, isSafe, canExit, tokensAt, YARD, LAST_TRACK, steps } from './rules.js';

export const LEVELS = ['easy', 'medium', 'hard'];
const MEDIUM_SLIP = 0.25; // Medium plays a random move this often, so it sits between Easy and Hard

export function botMove(level, state, rng, moves = legalMoves(state)) {
  if (moves.length <= 1 || level === 'easy' || (level === 'medium' && rng.chance(MEDIUM_SLIP))) return moves.length ? rng.pick(moves) : null;
  const score = level === 'hard' ? hardScore : mediumScore;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const s = score(state, m) + rng.next() * 1e-3; // break ties at random
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}

// What the powerup on the square a move ends on is worth, in steps (0 when there is none). The squares
// are in plain view, so Medium and Hard simply add this to the move's score: seek the good, dodge the bad.
// Back to start loses everything travelled; the yard exit it costs is about 10 more.
export function powerupValue(state, m) {
  if (!state.pu.length || !onTrack(m.to)) return 0;
  const p = state.pu.find((x) => x.sq === absOf(state.corners[state.turn], m.to));
  if (!p) return 0;
  return p.kind === 'start' ? -(m.to + 11) : p.kind === 'back' ? -(m.to - m.from || 1) : KINDS[p.kind].ev;
}

function mediumScore(state, m) {
  const c = state.corners[state.turn];
  const pv = 2 * powerupValue(state, m);
  return pv + mediumBase(state, m, c);
}

function mediumBase(state, m, c) {
  if (m.captures.length) return 1000;
  if (m.home) return 900;
  if (m.from === YARD) return 800;
  if (m.from <= LAST_TRACK && (m.to > LAST_TRACK || isSafe(absOf(c, m.to), state.rules))) return 700;
  return m.from; // the token furthest along
}

// Chance that some opponent of `seat` can land on track square `abs` on their next turn.
// Finished players' tokens are all HOME (neither on the track nor in the yard), so they add nothing.
export function threat(state, seat, abs) {
  const { rules } = state;
  if (isSafe(abs, rules)) return 0;
  let miss = 1;
  state.tokens.forEach((ts, o) => {
    if (o === seat) return;
    const co = state.corners[o];
    for (const rel of ts) {
      let p = 0;
      if (onTrack(rel)) {
        const d = (abs - absOf(co, rel) + 52) % 52;
        if (d >= 1 && rel + d <= LAST_TRACK) p = d <= 6 ? 1 / 6 : d <= 12 ? 1 / 36 : 0;
      } else if (rel === YARD && absOf(co, 0) === abs) {
        p = rules.exit === '16' ? 1 / 3 : 1 / 6;
      }
      miss *= 1 - p;
    }
  });
  return 1 - miss;
}

// Total expected loss of `seat`'s tokens on the track: threat x (10 + steps travelled).
function risk(state, seat) {
  const c = state.corners[seat];
  let sum = 0;
  for (const rel of state.tokens[seat]) {
    if (!onTrack(rel)) continue;
    const abs = absOf(c, rel);
    if (state.rules.blockades && tokensAt(state, abs).filter(([s]) => s === seat).length >= 2) continue;
    sum += threat(state, seat, abs) * (10 + steps(rel));
  }
  return sum;
}

function after(state, m) {
  const tokens = state.tokens.map((ts) => ts.slice());
  tokens[state.turn][m.token] = m.to;
  for (const [s, t] of m.captures) tokens[s][t] = YARD;
  return { ...state, tokens };
}

const W = { capture: 40, victim: 1, home: 30, column: 20, exit: 25, leader: 0.08, shuffle: 6, risk: 1.6, chase: 2, powerup: 1.5 };

function hardScore(state, m) {
  const seat = state.turn;
  const c = state.corners[seat];
  const next = after(state, m);
  let s = W.powerup * powerupValue(state, m);
  if (m.captures.length) s += W.capture + m.captures.reduce((a, [o, t]) => a + W.victim * steps(state.tokens[o][t]), 0);
  if (m.home) s += W.home;
  else if (m.from <= LAST_TRACK && m.from !== YARD && m.to > LAST_TRACK) s += W.column;
  if (m.from === YARD) s += W.exit;
  if (m.from > LAST_TRACK && !m.home && state.tokens[seat].some((r) => onTrack(r) || (r === YARD && canExit(state.die, state.rules)))) s -= W.shuffle;
  if (m.from !== YARD) s += W.leader * m.from;
  s += W.risk * (risk(state, seat) - risk(next, seat));
  if (onTrack(m.to)) {
    // opponents left just in front of the moved token: chances to capture next turn
    const abs = absOf(c, m.to);
    next.tokens.forEach((ts, o) => {
      if (o === seat) return;
      for (const rel of ts) {
        const d = (absOf(next.corners[o], rel) - abs + 52) % 52;
        if (onTrack(rel) && d >= 1 && d <= 6 && m.to + d <= LAST_TRACK && !isSafe(absOf(next.corners[o], rel), state.rules)) s += W.chase;
      }
    });
  }
  return s;
}
