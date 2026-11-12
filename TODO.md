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
- E3h [HUMAN] Play-test Farkle on the phone (`#/farkle`): picking dice, Roll / Bank labels, the Farkle and Hot dice
  banners, pass-and-play, a solo run to 5,000, Easy / Medium / Hard feel; notes in the Inbox
- E4 Backgammon
- E5 Cards core and Klondike
- X1 Install guide and a live-site check

## [COMPLETED]
- 2026-11-04: E3 Farkle: docs/games/farkle.md (base table cited, toggles: target, entry minimum, three pairs,
  four of a kind flat/doubling, hot dice), rules.js best-split scoring + tests of every combination and toggle,
  bot.js (Hard from a computed expected-value table; Hard beats Easy 764/1000 seeded games), game.js, sounds.js,
  shelf entry with best-run label, precache, smoke (play, --a11y, --saves) ok. Fresh verifier run
- 2026-10-19: E2 daily puzzle (Dotwork, Beadloom, Purl): date-seeded level, own save slot, streak (core/daily.js)
- 2026-10-18: E1 shelf progress labels per game (games/index.js summary)
- 2026-10-18: P8 accessibility: smoke --a11y, modal focus/Escape, keyboard Yacht boxes; canvas boards stay tap-only
- 2026-10-18: P7 frame-rate budget: smoke --perf, docs/PERF.md; fixes wait on phone numbers (P7b)
- 2026-10-18: P6 layout sweep: smoke --sweep; mid-play tips/banners not covered (P6h)
- 2026-10-14: D2s generated boards replace the three rebuilt from recordings
- 2026-10-14: P5 Beadloom feeder joins rounded, shadow drawn once
- 2026-10-14: owner decisions: D1 the Unlicense (public domain), D2 swap the rebuilt boards (D2s), D3 Pages on (serves master), D5 Yacht's free Joker stays a house rule
- 2026-10-14: P3 save safety (repair, kept copies, smoke --saves)
- 2026-10-14: P4 6-column Beadloom boards (already worked; layout test added)
- 2026-10-14: P2 whole updates (content-hash VERSION, Update ready / Reload; smoke --sw)
- 2026-10-14: R4 public game docs in docs/games/
- 2026-10-14: P1 public-ready pass (no personal names, secrets or private hosts)
- 2026-10-14: R3 headless smoke check (tools/cdp.mjs + tools/smoke.mjs, in CI)
- 2026-10-14: R2 CI: node --test and the precache check on PRs and master
- 2026-10-14: R1 agent docs and plan (CLAUDE.md, PLAN.md, TODO.md by item ID, docs/)

## History
The pre-PLAN.md notes are archived (git history has them); PLAN.md and `docs/DECISIONS.md` carry the decisions.
