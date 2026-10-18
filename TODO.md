# Whittle TODO

Item IDs refer to PLAN.md. Agents: update this file in the same commit as the work (see CLAUDE.md).

## Inbox
Owner notes from play-tests (date, game, what). Agents turn each one into a fix or a plan item, then delete it here.

## [IN PROGRESS]

## [PENDING]
- P6h [HUMAN] Check clipping on the phone
- P7 Frame-rate budget
- P8 Accessibility and input basics
- P9 [HUMAN] Play-test on the phone (sound mix, haptics, super-slow speed, difficulty curve, Ludo powerups)
- P10 [HUMAN] Beadloom recordings: a fill-booster use and a lift on a locked crate
- E1 Progress on the shelf
- E2 Daily puzzle
- E3 Farkle
- E4 Backgammon
- E5 Cards core and Klondike
- X1 Install guide and a live-site check

## [COMPLETED]
- 2026-10-18: P6 layout sweep: smoke --sweep (3 games x 13-15 levels x 5 viewports, renderer bounds() + HUD on screen,
  apart and off the level, contact sheet); Dotwork board now starts below its tip line (tips covered the top row).
  Owner's Beadloom clipping not reproduced at level start; not covered: tips/banners shown mid-play, Purl side HUD
  may sit on a wide frame's wood (not the picture). Five fresh verifiers; the last PASS
- 2026-10-14: D2s generated boards replace the three rebuilt from recordings (level 208 is ordinary, Dotwork
  LEVEL_GEN 2); the tests now check reveal timing, real swaps, dispenser order and peel layers (mutation-checked)
- 2026-10-14: P5 Beadloom feeder joins are rounded fillets on every wall layer, shadow drawn once at 25 %; track
  geometry test; static rebuild back to 3-6 ms on level 40 (the shadow layer is kept between rebuilds)
- 2026-10-14: owner decisions: D1 the Unlicense (public domain), D2 swap the rebuilt boards (D2s), D3 Pages on
  (serves master), D5 Yacht's free Joker stays a house rule
- 2026-10-14: P3 save safety: repaired record, cleanSave/cleanPlayers, refused damaged resumes, kept copies
  (<id>.broken, three deep), could-not-start card, import confirm + backup; smoke --saves 57 cases + fallback
- 2026-10-14: P4 6-column Beadloom boards: already worked (old TODO item stale); checked headless, layout test added
- 2026-10-14: P2 whole updates: VERSION is a content hash, a new worker waits for the shelf's Update ready /
  Reload, other tabs move over when they leave their game; smoke --sw covers offline, mid-game and two tabs
- 2026-10-14: R4 public game docs: docs/games/{beadloom,purl,dotwork,yacht,ludo}.md from the code, numbers checked
  by three reviews; comments cite public docs or `ref` notes; Yacht and Ludo figures re-measured
- 2026-10-14: P1 public-ready pass: no personal names in tracked files, no secrets or private hosts, D2 lists the
  boards rebuilt from recordings and what else was measured from them
- 2026-10-14: R3 headless smoke check: tools/cdp.mjs + tools/smoke.mjs (no npm packages), 18 pages in ~35 s, in CI
  with screenshots kept; vibrate waits for the first tap; Dotwork hides its parked bars while erasing
- 2026-10-14: R2 CI: node --test (now also imports every app module) and the precache check on PRs and master
- 2026-10-14: R1 agent docs and plan: CLAUDE.md (rules adopted from Skyband), PLAN.md, TODO.md by item ID,
  README split into README + docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/CREDITS.md

## History (before PLAN.md, newest first)
- Beadloom track layout (owner, 2026-10-13: "layout still wonky, incoming beads hidden in the ring beads"): rings
  never shrink below a round hole (dropped the scaled-down and pinched hourglass shapes), feeder arms sit at the
  screen sides and merge at an angle instead of running alongside the ring, waiting rows stop at the ring's edge and
  draw over it, HUD moved up into the headroom and the speed toggle to the left so neither covers an arm.
  Checked headless at 412x780 / 412x915 on levels 1, 5-11, 40, 55 (rings of 80-130 rows)
- The owner play-tested Yacht, Ludo, Dotwork and Purl on the phone: "great" / "looks good on mobile" (2026-10-09)
- Ludo powerups board (owner, 2026-10-09): house rule "Powerups" (off by default), 8-10 seeded squares with eight
  effects (jump +3 / +6, swap, shield, roll again, back to start, back, freeze), used squares respawn, icon layer,
  legend (?), banners and sounds, Medium/Hard value the squares. Ludo doc 2.1; unit-tested; checked headless at
  360x740 and 1440x900. Owner: play-test it (effect mix, whether freeze/back to start feel too harsh)
- Ludo plays on after the first winner (owner, 2026-10-09): finished players take places and are skipped; ends at one
  left, or ranks a bots-only remainder by progress. Unit-tested (63 tests); a full 2-human game not yet checked live
- Yacht Play again starts the next game with the current house rules, like Ludo (owner, 2026-10-09);
  mid-game rule changes still wait for the next game
- Ludo auto-roll (setting, on by default): a human only acts when a token must be chosen. Bot pace one step
  faster in every dice game: Normal = the old Fast (x0.45), Fast = x0.2, Slow = the old Normal (owner, 2026-10-09)
- Dropped the Dice Tray placeholder (owner, 2026-10-09): Yacht and Ludo now exercise the dice helpers
- Ludo polish (milestone 4): layouts checked headless at 384x693, 360x740, 412x915, 768x1024, 1440x900 and
  915x412 (setup, busy 4-seat game with stacks and colourblind shapes, pass card, game over); fixes: die face
  under the button reset, dark ring on movable tokens, tokens kept under the game-over card, tall-phone spacer;
  offline reload resumes mid-move
- Ludo game (milestone 3): `games/ludo/board.js` (SVG board, stars only with safe squares, faded empty yards,
  colourblind shapes, token layout with fanned stacks), `game.js` (setup with 2-4 seats, die tap to roll,
  pulsing movable tokens, tap-near picking within 1.25 squares, auto-move for a single option, hop-by-hop moves,
  capture slide home, banners, pass card, bots at a watchable pace, game-over standings, save/resume mid-move),
  `sounds.js`, shelf entry. Core: `needsPassAt`, `seatSetup` colourAt, `dice-sounds.js` and `icons.js` (shared
  with Yacht), setup-screen CSS moved to core/style.css. Verified headless: autoplayed game with a mid-game
  reload, tap-near on a stack, extra roll after a 6, pass card, auto-move on and off, Yacht unchanged
- Ludo bots (milestone 2): `games/ludo/bot.js` Easy random, Medium priorities with a random move 1 in 4,
  Hard scores captures, progress and the drop in risk (opponents' landing chances x token worth); Hard beats Easy
  92 %, Medium 74 %, wins 73 % against 3 Easy; tests for legality and finished games under every rule mix
- Ludo rules engine (milestone 1): `games/ludo/rules.js` (relative token positions, 52-square track, opposite
  seating for 2, legal moves with captures of whole stacks, safe start/star squares, blockades, exact or overshoot
  finish, extra rolls on 6 / capture / home, three 6s forfeit, win, standings); tests for each rule and toggle
- Ludo design doc: classic rules (6 to leave, safe start + star squares, exact finish, extra roll on 6, three 6s
  forfeit), house toggles, 2-4 seats with opposite seating for 2, easy/medium/hard bots, screens, milestones
- Yacht polish (milestone 4): layouts checked headless at 384x693, 360x740, 412x915, 768x1024, 1440x900
  and 915x412 (setup, 4-seat game, Triple, pass card, game over, high scores): column widths, 2x2 standings,
  pass-card name sizing, sticky Start; README section
- Yacht game (milestone 3): `games/yacht/game.js` (setup with 1-4 seats, play screen with score card
  previews, tap-to-hold dice, two-tap scoring, Joker notes, YACHT / bonus banners, pass-to card, bots at a
  watchable pace, game over with standings, solo top 10 per card with dates, save/resume mid-turn), `sounds.js`,
  shelf entry. Core: `seats.js` SEAT_COLOURS / BOT_LEVELS / needsPass, `seats-ui.js` (seat setup, pass card),
  `dice-view.js` (pip die, tumble), `dice.js` botDelay, body.reduced-motion class. Verified headless: autoplayed
  solo game, pass flow, reload mid bot turn, Joker + bonus, reduced motion, offline reload
- Yacht bots (milestone 2): `games/yacht/bot.js` exact one-turn hold search (252 rolls x 462 holds);
  Hard = opportunity costs sliding to one-turn values + upper-bonus probability (avg 246), Medium = greedy
  values (217), Easy = rule of thumb (182); tests for legality under every rule mix and Joker spot
- Yacht rules engine (milestone 1): `games/yacht/rules.js` (13 boxes, upper bonus 35 at 63, Yacht bonus
  +100, forced and free Joker, Triple card with per-column Joker, totals); tests for every box and Joker case
- Yacht design notes: classic rules with forced Joker, house toggles (free Joker, no bonus, Triple card),
  1-4 seats of humans and easy/medium/hard bots, pass screen, solo top 10, screens and milestones
- Dotwork polish (milestone 4): cached still layer (arrows at rest, settled dots, rays) redrawn only on
  change or camera move, arrows batched per colour: level 208 at 4x CPU throttle went from ~14 to ~45 fps
  at a human tap pace; end-screen pop order and reduced motion. Layouts checked headless at 384x693,
  360x740, 412x915, 768x1024, 1440x900 (splash, level 208, eraser banner, Out of Stars, win): nothing clips
- Dotwork renderer and game (milestone 3): `render.js` (fit / pinch / wheel / drag camera clamped to keep
  a quarter of the board visible, snake escape at 13 + 95t cells/s, bump out and back with white arrow,
  cream blocker fade and "-1" star badge, tinted vacated dots, win dot wave, green hint arrow with its ray,
  guide rays, pink rub-out, wand sparks), `game.js` (HUD bar with HARD LEVEL tab, stars, progress, coins,
  gear; boosters hint / eraser with banner / star wand (up to 10 free arrows) / guide lines, 9-3-4-5 to
  start, 100 coins each when out; HARD LEVEL splash; LEVEL COMPLETED with stars and 5 coins per star (x2
  hard), Replay if under 3 stars; Out of Stars with +1 star for 100 coins keeping the board, Give Up ->
  LEVEL FAILED; saves and resume), `sounds.js`, shelf entry. Verified in headless Chrome over CDP with
  touch taps: win, loss, continue, all boosters, pinch, drag, double-tap, reload-resume, offline
- Dotwork generator (milestone 2): `generator.js` partitions the board (rectangle or a picture mask:
  circle, diamond, heart, plus, ring, hourglass) into snakes grown from the most hemmed-in cell, then orients
  them by forward peeling with targeted split repairs, so every level is winnable by construction. Knobs over
  levels 1-80 (6x8 -> 34x43, up to 40x50), hard every 5th, smaller breathers after; best of 6 seeds against a
  peel-depth / free-at-start band; ~0.3 s for the biggest boards. Level 208 is the recorded board
- Dotwork model (milestone 1): `games/dotwork/board.js` (ray-cast tap rule, bump = white + -1 star,
  lanes free at launch, eraser, +1 star continue, save/restore, greedy peel solver), level 208 reconstructed
  from the recording as `level208.js` (163 arrows, 31 peel layers, 17 free at start) as the fixture
- Layout fix after the owner's phone test (Firefox Android, S22 Ultra): both games fit fully at any aspect.
  Shared `core/stage.js` contain-fits the design plus headroom above y=0 inside the safe area
  (`.game-root` now honours env(safe-area-inset-*)); Beadloom feeder arms end in rounded caps inside
  the headroom and small boards sit centred; Purl's frame gets a top rail, its tip moved off the
  spool rack, backdrops widened for landscape; end-screen dims cover the letterbox. Checked headless at
  384x693, 384x823, 360x740, 412x915, 768x1024, 1440x900
- Purl polish (milestone 4): lift mode keeps "?" colours hidden, flat outline voids and seamless
  walls, colourblind glyphs on knit/spools/caps checked, HARD intro, 4x end-game fast-forward guarded by
  a winLocked test
- Purl renderer and game (milestone 3): `render.js` + `sprites.js` (procedural knit blocks with
  bottom loops, columns sliding down as the bottom block unravels, sagging yarn threads, glossy upright
  spools vs flat caps vs "?" caps with stand-up and reveal flash, glass-dome dispensers facing
  left/right/down that stay empty, raised void walls, tumbling pick flight, wound-yarn slot bobbins with
  3-segment bar and %, fly-off sparkle, left-to-right topple), `game.js` (HUD: restart, gear, level pill,
  HARD badge and intro, coins; boosters scissors / bobbin pull / balloon; LEVEL COMPLETE with trophy and
  coin count-up; Out of space with Continue = 8th slot for 100 coins or Give Up -> Level Failed / Try
  Again; saves and resume; `?level`, `?autoplay`, `?debug`), `sounds.js`, shelf entry. Verified in
  headless Chrome over CDP: shelf, picks, threads, win, lose, all three boosters, reload-resume, offline
- Purl solver + generator (milestone 2): `columnModel` (column pointers, whole-block closure),
  `columnsFromOrder` (3 jittered blocks per bobbin dealt bottom-up into the lowest column), knobs over
  levels 1-60 (8 -> 33+ bobbins, 3 -> 10 colours, 1-5 per colour, 3-5 columns, facing dispensers,
  hidden "?" up to 35 %, HARD every 5th level with its own win-rate band), 6-wide boards with void
  blobs (`knitMask`). Engine generator: per-colour counts up to `maxPerColour`, a game `mask` hook,
  hidden tiles only where not pickable at the start (Beadloom levels unchanged, checked by hash).
  Level 254 fixture: the logged picks, reveals and empty hoods; solver wins the full board
- Purl simulation (milestone 1): `games/purl/columns.js` (4 column stacks, whole-block
  threads at 1.3 s/block, parallel columns per bobbin, left bobbin first, scissors = engine fill
  cutting blocks from anywhere, balloon hooks as extra bottoms), `rules.js` config (7 slots, 3-block
  bobbins, persistent facing dispensers, Continue = 8th slot). Engine: `claimDelay` (no thread until
  the bobbin has landed) and time-ordered landings for parallel feeds. Tests: conservation, claim
  rules, dispensers, lose, win, boosters, save/restore
- Beadloom ice crates and side-facing dispensers (ref C.2): engine `ice` tile (thaws as units are
  collected; solver, generator and stuck-with-free-slot lose all aware), Beadloom from level ~22, ice cube
  with a bead counter and a shard burst; edge dispensers facing in with a side stripe. In-progress saves
  from the old generator restart the level (LEVEL_GEN)
- Beadloom, second recording applied to the UI: Out of space stage (dimmed game, lit slot row, Add space
  via a +1 booster or coins, up to 6 slots, X -> Level failed / Try again), Move Box tooltip with every
  liftable crate raised, idle hint after 9 s over usable boosters only, speed mode chip, Hard / Very Hard
  tag with skull on spike levels; +1 booster capped at 5 slots
- Beadloom reference notes: second recording (level 2803, a loss) analysed; lose flow, Move Box, +1 slot, base speed,
  idle hint, ice crates and side dispensers marked [M]; refs 15-17
- Beadloom: 4x fast-forward once the win is unavoidable (every crate placed and every unit left in
  the supply has a waiting crate with room: `sim.winLocked()`), with a "»" badge; test guards it
- Beadloom polish (milestone 5): tips on levels 1-2, min ring of 8 segments (round O), audio
  only after a gesture, colourblind symbols checked, save/restore round-trip test, boosters and
  resume verified in headless Chrome over CDP
- Beadloom renderer and feel (milestone 4): `render.js` + `sprites.js` (pre-rendered glossy
  beads in hex-packed rows of 5, O/wide/hourglass track with U/S feeders, spout, slot cups with
  bead piles and %, raised/outlined pickable crates, swap arrows, dispenser + dashed zone,
  locks/keys, lid/stars/tumble/confetti, "?" reveals, Awesome! banner), `game.js` (scaled DOM HUD:
  gear, level, coins, 3-way speed pill, boosters with badges/modes/idle hint; Congrats and Out of
  space screens; save/resume; `?level=N` and `?autoplay=1` for testing), `sounds.js` (WebAudio).
  60 fps at 4x CPU throttle with GPU raster in headless Chrome
- Slot-sort engine (`engines/slotsort/`): board, sim, solver and generator split out of Beadloom
  so Purl can reuse them with its own supply model (column stacks) and config
- Beadloom solver + generator (milestone 3): `solver.js` (abstract segment-level DFS with memo,
  random-player win rate, full-sim replay check), `generator.js` (difficulty curve over levels
  1-60 with breathers/spikes, board shapes, swaps/dispensers/locks, jittered bead stream, verified
  winnable before shown: 3 slots on levels 1-10, else 4), `track.js` (O / wide / hourglass ring
  geometry shared with the renderer). Level 2796 fixture in tests/fixtures
- Beadloom simulation (milestone 2): `board.js` (pickability, swaps, keys/locks, dispensers) and
  `sim.js` (row-cell ring, feeders with "?" reveal, spout into the leftmost matching slot,
  crate capacity, win, Out of space, the three boosters, three speeds, serialize/restore).
  Fixed 60 Hz step, deterministic. Tests: conservation/no overfill, pickability, special tiles, lose
- Core skeleton (milestone 1): shelf, game-module interface, settings, save + export/import,
  WebAudio + haptics helpers, rng/dice/seats helpers, PWA manifest + icons, service worker
  with a generated precache list, Dice Tray placeholder game
