# Ludo

Jake's brief: "classic rules, house-rule toggles, bots, pass-and-play".
There is no recording to copy. The rules are the common modern Ludo ones (four tokens, a 6 to come out,
start squares and star squares are safe). The screens are our own, built on the shared `core/` that
Yacht added for this game: seats and seat colours, the pass card, the pip die and bot pacing.

Sources: https://en.wikipedia.org/wiki/Ludo (checked 2026-10-14) describes entering on a 6, the bonus roll after a 6,
three 6s ending the turn, capture by landing, safe start squares and the exact roll to finish. Star squares as
extra safe squares are a common modern variant not described there (unverified), and that page's blockade rule
differs from our house toggle (there, a token landing on a block is sent home).

How sure each item is: **[R]** = classic rule, **[H]** = house rule or a variant we define ourselves,
**[D]** = a design choice, open to change after play-testing.

---

## 1. Classic rules [R]

- **Board:** the usual 15 × 15 cross. A shared **track of 52 squares** runs clockwise round the cross.
  Each colour has a yard in one corner, a **start square** just outside it, a **home column** of 5
  squares up the middle of its own arm, and the **home** triangle in the centre.
  Corners clockwise from top left: **red, green, yellow, blue** (`core/seats.js` `SEAT_COLOURS` order).
- **2-4 players**, 4 tokens each, all in the yard at the start. Play goes clockwise; seat 1 starts.
- **A turn:** roll one die, then move one token that many squares, if any move is legal.
- **Leaving the yard:** only a **6** brings a token out, onto your start square. That uses the roll.
- **Moving:** a token goes 51 squares round the track (start square = step 0, the square at the foot of
  its own home column = step 50), then turns into its home column (steps 51-55) and reaches **home at
  step 56**. Tokens never go round twice and only the owner can enter a home column.
- **Exact roll to finish:** a move that would go past home is not allowed.
- **Capture:** landing on a square held by opponent tokens sends **all** of them back to their yard.
  Tokens in a home column are out of reach.
- **Safe squares:** the four **start squares** and the four **star squares** (8 steps past each start).
  Nobody can be captured there, so tokens of different colours can share them.
- **Stacking:** your own tokens may share a square. Without the blockade rule a stack is not protected:
  an opponent landing there captures the whole stack.
- **Extra roll on a 6:** roll again after the move (or after no move, if none was legal).
- **Three 6s in a row** in one turn: the third 6 is not played and the turn ends at once.
- **No legal move:** the turn passes (still rolling again on a 6).
- **End:** the first player with all four tokens home wins and the game ends. **[D]** The rest are ranked
  by tokens home, then by total steps travelled. (Playing on for places is an open question below.)

## 2. House rules (Settings → Ludo) [H]

Defaults are the classic rules. Each game stores the rules it started with, so changing a toggle
mid-game only affects the next game (a toast says so).

| Setting | Options | Default | Effect |
|---|---|---|---|
| Leave yard on | 6 / 1 or 6 | 6 | **1 or 6:** a 1 also brings a token out (no extra roll for the 1) |
| Safe squares | On / Off | On | **Off:** no square is safe, start and star squares included |
| Blockades | Off / On | Off | **On:** two or more of one player's tokens on a track square form a blockade. Opponents can neither land on it nor pass it, leaving the yard included. The owner's tokens pass freely |
| Finish | Exact / Overshoot | Exact | **Overshoot:** a roll past home just goes home |
| Roll again on capture | Off / On | Off | **On:** a capture earns an extra roll |
| Roll again on home | Off / On | Off | **On:** getting a token home earns an extra roll |
| Powerups | Off / On | Off | **On:** random powerup squares on the track, see 2.1 |
| Auto-roll | On / Off | On | Not a rule. The die rolls itself on a human's turn, so they only act when a token has to be chosen |
| Auto-move | On / Off | On | Not a rule. When only one move is possible (tokens on the same square count as one) it is played for you |
| Bot speed | Slow / Normal / Fast | Normal | Not a rule |

### 2.1 Powerups [H]

A board option for stupid fun, off by default and kept per game like the other rules.

- **Placement:** at game start 8-10 track squares carry a powerup, picked from a seed stored in the
  game (so a save restores them). Never a start or star square, never the three squares in front of a
  yard exit (start + 1..3), so 32 squares qualify; the picks are at least 3 apart. Each gets a random
  effect by weight.
- **Trigger:** when a token ends its move on the square (not when it passes over it; leaving the yard
  never triggers one, since the start square has none). The token's owner gets the effect.
- **Respawn [D]:** a used square is replaced by a fresh one (new effect, new place, same spacing and
  legality rules, from `hashSeed(seed, respawn count)` so it is repeatable and saved). The board always
  has the same number, and a game does not run dry or get predictable.
- **No chaining:** a token moved by an effect (jump, swap, back) does nothing on the square it ends on.
  The square it jumped onto stays live for the next arrival.

| Effect | Weight | Result |
|---|---|---|
| Jump +3 (green >) | 4 | up to 3 squares further |
| Jump +6 (teal >>) | 3 | up to 6 squares further |
| Swap (purple arrows) | 3 | trade places with the nearest opponent token ahead (within the mover's own track, not shielded, not on a blockade); the opponent goes back the same distance. No target: nothing |
| Shield (gold shield) | 3 | immune to capture until this token moves again (gold ring) |
| Roll again (pink die) | 4 | an extra roll, like a 6 (it does not reset the three-6s count) |
| Back to start (red |<) | 3 | the token returns to the yard |
| Back (orange U-turn) | 4 | the token returns to the square it was on before this move |
| Freeze (blue snowflake) | 3 | the player's next turn is skipped (a snowflake shows on their chip) |

Good effects are 17 of 27 (63 %), bad 10 (37 %). Rules for the awkward cases:

- A jump stops at the foot of the home column (step 50), and before an opponent blockade. It captures
  whatever it lands on, unless that square is safe or the token is shielded. A shielded token can be
  landed on without being captured, like on a safe square.
- Freeze on a move that earns an extra roll (a 6, say): the extra roll is still taken, then the next turn
  is skipped.
- Capture, home, blockade, exact finish, the three-6s forfeit, extra rolls and the play-on logic are
  unchanged; effects run after the move's own capture.

**Display:** the squares are a layer over the board in the effect's colour with a white icon (colour
and shape both differ, so colour alone is never the only cue). Tapping a square names it; the **?**
in the top bar opens the legend. A trigger shows a banner ("Jump +6!", "Frozen!", "Back to start!"),
a short rising or falling sound, then the tokens slide to their new squares (instantly with reduced
motion). A skipped turn shows "Skipped!" and a note.

**Bots:** Medium and Hard read the square a move ends on and add its worth in steps to the move's
score: jumps +3 / +6, swap +6, shield +5, roll again +7, back to start -(steps travelled + 10),
back -(the roll), freeze -8. Hard adds it at weight 1.5, Medium at x2 on top of its priorities.
Easy stays random.

Extra rolls never stack into more than one roll per move. The three-6s count only counts 6s; a
capture or home bonus after a 5 starts the count again.

## 3. Seats, bots, pass-and-play

- **Seats:** 2-4. Each is a human or a bot (Easy / Medium / Hard), in any mix. Humans can rename their
  seat. The last setup is remembered. Default: Player 1 and three Medium bots. **[D]**
- **Seat colours:** with **2 players they sit opposite** (red and yellow), so each has the same open track
  in front of them; with 3, red, green, yellow; with 4, all four. The seat rows on the setup screen show
  those colours. **[D]**
- **Pass-and-play:** as in Yacht (`core/seats.js` pass rule): when the turn moves to a human, two or
  more humans play, and it is not the human who played last, a full-screen **"Pass to <name>"** card in
  that seat's colour waits for a tap. Extra rolls stay with the same player, so no card. Bot turns play
  in the open. Ludo has no hidden information, so the card is only a hand-over cue.
- **Bot pace [D]:** about 0.4 s thinking, the 0.45 s roll tumble, 0.45 s to look at the die, the chosen token
  lifts for 0.3 s, then it hops 0.11 s per square, and 0.35 s before the next turn. Slow ×1.6, Fast ×0.45
  (`core/dice.js` `botDelay`). **Reduced motion** keeps the pauses but drops the tumble, the hops and the
  pulsing: tokens jump straight to their square.

### 3.1 Bot strategy

All bots choose from `legalMoves()`, so they cannot break a rule.

- **Easy:** a random legal move.
- **Medium:** fixed priorities, no look at the opponents: capture > reach home > leave the yard >
  enter the home column or land on a safe square > move the token furthest along. One move in four
  is random instead, so Medium sits between Easy and Hard (without the slips it won 86 % against Easy
  and Hard beat it only 57 % of the time).
- **Hard:** scores every legal move and plays the best:
  - **Capture:** +40, plus the victim's steps travelled (sending back an advanced token is worth more).
  - **Risk:** for each of its tokens on the track, the chance that some opponent token can land on it
    next turn (an exact roll 1-6 = 1/6; 7-12 = a 6 then the rest = 1/36; an opponent yard token next
    to its start square when that square is not safe = its exit chance), times what it would lose
    (10 + steps travelled). The move is scored by how much it lowers the total risk, so escaping danger,
    reaching safe squares, forming blockades and removing a threat by capturing all count.
  - **Progress:** home +30, into the home column +20, out of the yard +25, a small bonus for moving the leader, and a penalty for shuffling inside the home column
    when another token could use the roll.
  - **Pressure:** a small bonus for each opponent token left 1-6 squares in front of the moved token.

  This is a one-move heuristic, not a search: Ludo is mostly luck and a short, explainable rule set
  plays about as well as a deeper search would at this size.

## 4. Screens [D]

Setup is ordinary responsive DOM, like Yacht's. The play screen sits in a fixed design space fitted
with `core/stage.js` inside the safe areas:

- **portrait:** 1080 wide, at least 1700 tall: top bar, player strip, the board (1020 × 1020, 68 per
  square, so about 23 CSS px per square at 360 px wide), then the die tray, which takes the extra height.
- **landscape** (aspect > 1.15): 1900 × 1000, controls on the left and the board (940) on the right.

1. **Setup:** back, title, gear; seat rows (2-4); a rules summary with **House rules**; a big **Start**.
2. **Play:**
   - Top bar: back, the turn line ("Red's turn" / "Rusty is thinking"), gear.
   - Player strip: a chip per seat (colour, name, bot glyph + level, and four pips: home / out / in the yard).
     The current seat is lit.
   - **Board:** an SVG drawn once per game (stars only when safe squares are on); tokens are DOM
     buttons over it. The current player's yard glows. Stacked tokens shrink and fan out.
   - **Tray:** a message line and the die in the current player's colour. **Tap the die to roll.**
   - After a roll, the tokens that can move pulse. **Tap a token to move it.** A tap near a legal
     token counts (within about one square), so small screens stay easy. Auto-move plays a single option
     after a short beat. "No move" and "Three 6s: turn lost" show for a moment before the turn passes.
   - Banners: "Captured!", "Home!", "Roll again".
3. **Pass to <name>:** the shared card.
4. **Game over:** the winner crowned and the standings. **Play again** (same seats, current house rules)
   and **New game** (setup).

**Save and resume:** the whole game (rules, seats, tokens, turn, die, phase, six count) is saved after
every roll and move and on hide. Opening Ludo with a game in progress resumes it, mid-bot-turn too.
**Gear → New game** abandons it after a confirm.

**Sound / haptics** (core/audio.js, core/haptics.js), all gentle and gated by the global toggles:
dice rattle and land (shared with Yacht), a soft wooden tick per hop, a pop for leaving the yard,
a bonk and a falling slide for a capture, a chime for home, a low blip for no move, a two-note pass
chime, and a fanfare at the end.

**Colourblind symbols** (global setting): tokens carry a white shape (red circle, green triangle,
yellow square, blue diamond), and the yards show the same shape.

## 5. Shared core used and extended

- `core/seats.js`: `SEAT_COLOURS`, `BOT_LEVELS`, the pass rule. Added `needsPassAt(players, current,
  lastHuman)` (the rule without a seats object; `needsPass` now calls it) so a game that keeps its own
  turn can use it.
- `core/seats-ui.js`: `seatSetup()` takes an optional `colourAt(i, n)` so Ludo's two seats show red and
  yellow; `passScreen()` as is.
- `core/dice-view.js`: one die and `tumble()`.
- `core/dice.js`: `rollDie`, `botDelay`, `BOT_SPEEDS`.
- `core/dice-sounds.js` (new): the dice rattle, roll buzz and landing thump, moved out of Yacht's
  sounds so both games share them.
- `body.reduced-motion` from `core/app.js`.

## 6. Milestones

1. **Rules engine** `games/ludo/rules.js`: board geometry (track, home columns, yards, safe squares),
   legal moves, captures, blockades, exact finish, extra rolls, triple 6, win; tests for each rule and
   each house-rule switch.
2. **Bots** `games/ludo/bot.js`: easy / medium / hard; a legality and full-game test over every rule mix,
   and win rates measured (below).
3. **Core + game:** the core changes in section 5, `games/ludo/board.js` (SVG board and token
   positions), `game.js` (setup, play, pass, game over, save/resume), `sounds.js`, shelf entry, precache.
4. **Polish:** layouts checked headless at 384×693, 360×740, 412×915, 768×1024, 1440×900 and 915×412
   (setup, 4-seat game, stacks, pass card, game over), reduced motion, offline reload.

Milestone 4 result: setup, a busy 4-seat game (stacks, a shared star square, home column, tokens home,
colourblind shapes), the pass card and game over checked headless at 384×693, 360×740, 412×915, 768×1024,
1440×900 and 915×412. Fixes: the die kept its face (a button reset had blanked it), a dark ring round movable
tokens (white alone vanished on the cream board), the board isolated so tokens stay under the game-over card,
and a spacer that puts a third of a tall phone's spare height above the board. Also checked: a full autoplayed
game with a reload mid-game, tap-near on a stack, the extra roll after a 6, auto-move on and off, the pass
card, reduced motion, and an offline reload that resumes mid-move.

### Bot win rates (classic rules, seeded, seats rotated so each bot starts equally often)

| Match | Games | Win rate of the first bot | Fair share |
|---|---|---|---|
| Hard vs Easy | 4000 | 91.7 % | 50 % |
| Hard vs Medium | 4000 | 73.6 % | 50 % |
| Medium vs Easy | 4000 | 81.4 % | 50 % |
| Hard vs 3 Easy | 4000 | 72.6 % | 25 % |
| Hard vs 3 Medium | 4000 | 46.0 % | 25 % |

A 2-player game takes about 175 rolls, a 4-player game about 400-490. Under house rules Hard beats
Easy 92 % with blockades, 88 % with no safe squares, and 98 % with 1-or-6 exits plus both bonus rolls
(more choices per roll reward the better chooser).

- **Tuning:** a one-at-a-time sweep of every Hard weight (×0, ×0.5, ×2) against Medium found none that
  helped beyond noise, and neither did reshaping a token's worth in the risk term; the risk, leader and
  exit terms matter most (zeroing exit is the worst single change). Each move is well under 0.1 ms.

## 7. Open questions for play-testing

- Bot pace at Normal with three bots: watchable, or too slow between your turns?
- Should the game play on for 2nd and 3rd place when several humans play?
- Is the near-token tap radius right, or does it pick the wrong token in crowded spots?
- Auto-move: helpful, or does it surprise?
- Does Hard feel clearly stronger than Medium without being unfair?

## 8. Save and testing

- `ctx.store` blob: `{ setup: { players: [{ name, kind, level }] }, game: <in-progress game> | null }`. The game
  state is plain JSON (`rules.js`); `loadGame()` brings saves from older versions up to date (v1 saves ended at the
  first player home). It resumes mid-move, including during a bot's turn.
- `?autoplay` plays human seats with the Hard bot at Fast speed; `?debug` exposes
  `window.__ludo()` -> `{ save, g, moves, anim, passing }`.
- Unit tests: `tests/ludo-rules.test.js` (every rule and house toggle), `tests/ludo-bot.test.js` (legal, finished
  games under every rule mix; Hard beats Easy), `tests/ludo-powerups.test.js` (placement, each effect, no chaining,
  saves, bots).
