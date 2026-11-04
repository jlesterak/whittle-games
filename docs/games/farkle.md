# Farkle

Six dice, push your luck: keep scoring dice, roll the rest, and bank before a roll scores nothing. 1-4 seats of
humans and bots, pass-and-play, solo best runs. Code: `games/farkle/` (`rules.js`, `bot.js`, `game.js`,
`sounds.js`); seats, the pass card, the die view and bot pacing come from `core/`, as in Yacht.

## Rules

The public-domain dice game, with the base scoring table from *Playing Grandma's Games* (Arnold) as given at
https://en.wikipedia.org/wiki/Farkle (checked 2026-11-04).

- **A turn:** roll six dice. Set aside at least one scoring die or combination, then either **bank** the points
  held this turn or roll the dice left. A roll with nothing to keep is a **Farkle**: the turn ends with no points.
- **Keeps:** every die kept must score, and dice from different rolls never combine. When kept dice can be
  scored more than one way, the best split counts (four 1s with the flat table score 1,100: three 1s and a 1).
- **Hot dice:** when all six dice have been set aside, roll all six again and keep adding to the turn.
- **End:** once a player banks to the target, every other player has one last turn. Highest score wins; equal
  top scores tie.

| Combination | Points |
|---|---|
| Each 1 | 100 |
| Each 5 | 50 |
| Three 1s | 1,000 |
| Three 2s / 3s / 4s / 5s / 6s | 200 / 300 / 400 / 500 / 600 |
| Four / five / six of a kind | 1,000 / 2,000 / 3,000 |
| Three pairs | 1,500 |
| Run (1-2-3-4-5-6) | 2,500 |

The base table has no two-triplets, four-and-a-pair or full-house combinations; two triplets score as two
three-of-a-kinds and four and a pair is not three pairs. The run is 2,500 as in that table; the page lists
1,000, 1,500 and 3,000 as variations, which are not offered here.

## House rules (Settings -> Farkle)

| Setting | Options | Default | Effect |
|---|---|---|---|
| Play to | 10,000 / 5,000 | 10,000 | The target score |
| Entry minimum | None / 500 / 1,000 | None | A player's first bank must reach this in one turn ("opening threshold" on the page above) |
| Three pairs | 1,500 / Off | 1,500 | **Off:** three pairs score only their 1s and 5s |
| Four of a kind+ | Flat / Doubling | Flat | **Doubling:** four, five and six of a kind are 2x, 4x and 8x three of that kind (four 1s 2,000) |
| Hot dice | On / Off | On | **Off:** once all six are set aside the turn must bank |
| Bot speed | Slow / Normal / Fast | Normal | Not a rule |

Choices made where the source leaves it open (simplest standard option):

- With hot dice off and an entry minimum, a player can set aside all six dice while still under the minimum.
  That turn ends with nothing, like a Farkle (the game says so before the keep).
- No three-Farkles penalty and no every-turn minimum (both are common variations; neither is in the base rules).
- The doubling toggle uses the page's "four of a kind (doubling)" and carries the doubling on to five and six.

A game keeps the rules it started with; changes apply to the next game.

## Seats and bots

- 1-4 seats, each a human or a bot (Easy, Medium, Hard). With two or more humans a "Pass to" card hides the dice
  between human turns. A solo human plays to the target; the score is the number of turns it took.
- **Hard** maximises the expected points of the turn, computed: `bot.js` builds a table of the value of banking
  and of rolling on for every (dice left, points held), over every roll of the dice left and every scoring keep,
  hot dice included, in steps of 50 points up to 8,000 held (it always banks there). It keeps the dice that lead
  to the best value and banks when banking is worth at least as much as rolling. Its computed value of a fresh
  turn with the default rules is 599.9 points; 100,000 played turns averaged 600.9.
- **Medium** keeps a triple or better (or every die when they all score), else one single (a 1 before a 5), and
  banks at 250 / 300 / 400 / 500 / 1,000 points with 1 / 2 / 3 / 4 / 5 dice left; it never banks with six to roll.
- **Easy** keeps its highest-scoring keep and banks at 300 or more, or with four dice or fewer left.
- Every bot plays its last turn (someone has reached the target) to beat the leader: it rolls on until it leads.
- Measured 2026-11-04, default rules, two-seat games with seats alternating who goes first, from seed 2026
  (`tests/farkle-bot.test.js` runs the first): Hard beats Easy in 764 of 1000, Hard beats Medium in 564 of 1000,
  Medium beats Easy in 722 of 1000. Average points per turn over 100,000 turns: Easy 461.5, Medium 564.9,
  Hard 600.9.

## Screens

Setup (seats, house rules summary, Best runs, Start), play (score chips with a bar toward the target, the dice
kept this turn grouped by roll with their scores, the turn total and what the picked dice add, six dice to tap,
Roll and Bank buttons that say what they will do), Farkle / Hot dice / Last round banners, the pass card, game
over with standings, and a solo top 10 of fewest turns per target. One portrait layout 1080 wide, letterboxed on
wide screens.

## Save

`ctx.store` blob: `{ setup: { players }, game: <in-progress game> | null, high: { 10000: [...], 5000: [...] } }`
with best-run entries `{ turns, date, tag }`. The game record carries `v: 1`, its rules, seats (scores on the
seats), the turn (`roll`, `pts`, `left`, `kept`, `hot`), the picked dice, the phase (`start`, `pick`, `farkle`),
turns taken per seat and `finalFrom` (the seat that reached the target, or -1). It resumes mid-turn, also during a
bot's turn; a record that fails its checks is kept as `farkle.broken` and the setup screen comes back.

## Testing

- `?autoplay` plays human seats with the Hard bot at Fast speed; `?debug` exposes `window.__fk()` ->
  `{ save, g, seats }`.
- Unit tests: `tests/farkle-rules.test.js` (every combination and toggle, keeps that don't score, Farkle checks,
  hot dice, the entry minimum, the end), `tests/farkle-bot.test.js` (legal keeps and banks under seven rule mixes,
  Hard's turn value, last-turn play, Hard beats Easy in at least 70% of 1000 seeded games).
- `node tools/smoke.mjs --game farkle` (also `--a11y` and `--saves`).

## Known gaps

- Wide screens get the portrait layout letterboxed, not a two-pane layout like Yacht's.
- Hard maximises points per turn, not the chance of winning the game (beyond its last turn).
- No migration path exists yet for a `v: 2` game record.
