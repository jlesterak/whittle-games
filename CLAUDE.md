# Instructions for AI agents

You are working on Whittle, an offline game shelf: a phone-first PWA in vanilla JS with no build step
(see README.md, docs/ARCHITECTURE.md). The owner often runs you unattended (from a phone, overnight).
Work through the plan; don't wait for chat replies.

## Start of every session

1. Read `TODO.md` (status) and `PLAN.md` (work items with acceptance criteria and verify commands).
2. `git status` and `git log -n 5` to see where the last session stopped. Check the open PR for review comments.
3. Pick the **first unblocked item** in PLAN.md order whose dependencies are done and that is not marked `[HUMAN]`.
   If it is `[IN PROGRESS]` in TODO.md, resume it. Owner feedback in TODO.md `## Inbox` comes first: turn each
   note into a fix item (or fix it at once if it is small) before picking the next plan item.

## How to work an item

- One item at a time. Move it to `[IN PROGRESS]` in TODO.md when you start and commit that, so a dead session
  leaves a trail.
- Meet every acceptance criterion and run every verify command. Paste a short excerpt of the verify output
  into the commit message body.
- UI work: look at it. Run `node tools/smoke.mjs` (once item R3 exists) and read the screenshots at phone sizes
  before and after the change. List the viewports and levels you checked in the commit body.
- Before marking an item done, have a **fresh subagent** (general-purpose, not a fork) check it: give it only
  the item's acceptance criteria and verify commands, have it run them and try to break the claim, with no edits.
  If it fails, fix and re-check with another fresh subagent.
- Mark the item `[COMPLETED]` in TODO.md **in the same commit** as the work, with a one-line summary.
- If you are blocked (missing tool, network blocked, needs the phone or a decision), mark it `[BLOCKED: reason]`
  in TODO.md, commit, and move on to the next unblocked item.
- Commit early and often: one logical change per commit, conventional prefixes (`feat:`, `fix:`, `docs:`, `test:`,
  `chore:`, `refactor:`). Never commit failing tests.
- Work on your session branch and keep one PR open for the session; the owner reviews and merges. Never force push.

## Engineering rules

- **Simplicity first.** If something simple gets 95% of the way, pick it over the complex option and write down
  the missing 5%. Fewer dependencies, layers and config knobs. No runtime dependencies, no framework, no build
  step: the files in the repo are the app. Dev tools use the Node standard library only (`node:test`; the
  built-in `WebSocket` needs Node 22); adding any npm package needs a note in docs/DECISIONS.md saying why it
  earns its place.
- **Don't reinvent.** Reuse `core/` (stage fit, seats, dice, rng, ui, audio) and `engines/slotsort/`. When a second
  game needs something one game has, move it to `core/` instead of copying it.
- **Offline always.** Every app file is in the service-worker precache. Run `node tools/precache.mjs` after any
  change to an app file: it rewrites the file list and `VERSION` (a hash of the files) in `sw.js`, and the tests
  fail until you do. No network calls, CDNs, web fonts, analytics, ads or accounts.
- **Pure, seeded game logic.** Rules, bots, solvers and generators are DOM-free and take a seed (`core/rng.js`), so
  they can be unit-tested, solved and replayed. Rendering and input stay in `game.js` / `render.js`.
- **Never break a save.** Players keep progress in localStorage. A change to a save's shape needs a migration or a
  graceful restart of the in-progress level (see Beadloom `LEVEL_GEN`), never a crash or a wiped save. Read saves
  through `cleanSave()` / `cleanPlayers()` and add a new game to `node tools/smoke.mjs --saves`.
- **Phone first.** Check layouts at 360x740, 384x693 and 412x915 portrait, plus 915x412 landscape and 1440x900
  desktop. Touch targets at least 44 CSS px. Honour the Reduced motion and Colourblind symbols settings.
- **Tests must earn their place:** rules, bots, solvers, generators, saves and past bugs, not coverage numbers.
- **Never invent facts.** Rules of classic games cite a source (a rulebook or a URL) in the game's doc. Bot win
  rates, frame rates and timings are measured, and the doc says how. If you can't verify something, write
  `(unverified)` next to it.
- **Original work only.** Classic public-domain games (Ludo, Yacht, Backgammon, Klondike) are fine. Never copy art,
  names, sounds, text or level data from commercial games. Anything copied or ported from another project needs its
  license checked (permissive or GPL-compatible: MIT, BSD, Apache-2.0, LGPL, GPL, public domain) and attribution
  in the file header plus `docs/CREDITS.md`. If a license is unclear, don't copy; write it up as blocked.
- **Public-ready repo:** no secrets, tokens, personal names, home locations or private hostnames. The private
  reference material (`docs/ref/` and the `docs/*-spec.md` files listed in `.gitignore`) never gets committed
  and is not available in cloud sessions; work from `docs/games/` and the code. Comments citing `ref <section>`
  point into those private notes; never try to fetch or recreate them.
- Writing: plain, short sentences. Docs explain what and why. UI text uses British spelling, as the app does
  (colour, colourblind).

## Never do these

- Spend money, create accounts, or publish anywhere (app stores, GitHub Pages, itch.io). Prepare files; the owner
  publishes.
- Items marked `[HUMAN]` (play-tests on the phone, recordings, decisions). Prepare everything they need, then stop.
- Wipe, reset or overwrite a player's save without a migration path.
- Add tracking, ads, network calls, or anything that needs an account.
- Change the license or remove attribution.

## Environment notes

- Node 22 (CI uses 22; unit tests also run on 20). Tests: `node --test`. Serve: `python3 -m http.server 8000`
  from the repo root.
- Headless checks: `tools/smoke.mjs` (item R3) drives Chromium over the DevTools protocol with no npm packages.
  It finds the browser via `$CHROME`, then common paths. Claude cloud sandboxes have Chromium under
  `/opt/pw-browsers`; don't run `playwright install`.
- URL helpers for testing: `?level=N`, `?autoplay=1` and `?debug` (see each game's doc in `docs/games/`).
- Cloud sandboxes may block some hosts. If a lookup fails, record it as blocked rather than guessing.
