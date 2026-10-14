// Ludo rules engine (docs/games/ludo.md 1-2). Pure functions over a plain, JSON-safe game state, so
// the game screen, the bots, saves and the tests all share one source of truth.
//
// Positions are per token and relative to its owner: YARD (-1), 0..50 on the shared track
// (0 = the owner's start square, 50 = the square at the foot of its home column), 51..55 up the
// home column, HOME (56). The track has 52 squares; a corner's start square is 13 * corner squares
// clockwise from red's. Corners (colours) are 0 red, 1 green, 2 yellow, 3 blue.

import { placePowerups, respawnPowerup } from './powerups.js';

export const YARD = -1;
export const LAST_TRACK = 50;
export const HOME = 56;
export const TRACK = 52;
const QUARTER = 13;
const STAR = 8; // star squares sit 8 steps past each start square

export function normRules(r = {}) {
  const on = (v) => v === true || v === 'on';
  return {
    exit: r.exit === '16' ? '16' : '6',
    safe: r.safe !== false && r.safe !== 'off',
    blockades: on(r.blockades),
    exact: r.exact !== false && r.exact !== 'off',
    captureBonus: on(r.captureBonus),
    homeBonus: on(r.homeBonus),
    powerups: on(r.powerups),
  };
}

// Seats sit clockwise in colour order; two players sit opposite each other.
export const cornersFor = (n) => (n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]);

// `humans` (optional, one boolean per seat) lets the game stop once no unfinished human is left;
// without it every seat counts as human, so play goes on until one player is left.
export function newGame(n, rules = normRules(), humans = null, seed = 1) {
  const r = normRules(rules);
  return {
    v: 3,
    rules: r,
    corners: cornersFor(n),
    tokens: Array.from({ length: n }, () => [YARD, YARD, YARD, YARD]),
    turn: 0,
    die: 0, // the last roll (kept for display)
    sixes: 0, // 6s rolled in a row this turn
    phase: 'roll', // 'roll' | 'move' | 'over'
    winner: -1, // first place (kept for v1 saves and the end screen)
    places: [], // seats in finishing order; the whole ranking once the game is over
    // powerups (docs/games/ludo.md 2.1): the live squares [{ sq, kind }], the seed they and their respawns come from,
    // shielded tokens, seats frozen for their next turn, and the seats the last turn change skipped
    pu: r.powerups ? placePowerups(seed) : [],
    puSeed: seed,
    puN: 0,
    shield: Array.from({ length: n }, () => [false, false, false, false]),
    frozen: Array.from({ length: n }, () => false),
    skipped: [],
    ...(humans ? { humans: humans.slice() } : {}),
  };
}

// A saved game from any version, made current: v1 saves ended at the first player home, so they
// have no places (an over game's winner is 1st, the rest are ranked by standings()).
export function loadGame(state) {
  state.rules = normRules(state.rules);
  if (!Array.isArray(state.places)) state.places = state.winner >= 0 ? [state.winner] : [];
  state.pu ||= [];
  state.puSeed ??= 1;
  state.puN ||= 0;
  state.shield ||= state.tokens.map(() => [false, false, false, false]);
  state.frozen ||= state.tokens.map(() => false);
  state.skipped ||= [];
  state.v = 3;
  return state;
}

export const finished = (state, seat) => state.places.includes(seat);
const isHuman = (state, seat) => !state.humans || !!state.humans[seat];

export const onTrack = (rel) => rel >= 0 && rel <= LAST_TRACK;
// Absolute track square (0..51) of a relative position, or -1 off the shared track.
export const absOf = (corner, rel) => (onTrack(rel) ? (rel + QUARTER * corner) % TRACK : -1);
export const isStart = (abs) => abs % QUARTER === 0;
export const isStar = (abs) => abs % QUARTER === STAR;
export const isSafe = (abs, rules) => rules.safe && (isStart(abs) || isStar(abs));
export const canExit = (die, rules) => die === 6 || (rules.exit === '16' && die === 1);

// Tokens on an absolute track square: [[seat, token], ...].
export function tokensAt(state, abs) {
  const out = [];
  state.tokens.forEach((ts, s) => ts.forEach((rel, t) => absOf(state.corners[s], rel) === abs && out.push([s, t])));
  return out;
}

// The seat (other than `seat`) holding a blockade (2+ tokens) on a track square, or -1.
export function blockadeAt(state, abs, seat) {
  const count = new Map();
  for (const [s] of tokensAt(state, abs)) if (s !== seat) count.set(s, (count.get(s) || 0) + 1);
  for (const [s, k] of count) if (k >= 2) return s;
  return -1;
}

// Opponent tokens a token of `seat` captures by landing on track square `abs`: none on a safe
// square, and never a shielded token.
export function capturesAt(state, seat, abs) {
  if (isSafe(abs, state.rules)) return [];
  return tokensAt(state, abs).filter(([s, t]) => s !== seat && !state.shield[s][t]);
}

// Every legal move for the player to move with `die`:
// [{ token, from, to, captures: [[seat, token], ...], home }]. Tokens on one square give equal moves;
// distinctMoves() keeps one of each.
export function legalMoves(state, die = state.die) {
  const seat = state.turn;
  const c = state.corners[seat];
  const { rules } = state;
  const moves = [];
  state.tokens[seat].forEach((from, token) => {
    if (from === HOME) return;
    let to;
    if (from === YARD) {
      if (!canExit(die, rules)) return;
      to = 0;
    } else {
      to = from + die;
      if (to > HOME) {
        if (rules.exact) return;
        to = HOME;
      }
    }
    if (rules.blockades) {
      // squares entered on the track: the start square when leaving the yard, else from+1 .. to
      for (let r = from === YARD ? 0 : from + 1; r <= Math.min(to, LAST_TRACK); r++) {
        if (blockadeAt(state, absOf(c, r), seat) >= 0) return;
      }
    }
    let captures = [];
    if (onTrack(to)) {
      const abs = absOf(c, to);
      captures = capturesAt(state, seat, abs);
    }
    moves.push({ token, from, to, captures, home: to === HOME });
  });
  return moves;
}

export function distinctMoves(moves) {
  const seen = new Set();
  return moves.filter((m) => !seen.has(m.from) && seen.add(m.from));
}

// The next seat clockwise that is still playing (finished players are skipped).
export function nextSeat(state, seat = state.turn) {
  const n = state.tokens.length;
  for (let k = 1; k <= n; k++) {
    const s = (seat + k) % n;
    if (!finished(state, s)) return s;
  }
  return seat;
}

function endTurn(state, extra) {
  if (state.phase === 'over') return;
  state.phase = 'roll';
  state.skipped = [];
  if (!extra) {
    let next = nextSeat(state);
    while (state.frozen[next]) {
      state.frozen[next] = false; // a frozen seat loses this one turn
      state.skipped.push(next);
      next = nextSeat(state, next);
    }
    state.turn = next;
    state.sixes = 0;
  }
}

// Record a roll. Returns { kind: 'forfeit' } (third 6 in a row: turn over), { kind: 'none', extra }
// (no legal move: the turn passes, or rolls again on a 6) or { kind: 'move', moves }.
export function applyRoll(state, die) {
  if (state.phase !== 'roll') throw new Error(`cannot roll in phase ${state.phase}`);
  state.die = die;
  state.sixes = die === 6 ? state.sixes + 1 : 0;
  if (state.sixes >= 3) {
    endTurn(state, false);
    return { kind: 'forfeit' };
  }
  const moves = legalMoves(state, die);
  if (!moves.length) {
    endTurn(state, die === 6);
    return { kind: 'none', extra: die === 6 };
  }
  state.phase = 'move';
  return { kind: 'move', moves };
}

// A token that ended its move on a powerup square gets its effect (docs/games/ludo.md 2.1). Effects never chain: a
// token that lands on another powerup square because of one does nothing there. The used square is
// replaced by a fresh one elsewhere. Returns { kind, sq, token, to, captures, swapped, extra, respawn }.
function triggerPowerup(state, seat, move) {
  const c = state.corners[seat];
  const abs = absOf(c, move.to);
  const i = state.pu.findIndex((p) => p.sq === abs);
  if (i < 0) return null;
  const { kind } = state.pu[i];
  const t = move.token;
  const me = state.tokens[seat];
  const fx = { kind, sq: abs, token: t, from: move.to, to: move.to, captures: [], swapped: null, extra: false };
  if (kind === 'start') me[t] = YARD;
  else if (kind === 'back') me[t] = move.from;
  else if (kind === 'jump3' || kind === 'jump6') {
    const end = Math.min(move.to + (kind === 'jump3' ? 3 : 6), LAST_TRACK); // stops at the column entry
    let to = move.to;
    while (to < end && !(state.rules.blockades && blockadeAt(state, absOf(c, to + 1), seat) >= 0)) to++;
    me[t] = to;
    if (to !== move.to) {
      fx.captures = capturesAt(state, seat, absOf(c, to));
      for (const [s, ot] of fx.captures) state.tokens[s][ot] = YARD;
    }
  } else if (kind === 'swap') {
    let best = null; // the nearest opponent token ahead that can legally take our square
    state.tokens.forEach((ts, o) =>
      ts.forEach((rel, ot) => {
        if (o === seat || !onTrack(rel) || state.shield[o][ot]) return;
        const oa = absOf(state.corners[o], rel);
        const d = (oa - abs + TRACK) % TRACK;
        if (d < 1 || move.to + d > LAST_TRACK || rel - d < 0) return;
        if (state.rules.blockades && blockadeAt(state, oa, seat) >= 0) return;
        if (!best || d < best.d) best = { o, ot, d, rel };
      }),
    );
    if (best) {
      me[t] = move.to + best.d;
      state.tokens[best.o][best.ot] = best.rel - best.d;
      fx.swapped = [best.o, best.ot];
    }
  } else if (kind === 'shield') state.shield[seat][t] = true;
  else if (kind === 'extra') fx.extra = true;
  else if (kind === 'freeze') state.frozen[seat] = true;
  fx.to = me[t];
  state.pu.splice(i, 1);
  fx.respawn = respawnPowerup(state.puSeed, state.puN++, state.pu, abs);
  state.pu.splice(i, 0, fx.respawn);
  return fx;
}

// Play a move (one of legalMoves, matched by token). Returns the move plus { finished, place, over,
// extra }: a player with all four tokens home takes the next place (1-based) and drops out of the
// turn order. The game is over when one player is left (last place) or no unfinished human is;
// then the rest are ranked by steps travelled.
export function applyMove(state, pick) {
  if (state.phase !== 'move') throw new Error(`cannot move in phase ${state.phase}`);
  const move = legalMoves(state).find((m) => m.token === pick.token);
  if (!move) throw new Error(`illegal move: token ${pick.token} with ${state.die}`);
  const seat = state.turn;
  state.shield[seat][move.token] = false; // a shield lasts until the token moves
  state.tokens[seat][move.token] = move.to;
  for (const [s, t] of move.captures) state.tokens[s][t] = YARD;
  const power = onTrack(move.to) ? triggerPowerup(state, seat, move) : null;
  const done = state.tokens[seat].every((rel) => rel === HOME);
  const r = state.rules;
  const extra = !done && (state.die === 6 || !!power?.extra || (r.captureBonus && move.captures.length > 0) || (r.homeBonus && move.home));
  let place = 0;
  if (done) {
    state.places.push(seat);
    place = state.places.length;
    if (state.winner < 0) state.winner = seat;
    const left = state.tokens.map((_, s) => s).filter((s) => !finished(state, s));
    if (left.length <= 1 || !left.some((s) => isHuman(state, s))) {
      state.places = standings(state);
      state.phase = 'over';
    }
  }
  endTurn(state, extra);
  return { ...move, power, finished: done, place, over: state.phase === 'over', extra };
}

// Steps travelled by a token: 0 in the yard, 1 on the start square, 57 at home.
export const steps = (rel) => rel + 1;

export const progress = (state, seat) => state.tokens[seat].reduce((a, r) => a + steps(r), 0);

// Standings: finished players in the order they finished, then the rest by steps travelled.
export function standings(state) {
  const rest = state.tokens.map((_, s) => s).filter((s) => !finished(state, s));
  return [...state.places, ...rest.sort((a, b) => progress(state, b) - progress(state, a))];
}
