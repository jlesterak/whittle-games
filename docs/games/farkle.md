# Farkle

Six dice. Roll, set aside dice that score, then roll the rest or bank the points. A roll that scores nothing is
a farkle and the turn's points are lost. First to the target, then everyone else gets one last turn. 1-4 seats of
humans and bots, pass-and-play, and a solo mode that counts the turns you take. Code: `games/farkle/`
(`rules.js`, `bot.js`, `game.js`, `sounds.js`); seats, the pass card, the die view and bot pacing come from `core/`.

## Rules

Farkle is a folk game with many local variants. Ours follows the base rules and scoring from *Playing Grandma's
Games* (Arnold) as summarised at https://en.wikipedia.org/wiki/Farkle (checked 2026-11-02). The house toggles
below are variants listed on the same page.

- **A turn:** roll all six dice. Set aside at least one scoring die, then either **bank** the turn's points or
  **roll** the dice that are left. A roll with no scoring dice is a **farkle**: the turn ends and its points are lost.
- **Hot dice:** when all six dice have been set aside, the player may roll all six again and keep adding to the
  turn. There is no limit.
- **Combinations count within one roll only.** A third 5 rolled after two 5s were set aside is a single 5 (50),
  not three 5s.
- **Every die you set aside must score.** A set of dice scores its best reading: four 1s are three 1s plus a
  single 1 (1,100), which beats four of a kind (1,000).
- **End:** once a player's banked total reaches the target, every other player has one last turn. The highest
  total wins; equal totals share the win.

| Dice | Score |
|---|---|
| Each 1 | 100 |
| Each 5 | 50 |
| Three 1s | 1,000 |
| Three 2s, 3s, 4s, 5s, 6s | 200, 300, 400, 500, 600 |
| Four of a kind | 1,000 |
| Five of a kind | 2,000 |
| Six of a kind | 3,000 |
| Three pairs (three different faces) | 1,500 |
| Run 1-2-3-4-5-6 | 2,500 |

Our choices where the source is silent: four of a kind plus a pair is not three pairs; two triples in one roll
score as two triples; a five-dice run is not a combination (only its 1 and 5 score).

## House rules (Settings -> Farkle)

| Setting | Options | Default | Effect |
|---|---|---|---|
| Target | 10,000 / 5,000 / 2,500 | 10,000 | Score that starts the last round. The source gives 10,000 and says it varies |
| Three pairs | 1,500 / 750 / Off | 1,500 | **Off:** three pairs score only their 1s and 5s (the page lists 750, 1,500 and 2,000) |
| Four or more of a kind | Fixed / Doubling | Fixed | **Doubling:** each die past three doubles the triple, so 1s go 1,000 / 2,000 / 4,000 / 8,000 |
| Hot dice | May roll / Must roll | May roll | **Must roll:** after setting aside all six you must roll again (you can't bank on that keep) |
| Entry minimum | None / 500 / 1,000 | None | You can't bank until one turn reaches this; after your first bank, any amount |
| Bot speed | Slow / Normal / Fast | Normal | Not a rule |

A game keeps the rules it started with; changes apply to the next game.

## Seats and bots

- 1-4 seats, each a human or a bot (Easy, Medium, Hard), coloured from `core/seats.js`. With two or more humans a
  "Pass to" card hides the dice between human turns.
- **Hard** maximises the expected points of the turn, computed exactly: a table of V(t, n), the expected final
  turn score with t points set aside and n dice to roll, filled from the top down over every possible roll
  (multinomial probabilities). It is about 60 ms to build per rule mix and is cached. A test plays 20,000 Hard
  turns and checks their mean against the table.
- **Medium** follows rules of thumb: a die left to roll is worth about 150, and it banks at a threshold that rises
  with the dice left (300 with one or two, 400 with three, 600 with four, 1,500 with five, never with six).
- **Easy** is a greedy beginner: it keeps every die that scores and pushes for a big turn, banking at 800, 1,000
  or 1,200 (picked at random each time). A timid Easy (banking at 200-400) was tried first; Hard beat it only 59-66 %
  of the time, which made the levels too close.
- **Last round:** every level keeps rolling until it is ahead of the leader, then banks.
- **Measured** (2026-11-02, standard rules, 1000 two-player games from seed 1000, seats swapped every game, a tie
  counts half; `winShare()` in `tests/farkle-bot.test.js`): Hard beats Easy 75.3 %, Medium beats Easy 72.6 %, Hard
  beats Medium 54.9 %. Solo turns to reach 10,000 (300 games each, seeds 0-299): Easy 24.8, Medium 18.7, Hard 17.5.
  Hard's expected turn from scratch is 600 points (the table's value; played turns agree within the test's bounds).

## Screens

Setup (seats, house rules summary, Best turns, Start), play (seat chips with banked totals, the turn's points,
six dice where set-aside dice stay greyed in place, Roll and Bank buttons that show what they will do, a scoring
table for the current rules), the pass card, game over with standings, and a solo top 10 per target (fewest turns).
Portrait layout 1080 wide, or two panes on wide screens.

## Save

`ctx.store` blob: `{ setup: { players: [{ name, kind, level }] }, game: <in-progress game> | null,
best: { '10000': [...], '5000': [...], '2500': [...] } }`. The game record carries `v: 1`, its rules, seats, banked
scores, entry flags, turns taken, the final-round seat and the turn (dice, set-aside flags, points, phase). Dice
picked but not yet kept are not saved, so a resumed turn shows the same roll with nothing picked. A game whose
shape fails `validGame()` is kept under `farkle.broken` and the setup screen comes back. Best lists are
`{ turns, score, date, tag }`, fewest turns first.

## Testing

- `?autoplay` plays human seats with the Hard bot at Fast speed.
- `?debug` exposes `window.__fk()` -> `{ save, g, seats, pick }`.
- Unit tests: `tests/farkle-rules.test.js` (every combination under every toggle, the farkle check by brute force,
  keeps, hot dice, entry, the last round, the save shape), `tests/farkle-bot.test.js` (legal play under eight
  rule mixes, the last round, Hard's table against play, Hard beats Easy in at least 70 % of 1000 games).

## Known gaps

- Hard maximises points per turn, not the chance of winning the game; near the end a player far behind should
  take more risk. The last-round rule covers the clearest case.
- No migration path exists yet for a `v: 2` game record; a shape change would need one.
