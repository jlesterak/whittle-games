# Whittle work plan

Agents: read CLAUDE.md first. Work items in order; an item is ready when everything in `depends` is
`[COMPLETED]` in TODO.md. Items tagged `[HUMAN]` need the owner (play-tests on the phone, recordings,
decisions, publishing): prepare everything they need, then skip them.

Goals, in this order:

1. **Robots can work unattended and safely:** CI, a headless check that looks at every game, and a public doc per
   game, so a cloud session knows the rules without the private reference specs.
2. **Perfect what exists:** nothing clips, nothing crashes, saves never break, updates arrive whole, frames stay smooth.
3. **Expand:** progress on the shelf, daily puzzles, and new games that reuse `core/` (Farkle, Backgammon, Klondike).
4. **Ship:** a hosted build the phone can install from, once the owner decides to publish.

Target repo layout (create as items need it):

```
.github/workflows/ci.yml   tests (incl. every module links), precache check, headless smoke
core/ engines/ games/      the app (layout unchanged)
docs/ARCHITECTURE.md       shell, engine and game module interface (moved out of README)
docs/games/<id>.md         public doc per game, in our own words: rules, levels, controls, saves, test helpers
docs/DECISIONS.md          owner decisions: open ones with a recommendation, settled ones with the answer
docs/CREDITS.md            third-party sources and their licenses
docs/PERF.md               measured frame rates and how they were measured
tools/cdp.mjs              minimal Chrome DevTools-protocol client (Node built-in WebSocket, no npm packages)
tools/smoke.mjs            headless run of every game: errors, layout checks, screenshots
tools/precache.mjs         (exists) service-worker file list
```

---

## Phase 0: Robot workflow

### R1. Agent docs and plan
- **Why:** unattended sessions need the rules, the plan and the status in the repo, as in Skyband.
- **Do:** `CLAUDE.md` (+ `AGENTS.md` symlink), this `PLAN.md`, `TODO.md` keyed by item ID with the old history
  kept and an owner Inbox, README cut down to what / why / run with the developer sections moved to
  `docs/ARCHITECTURE.md`, `docs/CREDITS.md`, `docs/DECISIONS.md`.
- **Acceptance:** every relative link in README.md, CLAUDE.md, PLAN.md, TODO.md and docs/*.md points at a
  tracked file; every PLAN.md item ID is in TODO.md; `node --test` passes.
- **Verify:** `node --test` ; check links with a one-liner over `git ls-files`.
- **Depends:** none

### R2. CI
- **Do:** `.github/workflows/ci.yml` on pushes to master and on pull requests: Node 22; `node --test`;
  `node tools/precache.mjs --check`. A test imports every app module in Node, so a syntax error or a broken import
  in a file with no unit tests (most `game.js` and `render.js`) fails CI too. Later items add the smoke run.
- **Acceptance:** the workflow is green on the PR; each step fails when its check fails (try locally: stale
  precache list, a renamed export).
- **Verify:** run the same commands locally.
- **Depends:** R1

### R3. Headless smoke check
- **Why:** the games are canvas plus DOM overlays. Unit tests don't see a thrown error in a render loop, a blank
  canvas or a button pushed off-screen. Robots need eyes, and the owner can't send screenshots every time.
- **Do:**
  - `tools/cdp.mjs`: launch Chromium headless (`--remote-debugging-port=0`, temp profile), read the DevTools URL
    from stderr, a small `send()` / `on()` client over Node's built-in `WebSocket`. Browser from `$CHROME`, then
    common paths (`/opt/pw-browsers/chromium-*/chrome-linux/chrome`, `google-chrome`, `chromium`).
  - `tools/smoke.mjs`: serve the repo with `node:http` on a free port; for the shelf and every game in
    `games/index.js`, at 360x740 and 412x915 (touch, DPR 3) and 1440x900: open `?autoplay=1#/<id>` (Yacht and
    Ludo: tap Start), wait, then fail on uncaught exceptions, unhandled rejections, console errors and failed
    requests; fail if a visible control is partly outside the viewport (wholly outside counts as parked, like a
    slid-out banner) or a canvas is one flat colour soon after load. Save PNGs to `.work/shots/` (gitignored).
    Flags: `--game`, `--viewport WxH`, `--params`, `--wait`, `--out`, `--jobs`, `--hires`.
  - Fix what it finds. Known: Chrome logs an error for `navigator.vibrate` before the first tap (autoplay buzzes),
    so `core/haptics.js` should skip vibration until `navigator.userActivation.hasBeenActive`.
  - Add the smoke run to CI (GitHub's Ubuntu runners have Chrome).
- **Acceptance:** passes on the branch with zero errors for all games and viewports, in under 2 minutes; exits
  non-zero when a game throws (check with a temporary `throw` in one game's mount, not committed); green in CI.
- **Verify:** `node tools/smoke.mjs` ; `node tools/smoke.mjs --game dotwork --viewport 360x740`
- **Depends:** R2

### R4. Public game docs
- **Why:** the reference specs for Beadloom, Purl, Dotwork and Yacht are private (gitignored), so cloud sessions
  can't read them, and the code comments point at files that aren't there.
- **Do:** `docs/games/{beadloom,purl,dotwork,yacht,ludo}.md`, written from the code and the tests, in our own
  words: what the player does, rules, win and lose, boosters and coins, difficulty knobs by level, settings,
  save shape and versioning, test URL helpers, known gaps. Move `docs/ludo-spec.md` to `docs/games/ludo.md`.
  Yacht's classic rules cite a public source. Point code comments at the new docs, including the `spec C.3`-style
  section references in Beadloom, Purl and Dotwork. Trim the per-game sections in ARCHITECTURE.md to a link each.
- **Acceptance:** each doc covers the list above; numbers in it (slots, capacities, prices, knob ranges) match
  the code (the reviewer spot-checks ten); no commercial game names; no tracked file refers to a gitignored spec.
- **Verify:** `git grep -n -E "(beadloom|purl|dotwork|yacht|ludo)-spec" -- ':!.gitignore' ':!PLAN.md'` prints nothing ;
  `node --test`
- **Depends:** R1

---

## Phase 1: Perfect what exists

### P1. Public-ready pass
- **Do:** remove the owner's first name from tracked files (README, manifest description, TODO quotes, code
  comments, docs): write "the owner". Grep for tokens, keys, private hostnames and home locations. List anything
  third-party-looking (level data reconstructed from recordings: `games/dotwork/level208.js`, the
  `tests/fixtures/level*.js` boards) in docs/DECISIONS.md D2 for the owner. Git history keeps the old text: do
  not rewrite it.
- **Acceptance:** a case-insensitive `git grep` for the owner's first name prints nothing; the manifest
  description is generic; D2 lists every reconstructed level with its path.
- **Verify:** `node --test`
- **Depends:** R1

### P2. Whole updates, never mixed versions
- **Why:** `sw.js` answers from the cache and refreshes files one at a time in the background; the cache name only
  changes when someone bumps `VERSION` by hand. After an update one launch can run new `core/` files with old game
  files (modules load at different times), which can break a game until the next launch.
- **Do:** `tools/precache.mjs` also writes `VERSION` as a short hash of the contents of every precached file, so
  any change to any app file changes `sw.js`; the browser then installs the new worker, which fetches everything
  into a fresh cache before it takes over. Serve from the current cache only (no per-file background refresh).
  When a new worker is waiting, the shelf shows "Update ready" with a Reload button (never in the middle of a
  game). The first visit still works fully offline afterwards.
- **Acceptance:** the precache test also checks `VERSION`; a scripted headless run (smoke `--sw`): load, go
  offline, reload works; edit a file and regenerate, reload: the shelf offers the update; take it: new content,
  old cache deleted, no mixed files.
- **Verify:** `node --test` ; `node tools/smoke.mjs --sw`
- **Depends:** R3

### P3. Save safety
- **Why:** a crash on a malformed or old save is the worst bug a phone game can have: the player can't fix it.
- **Do:**
  - smoke `--saves`: for each game, seed localStorage with bad blobs (`null`, `{}`, wrong types, a missing
    nested field, an old-version save) and check the game opens and is playable with no errors.
  - Fix what it finds. If `mount()` still throws, the shell shows "This game's save could not be loaded" with
    Export save and Start fresh; Start fresh keeps the old blob under `<id>.broken` in the save file.
  - `core/save.js`: a failed write (storage full, private mode) shows one toast instead of only a console warning.
  - Unit tests for `importSave` (rejects non-Whittle files, keeps settings and games) with a fake file object.
- **Acceptance:** smoke `--saves` passes for every game and every bad blob; tests for import and the broken-save
  fallback pass.
- **Verify:** `node --test` ; `node tools/smoke.mjs --saves`
- **Depends:** R3

### P4. Beadloom 6-column boards: check the old TODO item
- **Why:** TODO says 6-wide boards need a per-level column layout in render.js, but `rules.js` knobs already make
  6-column boards (allowed from level 22 when difficulty is high; in practice levels 48, 51-53 and 57-60) and
  `render.js` has a 6-column pitch. The item may be stale.
- **Do:** find levels with `cols: 6` (`generateLevel(n).board.cols`), run them headless at phone sizes, and either
  close the TODO item with screenshots in the commit body or fix what is wrong (crates, dispensers, side zones).
- **Acceptance:** at least three 6-column levels render with every crate inside the board area at 360x740 and
  412x915, and autoplay wins them.
- **Verify:** `node tools/smoke.mjs --game beadloom --params "level=<n>"` for each
- **Depends:** R3

### P5. Beadloom track as one filled outline
- **Why:** the feeder tubes and the ring are drawn as separate stroked centrelines, so where a straight tube wall
  meets the curved ring wall there is a small V-notch. The note predates the 2026-10-13 layout rewrite (fe36e3e),
  which removed `feederExt`; the track is still drawn as separate strokes, so first check whether the notch is
  still visible. If it is not, close the item with close-up shots.
- **Do:** draw the whole track (ring and both feeders) as one unioned filled outline: offset each centreline by
  ±(CHANNEL/2 + WALL) for the wall band and ±CHANNEL/2 for the dark channel (`resample()` already carries unit
  normals), fill each as one `Path2D` (nonzero winding unions the overlaps), beads on top.
- **Acceptance:** close-up screenshots of both junctions on levels 1, 5, 11, 40 and 55 show no notch (before and
  after crops in the commit body); smoke passes; frame time not worse (P7 numbers if available).
- **Verify:** `node tools/smoke.mjs --game beadloom` plus close-up captures
- **Depends:** R3

### P6. Layout sweep
- **Why:** the owner reported Beadloom is "still a little cut off in spots" on the phone (2026-10-09), with no
  screenshot. Find it without one. (The 2026-10-08 fix covered Purl's frame and Beadloom's feeder arms.)
- **Do:** smoke `--sweep`: Beadloom, Purl and Dotwork at levels 1, 2, 5, 10, 11, 20, 22, 25, 30, 40, 50, 55, 60
  (and Dotwork 80, 208) at 360x740, 384x693, 384x780 (a tall phone with browser bars), 412x915 and 915x412.
  Each renderer reports the design-space bounds of what it drew (track, board, slots, frames, arms); fail when
  they leave the visible stage, or when any HUD element leaves the viewport or overlaps another. Fix all hits.
  Write a contact sheet page (`.work/shots/index.html`) for eyeballing.
- **Acceptance:** zero hits in the sweep; the robot has looked at every shot at 360x740 and 384x780.
- **Verify:** `node tools/smoke.mjs --sweep`
- **Depends:** R3, P4, P5

### P6h. [HUMAN] Check clipping on the phone
- Owner opens Beadloom, Purl and Dotwork on the phone after P6. Anything still cut off: a screenshot or a note
  (game, level, which edge) in TODO.md Inbox.
- **Depends:** P6

### P7. Frame-rate budget
- **Do:** smoke `--perf`: CPU throttled 4x via CDP, autoplay on the heaviest levels (Beadloom 55-60, Purl 60,
  Dotwork 80 and 208); record frame intervals with `requestAnimationFrame` for 10 s; report median and 95th
  percentile fps. Write `docs/PERF.md` (method, machine, table). Fix anything under 50 fps median.
- **Acceptance:** PERF.md has the table and the method; every game is at or above 50 fps median at 4x throttle,
  or has its own fix item in PLAN.md with the measured number.
- **Verify:** `node tools/smoke.mjs --perf`
- **Depends:** R3

### P8. Accessibility and input basics
- **Do:** every icon-only button has an `aria-label` (smoke check); modals take focus, Escape closes non-sticky
  ones; desktop keyboard: Tab reaches every control, Enter / Space activate them; the Android back gesture
  (history back) from a game returns to the shelf with the game saved, and reopening resumes it.
- **Acceptance:** smoke a11y check passes for all games; back-and-reopen resumes the same state in every game
  (smoke compares the debug state before and after).
- **Verify:** `node tools/smoke.mjs --a11y`
- **Depends:** R3

### P9. [HUMAN] Play-test on the phone
- Feel after P5-P6: sound mix, haptics strength, super-slow speed, the difficulty curve, Ludo powerups (do
  freeze and back-to-start feel too harsh?). Notes go in TODO.md Inbox.
- **Depends:** P5, P6

### P10. [HUMAN] Beadloom recordings
- Record a fill-booster use and a lift on a locked crate (still unrecorded; two open questions in the private
  Beadloom notes). Agents: implement from the notes.
- **Depends:** none

---

## Phase 2: Expand

### E1. Progress on the shelf
- **Do:** an optional `summary(blob)` in each `games/index.js` entry (pure, no game module load) returning a short
  label: "Level 23", "Best 287", "Game in progress". The shelf card shows it as a small pill. Broken or missing
  blobs give no label, never an error.
- **Acceptance:** unit tests for each summary on a fresh, a mid-game and a malformed blob; smoke shelf screenshot.
- **Verify:** `node --test` ; `node tools/smoke.mjs --game shelf`
- **Depends:** R3

### E2. Daily puzzle
- **Do:** one daily level per puzzle game, Dotwork first, then Beadloom and Purl. Seed from the local date
  (`YYYY-MM-DD`) with a fixed mid difficulty; kept apart from campaign progress; a streak and the last 30 days
  in the save. Generated on the device, so it works offline and every phone gets the same puzzle that day.
- **Acceptance:** a fixed date gives the same level every time (test hashes it); the level is winnable (solver);
  playing the daily level never changes campaign progress (test); smoke passes with `?daily=YYYY-MM-DD`.
- **Verify:** `node --test` ; `node tools/smoke.mjs --game dotwork --params "daily=2026-01-01"`
- **Depends:** R3, R4

### E3. Farkle
- **Why:** a quick dice game for 1-4 seats; proves a new game can be mostly `core/` (dice view, seats, pass card,
  bot pacing).
- **Do:** spec first, `docs/games/farkle.md`: classic rules with a cited source, the scoring table, house toggles
  (target score, three pairs, four of a kind, hot dice, entry minimum), seats and bot levels. Then `rules.js` +
  tests, `bot.js` + tests (Hard: bank or roll by expected value, computed, not guessed), `game.js` + `sounds.js`,
  shelf entry, precache, smoke.
- **Acceptance:** every scoring combination and toggle tested; bots only make legal choices under every rule mix;
  Hard beats Easy in at least 70% of 1000 seeded games (record the number); smoke passes.
- **Verify:** `node --test` ; `node tools/smoke.mjs --game farkle`
- **Depends:** R3, R4

### E4. Backgammon
- **Do:** spec first, `docs/games/backgammon.md` (standard rules with a source: bar entry, using both dice when
  possible and the larger die otherwise, bearing off; gammons and the doubling cube as house toggles). `rules.js`
  move generation including doubles and the forced-move rules + tests; `bot.js` Easy random, Medium pip-count
  heuristic, Hard one-ply search over a hand-written evaluation (blots, primes, pips; no copied weights);
  `game.js` with an SVG board in the style of Ludo, tap-tap and drag moves, undo within a turn, pass-and-play,
  save and resume.
- **Acceptance:** move generator matches hand-worked positions (doubles, bar entry, bear-off edge cases, larger-die
  rule); bots legal under every toggle; Hard beats Easy in at least 80% of 500 seeded games (record it); smoke passes.
- **Verify:** `node --test` ; `node tools/smoke.mjs --game backgammon`
- **Depends:** E3

### E5. Cards core and Klondike
- **Do:** `core/cards.js` (deck, seeded shuffle, card faces drawn in code, an optional four-colour deck for
  colourblind mode); `games/klondike/`: draw 1 or 3, pass limit toggle, tap a card to send it to its best legal
  place, drag, unlimited undo, auto-finish, a solver for a "winnable deals only" option. Spec first.
- **Acceptance:** rules tests; the solver agrees with hand-checked deals; seeded winnable deals verified by the
  solver; smoke passes.
- **Verify:** `node --test` ; `node tools/smoke.mjs --game klondike`
- **Depends:** E3

### Ideas (not items yet)
- Another slot-sort game with an original theme (design doc for the owner first), Mancala, Dominoes,
  Hearts with bots on `core/cards.js`, stats per game. Agents may propose more in DECISIONS.md; an idea becomes an
  item with an ID once the owner agrees.

---

## Phase 3: Ship

### X1. Hosting files
- **Do:** a GitHub Pages workflow that publishes the repo root as-is from master after CI passes, gated so it does
  nothing until the owner enables Pages (D3). `docs/INSTALL.md`: install from Chrome or Firefox on Android and
  Safari on iOS, how updates arrive (P2), export the save before changing phones.
- **Acceptance:** the workflow is valid and skipped while Pages is off; INSTALL.md steps match the app.
- **Verify:** the workflow run on the PR shows the deploy job skipped; follow INSTALL.md against a local server
  in a phone-sized headless browser (manifest and service worker load, `beforeinstallprompt` fires).
- **Depends:** P2

### X1h. [HUMAN] Publish
- Owner decides D3 and enables Pages. Agents: check the live site with smoke against its URL afterwards.
- **Depends:** X1

---

## Decisions (details and recommendations in docs/DECISIONS.md)

- **D1. [HUMAN]** License for the repo (it is public and has none yet).
- **D2. [HUMAN]** Level data reconstructed from recordings of commercial games: keep, or swap for generated boards.
- **D3. [HUMAN]** Host a public build on GitHub Pages?
- **D4.** Order of new games. Not blocking (no TODO entry): agents follow the order above unless the owner
  changes it in DECISIONS.md.
