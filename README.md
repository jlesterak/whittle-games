# Whittle

Jake's offline game shelf: a phone-first PWA, vanilla JS (ES modules) and Canvas 2D,
no framework, no build step, no runtime dependencies. After the first load it runs with
zero network. Games: **Beadloom** (bead-ring sorting) and **Purl** (unravel a knitted
picture onto bobbins), both on a shared slot-sort engine, and **Dotwork** (tap arrows out of a
dense maze when their way to the edge is clear), on `core/` only, **Yacht** (classic rules with
house-rule toggles, 1-4 seats of humans and bots, pass-and-play, solo high scores) and **Ludo** (classic
rules with house-rule toggles incl. a Powerups board, 2-4 seats of humans and bots, pass-and-play).

## Run it

```sh
cd ~/whittle
python3 -m http.server 8000
# open http://localhost:8000/
```

Tests (Node 20+): `node --test` (72 tests, a few seconds).

Beadloom URL helpers for testing: `?level=N#/beadloom` jumps to level N,
`?autoplay=1` plays the solver's solution, `?debug` exposes `window.__bo()` (sim, level, save).
Purl takes the same `?level=N`, `?autoplay=1` and `?debug` (`window.__ck()`), e.g.
`?debug&level=25#/purl`. Dotwork takes `?level=N`, `?autoplay=1` (fires free arrows) and
`?debug` (`window.__po()`); level 208 is the board reconstructed from the recording.
Yacht takes `?autoplay` (human seats are played by the Hard bot at Fast speed) and `?debug` (`window.__yz()`).
Ludo takes the same `?autoplay` and `?debug` (`window.__ludo()`).

## Layout

- `index.html`, `manifest.webmanifest`, `sw.js`, `icon*` : the PWA shell
- `core/` : shelf + routing (`app.js`), `settings.js`, `save.js` (localStorage + export/import),
  `audio.js` (WebAudio synth), `haptics.js`, `ui.js`, and helpers for future games:
  `rng.js` (seeded), `dice.js` (rolls, bot pacing), `dice-view.js` (pip die + roll tumble), `dice-sounds.js`,
  `seats.js` (players/turns, seat colours, pass rule), `seats-ui.js` (seat setup rows, "Pass to" card), `icons.js`,
  `stage.js`; `style.css` also holds the seated games' setup screen (`.setup*`)
- `engines/slotsort/` : the shared engine for "pick into a slot, a supply pours in" games
  (Beadloom now, Purl next): board rules (`board.js`), simulation with a pluggable
  supply (`sim.js`), solver + replay (`solver.js`), level generator (`generator.js`)
- `games/index.js` : the shelf's game list
- `games/<id>/` : one folder per game
- `docs/` : the game specs and reference stills
- `tools/precache.mjs` : regenerates the service worker's file list

## Adding a game

1. Create `games/<id>/game.js` with a default export:
   ```js
   export default {
     settings: [{ key: 'speed', label: 'Speed', options: [['a', 'A'], ['b', 'B']], default: 'a' }], // optional
     mount(root, ctx) {
       // ctx: { root, store: {get, set}, settings: {get, set, onChange}, audio, haptics,
       //        ui: {el, modal, toast}, exit(), openSettings() }
       // Game settings are read with ctx.settings.get('<id>.<key>').
       return { unmount() {} };
     },
   };
   ```
2. Add an entry (id, title, blurb, icon SVG, `load: () => import('./<id>/game.js')`) to `games/index.js`.
3. Run `node tools/precache.mjs` so the service worker caches the new files (a test checks this).

### Slot-sort games (Beadloom, Purl, ...)

Games where you pick items off a board (exit-path-to-top rule) into a slot row and a supply
feeds matching slotted items share `engines/slotsort/`. The engine owns the board (swaps,
locks/keys, dispensers that vanish or persist, hidden "?" tiles, ice that thaws as units are collected), the slots (leftmost-free
placement, capacity, completion), boosters (+1 slot, lift, fill), win / Out of space, events,
saves, the solver and the generator. A game provides:

- a **supply** object (runtime: `attach, setSpeed, step, canFeed, idle, take, count,
  serialize, load`; it hands units to slots with `sim.claim(colour, n, landAt)`), and an
  **abstract model** for the solver (`init, clone, closure, key, distance`).
  See `games/beadloom/ring.js` (ring + feeders) for the reference implementation.
- **config**: capacity, slot count, completion delay, dispenser behaviour (`dispZone`,
  `dispVanish`), speeds, and difficulty **knobs** per level number.
- its own renderer, theme and sounds.

Beadloom wires these up in `games/beadloom/rules.js`; Purl in `games/purl/rules.js`
with a column-stack supply (`columns.js`: 3-5 columns unravelling bottom-up, whole-block threads,
3 blocks per bobbin, scissors via the engine's fill, balloon hooks), 7 slots, persistent facing
dispensers, hidden board tiles and its own board outlines with voids (`knitMask`). Optional engine
hooks it uses: `cfg.claimDelay`, `knobs.maxPerColour`, `game.mask`. Dotwork is a different kind
of game and only shares `core/`.

### Dotwork

`games/dotwork/`: `board.js` (the ray-cast tap rule, stars, eraser, save/restore and the greedy
peel solver: a level is winnable iff peeling free arrows empties it), `generator.js` (snake partition
of a rectangle or picture mask, oriented by forward peeling so every level is winnable by
construction; knobs per level, hard every 5th), `level208.js` (the recorded level), `render.js` (the
pan/zoom camera and all animations), `game.js` (HUD, four boosters, end screens, input: tap on
release, drag pans, pinch / wheel zoom, double-tap on empty space toggles fit and 2x).

### Yacht

`games/yacht/`: `rules.js` (scoring, legal boxes under the forced or free Joker, bonuses, Triple card),
`bot.js` (exact one-turn hold search over 252 rolls x 462 holds; Hard / Medium differ in the end-of-turn
value, Easy is a rule of thumb), `game.js` (setup, play, pass card, game over, high scores, save/resume),
`sounds.js`. Seats, the pass card, the die view and bot pacing are in `core/` for Ludo to reuse.
Spec and bot averages: `docs/yacht-spec.md`.

### Ludo

`games/ludo/`: `rules.js` (pure functions over a JSON-safe state: relative token positions, legal moves,
captures, safe squares, blockades, exact finish, extra rolls, three 6s, standings), `bot.js` (Easy random,
Medium priorities with a random move 1 in 4, Hard scores captures, progress and the drop in risk to its
tokens), `board.js` (15x15 geometry laid out for red and rotated per corner, the SVG board, token layout
with stacks fanned out), `game.js` (setup, play, pass card, game over, save/resume), `sounds.js`.
Two players sit opposite (red and yellow). Spec and bot win rates: `docs/ludo-spec.md`.

## Install on the phone

Updates arrive one launch late (stale-while-revalidate); bump
`VERSION` in `sw.js` to force a full re-cache.

Saves live in the browser's localStorage. Use Settings → Export to keep a copy.
