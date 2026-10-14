# Yacht

Five dice, up to three rolls a turn, thirteen boxes to fill. 1-4 seats of humans and bots, pass-and-play, solo
high scores. Code: `games/yacht/` (`rules.js`, `bot.js`, `game.js`, `sounds.js`); seats, the pass card, the die view
and bot pacing come from `core/`.

## Rules

The classic rules of the trademarked commercial version of this public-domain dice game, as described at
https://en.wikipedia.org/wiki/Yahtzee (checked 2026-10-14). The name Yacht is the older public-domain game's.

- **A turn:** roll five dice, then up to two more rolls, keeping any dice between rolls. Then fill one open box.
- **Upper boxes:** Ones to Sixes score the sum of that face. 63 or more in the upper boxes adds a **35 bonus**.
- **Lower boxes:** 3 of a kind and 4 of a kind score the sum of all dice; Full house 25; Small straight (four in a
  row) 30; Large straight (five in a row) 40; YACHT (five of a kind) 50; Chance scores the sum.
- **Yacht bonus:** each further Yacht, while the YACHT box holds 50, scores **+100**. A 0 in the YACHT box forfeits
  it.
- **Joker (forced):** a Yacht thrown while the YACHT box is filled must go in its matching upper box if open;
  otherwise in any open lower box, where Full house and the straights take their full values; otherwise a 0 in
  an open upper box.
- **End:** after 13 turns each. Highest total wins.

## House rules (Settings -> Yacht)

| Setting | Options | Default | Effect |
|---|---|---|---|
| Joker rule | Forced / Free | Forced | **Free:** any open box; Full house and the straights still take their Joker values whenever the YACHT box is filled |
| Yacht bonus | +100 / Off | +100 | **Off:** no bonus for further Yachts |
| Score card | Classic / Triple | Classic | **Triple:** three columns worth x1, x2 and x3 (39 turns); the Joker applies per column, and a Yacht scores the bonus once any column's YACHT box holds 50 |
| Bot speed | Slow / Normal / Fast | Normal | Not a rule |

A game keeps the rules it started with; changes apply to the next game. **Play again** starts the next game with
the current settings.

Note: the free-choice Joker described on the page cited above only gives the Joker values once the matching upper
box is filled. Ours is more generous. It is a house rule, so it stays unless the owner wants it changed.

## Seats and bots

- 1-4 seats, each a human or a bot (Easy, Medium, Hard), coloured from `core/seats.js`. With two or more humans a
  "Pass to" card hides the dice between human turns.
- **Hard** and **Medium** search every hold for the rest of the turn exactly (252 distinct rolls x 462 holds). They
  differ in how they value the box they end in: Hard charges each box its average score under optimal solitaire
  play (Tom Verhoeff's optimal solitaire analysis, https://wstomv.win.tue.nl/misc/yahtzee/; the page loads, checked
  2026-10-14, but the per-box numbers in `bot.js` were not re-checked against it) and plays for the upper bonus; Medium takes the most points now. **Easy** follows a rule of thumb.
- Measured averages (solitaire, classic card, forced Joker, 1000 games per bot from seed 2026; ± is the 95 %
  interval): Easy 178.6 ± 3.9, Medium 217.0 ± 3.2, Hard 242.2 ± 3.5. Triple card (250 games each): Easy 1266 ± 24,
  Medium 1462 ± 20, Hard 1710 ± 20. Measured 2026-10-14 by playing `botHold` / `botBox` to a full card, as
  `tests/yacht-bot.test.js` does.

## Screens

Setup (seats, house rules summary, High scores, Start), play (score card with previews of what the dice would score,
tap dice to hold, tap a box twice to score, Joker notes, YACHT and bonus banners), the pass card, game over with
standings, and a solo top 10 per card (classic and triple) with dates. Portrait layout 1080 wide, or two panes on
wide screens.

## Save

`ctx.store` blob: `{ setup: { players: [{ name, kind, level }] }, game: <in-progress game> | null,
high: { classic: [...], triple: [...] } }`. The game record carries `v: 1` (its shape version), its rules, seats,
cards, dice, holds and rolls left. The game resumes mid-turn, including during a bot's turn. A missing `high`
list is filled with empty ones.

## Testing

- `?autoplay` plays human seats with the Hard bot at Fast speed.
- `?debug` exposes `window.__yz()` -> `{ save, g, seats, sel }`.
- Unit tests: `tests/yacht-rules.test.js` (every box, Joker cases, bonuses, the Triple card),
  `tests/yacht-bot.test.js` (legal holds and boxes under every rule mix, Joker spots, Hard beats Easy).

## Known gaps

- Our free Joker is more generous than the free-choice rule on the cited page (see House rules).
- The Triple card's multipliers and its per-column Joker are our own house variant; no public source is cited.
- No migration path exists yet for a `v: 2` game record; a shape change would need one (CLAUDE.md, "Never break
  a save").
