// Yacht rules: scoring, legal boxes (forced or free Joker), the upper and Yacht bonuses, and
// the Triple card (three columns worth x1 x2 x3). Pure and DOM-free; see docs/games/yacht.md.
//
// A card is { cols: [[score|null x 13], ...], ybonus: n }, one column (classic) or three (triple).
// Boxes are addressed as (col, cat) with cat an index into CATS.

import { counts, sum } from '../../core/dice.js';

export const CATS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes', 'three', 'four', 'full', 'small', 'large', 'yacht', 'chance'];
export const LABELS = ['Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', '3 of a kind', '4 of a kind', 'Full house', 'Sm straight', 'Lg straight', 'YACHT', 'Chance'];
export const [ONES, , , , , SIXES, THREE, FOUR, FULL, SMALL, LARGE, YACHT, CHANCE] = CATS.keys();
export const UPPER_BONUS = 35;
export const UPPER_NEED = 63;
export const YACHT_BONUS = 100;
const JOKER_FIXED = { [FULL]: 25, [SMALL]: 30, [LARGE]: 40 };

export const DEFAULT_RULES = { joker: 'forced', bonus: true, variant: 'classic' };

export function normRules(r = {}) {
  return {
    joker: r.joker === 'free' ? 'free' : 'forced',
    bonus: r.bonus !== false && r.bonus !== 'off',
    variant: r.variant === 'triple' ? 'triple' : 'classic',
  };
}

export const multipliers = (rules) => (rules.variant === 'triple' ? [1, 2, 3] : [1]);
export const turnsPerGame = (rules) => 13 * multipliers(rules).length;
export const isUpper = (cat) => cat <= SIXES;

export function newCard(rules) {
  return { cols: multipliers(rules).map(() => new Array(13).fill(null)), ybonus: 0 };
}

export const isYacht = (dice) => dice.every((d) => d === dice[0]);

function hasRun(c, len) {
  let run = 0;
  for (let v = 1; v <= 6; v++) {
    run = c[v] ? run + 1 : 0;
    if (run >= len) return true;
  }
  return false;
}

// The plain score of the dice in a box, ignoring the Joker.
export function rawScore(cat, dice) {
  const c = counts(dice);
  if (isUpper(cat)) return c[cat + 1] * (cat + 1);
  const max = Math.max(...c);
  switch (cat) {
    case THREE:
      return max >= 3 ? sum(dice) : 0;
    case FOUR:
      return max >= 4 ? sum(dice) : 0;
    case FULL:
      return c.includes(3) && c.includes(2) ? 25 : 0;
    case SMALL:
      return hasRun(c, 4) ? 30 : 0;
    case LARGE:
      return hasRun(c, 5) ? 40 : 0;
    case YACHT:
      return max === 5 ? 50 : 0;
    default:
      return sum(dice);
  }
}

// A Joker applies in column col when the dice are a Yacht and that column's YACHT box is filled.
export const jokerIn = (card, col, dice) => isYacht(dice) && card.cols[col][YACHT] !== null;

// Legal boxes for these dice: [{ col, cat }]. Every open box, except that a forced Joker narrows a
// column to its matching upper box, else its open lower boxes, else its open upper boxes (for a 0).
export function legalBoxes(card, dice, rules) {
  const out = [];
  card.cols.forEach((boxes, col) => {
    const open = CATS.map((_, cat) => cat).filter((cat) => boxes[cat] === null);
    let ok = open;
    if (rules.joker === 'forced' && jokerIn(card, col, dice)) {
      const face = dice[0] - 1;
      const lower = open.filter((cat) => !isUpper(cat));
      ok = boxes[face] === null ? [face] : lower.length ? lower : open;
    }
    for (const cat of ok) out.push({ col, cat });
  });
  return out;
}

// What the dice score in (col, cat), before the column multiplier, with Joker values.
export function boxScore(card, col, cat, dice) {
  if (JOKER_FIXED[cat] && jokerIn(card, col, dice)) return JOKER_FIXED[cat];
  return rawScore(cat, dice);
}

// The Yacht bonus this move would earn: a Yacht scored outside a YACHT box while any
// YACHT box holds 50 (the official rule on a classic card).
export function bonusFor(card, cat, dice, rules) {
  if (!rules.bonus || cat === YACHT || !isYacht(dice)) return 0;
  return card.cols.some((b) => b[YACHT] === 50) ? YACHT_BONUS : 0;
}

// Score the dice in (col, cat). Mutates the card; throws on an illegal box.
// Returns { score, bonus } (score before the multiplier).
export function applyScore(card, col, cat, dice, rules) {
  if (!legalBoxes(card, dice, rules).some((b) => b.col === col && b.cat === cat)) {
    throw new Error(`illegal box ${CATS[cat]} in column ${col}`);
  }
  const score = boxScore(card, col, cat, dice);
  const bonus = bonusFor(card, cat, dice, rules);
  card.cols[col][cat] = score;
  if (bonus) card.ybonus++;
  return { score, bonus };
}

export const upperSum = (boxes) => boxes.slice(0, 6).reduce((a, b) => a + (b || 0), 0);

export function totals(card, rules) {
  const mult = multipliers(rules);
  const cols = card.cols.map((boxes, i) => {
    const upper = upperSum(boxes);
    const bonus = upper >= UPPER_NEED ? UPPER_BONUS : 0;
    const lower = boxes.slice(6).reduce((a, b) => a + (b || 0), 0);
    return { upper, bonus, lower, total: (upper + bonus + lower) * mult[i] };
  });
  const ybonus = card.ybonus * YACHT_BONUS;
  return { cols, ybonus, total: cols.reduce((a, c) => a + c.total, 0) + ybonus };
}

export const cardFull = (card) => card.cols.every((b) => b.every((v) => v !== null));
export const boxesFilled = (card) => card.cols.reduce((n, b) => n + b.filter((v) => v !== null).length, 0);
