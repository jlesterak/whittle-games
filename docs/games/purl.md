# Purl

Unravel a knitted picture onto bobbins. Send bobbins to a row of slots; the bottom block of each column of the
picture unravels onto a slotted bobbin of its colour. Clear the board before the slots clog. Code: `games/purl/` on
the shared slot-sort engine in `engines/slotsort/` (shared with Beadloom; see docs/games/beadloom.md for the
engine's board rules).

## How a level plays

- **Board:** bobbins standing on a grid 6 cells wide and up to 7 rows deep, with void cells cut into the outline.
  A bobbin can be picked when it is in the top row or touches an empty cell connected through empty cells to the
  top edge.
- **Pick:** tap a pickable bobbin; it flies to the leftmost free slot. 7 slots.
- **The picture:** 3 to 5 columns of knitted blocks (each block is 6 stitch rows). Only a column's bottom block can
  unravel. When a slotted bobbin needs a whole block and a free column's bottom matches it, a thread starts: the
  block leaves the column and its 6 rows wind onto the bobbin over 1.3 s. One column feeds one bobbin at a time; a
  bobbin may draw from several columns at once; columns are served left first, bobbins left first. A thread only
  starts once the bobbin has landed (0.7 s after the tap).
- **Bobbins:** each takes 3 blocks (18 rows), then pops 0.2 s later and frees its slot.
- **Dispensers:** glass domes that hold a queue of bobbins and drop the next one into the one cell they face
  (left, right or down) whenever it is empty. Empty domes stay on the board as blockers.
- **Hidden bobbins:** show "?" until they can be picked. From level 4.
- **Win:** board, domes, slots and picture all empty. Reward 20 coins, 40 on hard levels. Every 3rd level cleared
  also gives a booster (in turn: Lift, Balloon, Scissors).
- **Out of space (lose):** all 7 slots hold bobbins no column bottom can feed, with nothing unravelling. The panel
  offers **Continue** (an 8th slot for 100 coins) or Give Up -> LEVEL FAILED -> Try Again.
- **Fast-forward:** once the win is certain, the picture unravels at 4x.

## Boosters

Start with 3 of each; 100 coins buys one more.

| Booster | Effect |
|---|---|
| Scissors | Cut a slotted bobbin's missing blocks from anywhere in the picture (parked blocks first, then the lowest), closing the gaps. Winds at about thread speed, not instantly. |
| Bobbin pull (Lift) | Pick any bobbin, ignoring the path to the top. |
| Balloon | Lift the bottom blocks of up to 2 idle columns onto the two hooks beside the picture. A parked block acts as an extra column bottom. Prefers columns whose bottom no slotted bobbin wants and whose next block one does. |

## Levels and difficulty

Generated on the device by the engine generator (`rules.js` knobs; see docs/games/beadloom.md for the steps). For
Purl: difficulty d rises from 0 at level 1 to 1 at level 60, then wanders between 0.65 and 1.

- **Hard levels:** every 5th from level 5: d + 0.15, 3 more bobbins, more jitter and hidden bobbins, a HARD intro
  and badge, double coins, and a lower random-player win-rate band (15-45 %).
- **Bobbins:** about 8 + 25d (up to 40), 1-5 per colour, 3 to 10 colours.
- **Columns:** 3 on levels 1-3, then 4 (about one level in five has 5 once d > 0.75).
- **Dispensers:** from level 6; 1-3 on later levels, each holding 2-4 bobbins.
- **Hidden:** from level 4, up to 35 % of the board.
- **Board outline:** small boards narrow from the bottom up; bigger ones get a blob of voids in the middle rows,
  sometimes mirrored. Every cell connects to the top row.
- **Check:** levels 1-10 must be solvable with 5 slots (2 to spare), the rest with 7; the solution must win in the
  real simulation.

Samples: level 1 has 8 bobbins in 3 colours over 3 columns; level 40 (hard) has 25 bobbins on the board, 8 colours,
10 hidden and 2 domes over 5 columns.

## Settings and display

- No speed setting (the thread speed is part of the puzzle).
- Colourblind symbols on knit blocks, bobbins and caps; Reduced motion.
- Tips on levels 1 and 2 until the first pick.

## Save

`ctx.store` blob: `{ level, coins, boosters: { fill, lift, balloon }, cleared, inProgress: { level, gen, sim } | null }`
where `sim` is `SlotSim.serialize()` with the column stacks as the supply (threads in progress land their reserved
rows when saved). Saved on every pick, every 5 s, on hide and on exit. `LEVEL_GEN` (1) restarts an in-progress level
after a generator change.

## Testing

- `?level=N#/purl` jumps to level N (it also sets the saved level).
- `?autoplay=1` plays the solver's solution.
- `?debug` exposes `window.__ck()` -> `{ sim, level, save, renderer }`.
- Unit tests: `tests/purl-sim.test.js` (conservation, threads, dispensers, out of space and Continue, win, scissors
  and balloons, save mid-thread, fast-forward), `tests/purl-solver.test.js` (solver, hard level 45's hidden bobbins and dispensers pick by pick, board
  outlines, every generated level winnable, conservation in generated levels).

## Known gaps

- Several threads on one colour drain columns left first; a model that drains matching columns evenly could
  leave part-blocks, which only matters when more columns match than a bobbin needs.
