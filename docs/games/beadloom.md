# Beadloom

Send crates to a row of slots; a ring of beads circles past a spout and pours each bead into the leftmost slotted
crate of its colour with room. Clear the board before the slots clog. Code: `games/beadloom/` on the shared
slot-sort engine in `engines/slotsort/` (shared with Purl).

## How a level plays

- **Board:** crates on a grid 5 columns wide (6 on some very hard levels), up to 5 rows. A crate can be picked when
  it is in the top row or touches an empty cell connected through empty cells to the top edge.
- **Pick:** tap a pickable crate; it moves to the leftmost free slot. 4 slots at the start.
- **Ring and feeders:** the ring is a loop of bead rows (10 rows = one 50-bead segment). It turns past the spout;
  a row of a slotted crate's colour pours into the leftmost such crate with room. Each row that pours leaves a gap,
  and a gap passing a feeder mouth takes that feeder's front row (right feeder first). Feeder segments can be
  hidden as "?" until they reach the front.
- **Crates:** each holds 20 rows (100 beads). A full crate completes after 0.45 s and frees its slot.
- **Win:** the board is empty and every slot is free. Reward 25 coins, doubled when no booster was used. Every 3rd
  level cleared also gives one booster (in turn: Lift, Fill, +1 slot).
- **Out of space (lose):** every slot holds a waiting crate, nothing is in flight, and no bead of a slotted colour
  can reach the spout without another pick. The game dims around the slot row and offers **Add space** (a +1 slot
  booster if there is one, else 100 coins) up to 6 slots, or X -> Level failed -> Try again. A level can also be
  lost with a free slot when every crate left is frozen or locked and nothing can thaw them.
- **Fast-forward:** once the win is certain (every crate placed and every bead left has a waiting crate with room,
  `sim.winLocked()`), the belt runs at 4x with a "»" badge.

## Special tiles

| Tile | Rule |
|---|---|
| Swap pair | Two crates with arrows. Every pick swaps the colours of every remaining pair; picking one of a pair freezes its partner as a plain crate. From level 4. |
| Dispenser | A box that drops its queued crates into the cells below it (or, from the board edge, beside it) whenever those are empty; it disappears when empty. Blocks paths. From level 7. |
| Lock and key | A padlocked crate can't be picked until the crate carrying its key is picked. From level 10. |
| Ice | A frozen crate with a counter: it thaws once that many more bead rows have gone into crates (any colour). From level 14. |
| Hidden feeder segment | Shows "?" until it reaches the front of its feeder. From level 3. |

Each level uses one kind of special tile; from level 20, half of them use two.

## Boosters

Start with 3 of each; 100 coins buys one more.

| Booster | Effect |
|---|---|
| +1 slot | One more slot, up to 5 (Add space after Out of space may open a 6th). |
| Lift (Move Box) | Pick any crate, ignoring the path to the top (not locks or ice). Every liftable crate is raised while armed. |
| Fill | Instantly pulls the beads a slotted crate still needs from the ring, then the feeders. |

After 9 s without a tap, arrows point at the boosters that can be used.

## Levels and difficulty

Generated on the device, the same on every phone (`rules.js` knobs, `engines/slotsort/generator.js`):

1. Knobs from the level number. Difficulty d rises from 0 at level 1 to 1 at level 60; every 5th level is a
   breather (d x 0.7) and every 10th a spike (+0.12, tagged **Hard**, or **Very Hard** once d >= 0.9). After 60, d
   wanders between 0.7 and 1 before those adjustments (so breathers can drop to about 0.49).
2. Board: 6 to 25 crates (about 6 + 19d), 1-2 crates per colour, of 19 colours; shape from the crate count;
   special tiles as above.
3. A "competent player" clears the board; its pick order is turned into the bead stream: two segments per crate
   placed near its turn in the order, jittered (more jitter on harder levels), the first 8-13 segments forming the
   ring and the rest split between the feeders.
4. The solver must clear it with 3 slots (levels 1-10) or 4, the solution must win in the real simulation, and a
   random player's win rate should fall in a band that moves down as d rises. Up to 24 attempts; later ones calm the
   knobs down.

Samples: level 1 has 6 crates and an 80-row ring; level 40 has 21 crates, 8 swap crates, 2 locks and a 130-row ring.
Ring shapes: a round O on levels 1-4, then a repeating cycle of six (squared O, wide, O, squared O, O, wide from
level 5; `shapeFor` in `track.js`).

## Settings and display

- Speed (gear or the speed pill, which cycles): Super slow, Normal (x1), Double (x2), Fast (x4).
- Colourblind symbols on beads and crates; Reduced motion.
- Tips on levels 1 and 2 until the first pick.
- Design space 1080 x 2316 with headroom above it for the feeder arms, contain-fitted by `core/stage.js`.

## Save

`ctx.store` blob: `{ level, coins, boosters: { slot, lift, fill }, cleared, inProgress: { level, gen, sim } | null }`
where `sim` is `SlotSim.serialize()` (version 2: tick, supply, slots, board arrays, picks, speed, status, boosters
used, completions). Saved on every pick, every 5 s, on hide and on exit. `LEVEL_GEN` (2) is bumped when the
generator changes so an in-progress save of an older board restarts that level; a save that fails to load also
restarts the level.

## Testing

- `?level=N#/beadloom` jumps to level N (it also sets the saved level).
- `?autoplay=1` plays the solver's solution (picks when the board is settled and a slot is free).
- `?debug` exposes `window.__bo()` -> `{ sim, level, save, renderer }`.
- Unit tests: `tests/beadloom-sim.test.js` (conservation, pickability, swaps, keys, dispensers, out of space,
  hidden tiles, save round trip, ice), `tests/beadloom-solver.test.js` (solver, swap pairs, level 33's swaps and dispenser pick by pick,
  levels 1-80 and a spread up to 5000 winnable with a full-simulation replay), `tests/beadloom-turbo.test.js`
  (fast-forward never precedes a loss).

## Known gaps

- PLAN P6 (clipping on some phones) and P8 (the crate tap box is a little narrower than the crate).
- 6-column boards were checked in P4 (levels 48, 51, 59, 60, 99 at 360x740 and 412x915: crates inside the board,
  side dispensers right, autoplay wins); `tests/beadloom-layout.test.js` guards the layout constants, rails
  included.
- Where a feeder joins the ring the walls meet in a rounded, concentric fillet (`junctionCorners`, `filletCentre`,
  `filletShape` in `track.js`, tested in `tests/beadloom-track.test.js`). The dark channel keeps its V; beads
  mostly cover it.
- Not yet recorded from play: a fill-booster use and a lift on a locked crate (PLAN P10).
