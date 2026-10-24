# Whittle TODO

Item IDs refer to PLAN.md. Agents: update this file in the same commit as the work (see CLAUDE.md).

## Inbox
Owner notes from play-tests (date, game, what). Agents turn each one into a fix or a plan item, then delete it here.

## [IN PROGRESS]

## [PENDING]
- P6h [HUMAN] Check clipping on the phone
- P7b [BLOCKED: needs P7bh phone numbers] ?fps overlay done (core/fps.js, shared with --perf); fixes wait for the phone
- P7bh [HUMAN] Read the frame rate on the phone: open `?fps&autoplay=1&level=60#/beadloom`, `#/purl` and
  `?fps&autoplay=1&level=208#/dotwork`, write median / slow-5% numbers in the Inbox
- P9 [HUMAN] Play-test on the phone (sound mix, haptics, super-slow speed, difficulty curve, Ludo powerups)
- P10 [HUMAN] Beadloom recordings: a fill-booster use and a lift on a locked crate
- E3 Farkle
- E4 Backgammon
- E5 Cards core and Klondike
- X1 Install guide and a live-site check

## [COMPLETED]
- 2026-10-19: E2 daily puzzle (Dotwork, Beadloom, Purl): date-seeded mid-difficulty level, own save slot, streak and
  30 days (core/daily.js); campaign progress untouched in real play (lose, restart, switch, back, mid-win). Five fresh
  verifiers; four found real ways to lose progress, all fixed (clearInProgress, save-before-switch, win guard)
- 2026-10-18: E1 shelf progress: summary(blob) per game in games/index.js (Level N, Game in progress, Best N /
  Best N (Triple)), pill on the card; malformed saves give no label. Fresh verifier PASS (real play driven headless)
- 2026-10-18: P8 accessibility: smoke --a11y (labels, Tab reach after a roll, Enter/Space on Settings and custom
  buttons, back-then-reopen resumes all 5 games); modals take focus, trap Tab, close on Escape; focus ring; Yacht
  score boxes by keyboard; Beadloom crate hit ±80 x ±82 (44+ CSS px on the portrait sizes). Canvas boards stay
  tap-only. Second fresh verifier PASS
- 2026-10-18: P7 frame-rate budget: smoke --perf (4x throttle, DPR 3, 10 s autoplay, rAF intervals + script ms),
  docs/PERF.md. All five heavy levels are under 50 fps here (7.5-20 fps), mostly software raster with no GPU, so
  fix item P7b (phone fps overlay, then targeted fixes) holds the numbers. Fresh verifier PASS
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

## History
The pre-PLAN.md notes are archived (git history has them); PLAN.md and `docs/DECISIONS.md` carry the decisions.
