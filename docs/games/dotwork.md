# Dotwork

Tap arrows out of a dense maze. An arrow can only leave when nothing stands between its head and the edge of the
board. Code: `games/dotwork/` (only `core/` is shared with other games).

## How a level plays

- The board is a grid of dots, fully covered by arrows. Each arrow is a snake of cells; it points the way of its
  last step (tail to head). Boards are rectangles or pictures (circle, diamond, heart, plus, ring, hourglass).
- **Tap an arrow:** a ray runs from its head to the board edge.
  - Ray clear: the arrow slides out along its path and its cells free up at once.
  - Ray blocked: the arrow bumps the first arrow on its ray, turns white and costs **one star**. Tapping a white
    arrow that is still blocked costs another star.
- **Stars:** 3 per level. At 0 the level is lost (Out of Stars).
- **Win:** every arrow is out. The reward is 5 coins per star left (at least 1 star), doubled on hard levels.
  LEVEL COMPLETED shows the stars; under 3 stars it offers Replay. The best stars per level are kept.
- **Out of Stars:** pay 100 coins for +1 star and keep the board as it is, or Give Up -> LEVEL FAILED -> Replay.

Removing an arrow only ever frees cells, so a level is winnable exactly when greedy peeling (remove every free
arrow, repeat) empties it. `board.js` `peel()` is that solver.

## Boosters

Start counts: Hint 9, Eraser 3, Star wand 4, Guide lines 5. Each costs 100 coins once used up.

| Booster | Effect |
|---|---|
| Hint | Marks one random free arrow green (fits the camera first). Shown until it is used. |
| Eraser | Arms an eraser: the next arrow tapped is removed where it stands, free or blocked, at no star cost. Tap the booster again or the X on the banner to cancel. |
| Star wand | Fires up to 10 random free arrows at once (`WAND_MAX`). |
| Guide lines | Shows every arrow's ray until the next arrow flies. |

## Levels and difficulty

Levels are generated on the device, the same on every phone (`generator.js`, seeded by level number). The board is
cut into random snakes grown from the most hemmed-in free cell, then the snakes are oriented by forward peeling
(pick a snake with an end whose ray is clear of every other unoriented snake; that end becomes its head). The pick
order is a solution, so every level is winnable by construction, and generation throws if peeling ever fails.
Six seeds are tried per level; the one closest to the level's targets (peel depth, share of arrows free at the
start) is kept.

Knobs by level (`knobs(n)`; t = min(1, (n - 1) / 80), from 0 at level 1 to 1 from level 81):

| Level | Board | Colours | Target peel layers | Free at start |
|---|---|---|---|---|
| 1 | 6x8 | 2 | 3 | 42 % |
| 10 (hard) | 11x14 | 3 | 14 | 30 % |
| 20 (hard) | 15x19 | 3 | 18 | 26 % |
| 40 (hard) | 22x28 | 4 | 25 | 18 % |
| 80 (hard) | 34x43 | 5 | 33 | 10 % |
| 150+ | up to 40x50 (pictures 40x45) | 4, hard 5 (pictures 2) | 33 | 10 % |

- **Hard levels:** every 5th level from 5 on: a 15 % bigger board, harder targets, a HARD LEVEL splash and tab,
  double coins.
- **Breathers:** the level after a hard one is 15 % smaller and easier.
- **Pictures:** from width 11, every 3rd level uses a picture mask, coloured in two tones by rings from the centre.
  Rectangles colour arrows so neighbours differ.
- **Level 208** is a fixed board (36x45, 163 arrows, 31 peel layers) kept as a regression fixture
  (`level208.js`). See docs/DECISIONS.md D2.

Colour carries no rule (it only separates neighbouring arrows), so Dotwork has no colourblind glyphs.

## Settings and display

- No game settings of its own (`settings: []`); the global Sound, Haptics and Reduced motion apply.
- Reduced motion: camera moves jump instead of gliding, the win dot wave is skipped and the LEVEL COMPLETED card
  comes after 0.3 s instead of 1.8 s; the HARD LEVEL mascot and the end-screen animations stop moving.

## Controls

Tap on release (a touch that moves more than 10 px or lasts over 350 ms is not a tap). Drag pans, pinch or mouse
wheel zooms, double-tap on empty space toggles between fit and 2x. The camera always keeps a quarter of the board
on screen. Tips on levels 1 and 2, and a one-time zoom tip on boards drawn small.

## Save

`ctx.store` blob: `{ level, coins, boosters: { hint, erase, wand, guide }, best: { [level]: stars }, zoomTip,
inProgress: { level, gen, board: { gone, failed, stars, mistakes }, hint } | null }`. Saved on every move, every
5 s, on hide and on exit. `LEVEL_GEN` (1) is bumped when the generator changes, so an in-progress save of an older
board restarts that level instead of loading arrows that no longer exist. A save that does not match its level
also restarts the level.

## Testing

- `?level=N#/dotwork` jumps to level N (note: it also sets the saved level).
- `?autoplay=1` fires free arrows every 0.12 s.
- `?debug` exposes `window.__po()` -> `{ board, level, save, renderer }`.
- Unit tests: `tests/dotwork-board.test.js` (level 208 shape and peel, the tap rule, losing and the +1 star
  continue, save round trip), `tests/dotwork-generator.test.js` (levels 1-60, 80, 150 and 209 winnable and well
  formed; deterministic; difficulty rises with breathers after hard levels; picture masks; level 208).

## Known gaps

- `?level=N` overwrites the saved level; fine for testing, surprising if used by accident.
- Performance numbers are in docs/PERF.md once item P7 is done.
