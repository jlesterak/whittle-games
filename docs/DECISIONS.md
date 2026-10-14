# Decisions

Open questions for the owner, each with a recommendation. When the owner answers, write the answer and the date
under the question and mark it **Settled**. Items marked [HUMAN] in PLAN.md wait for the answer; the rest go
ahead with the recommendation unless the owner says otherwise.

## D1. [HUMAN] License (open)

The repo is public and has no LICENSE file, so by default nobody may reuse it. Options:

- **GPLv3** (as Skyband): anyone may use and change it, but copies and changed versions must stay open source
  under the same license.
- **MIT**: anyone may do anything, including closed-source copies, as long as the notice stays.
- **No license**: all rights reserved; the code is visible but not reusable.

Recommendation: **GPLv3**, to match Skyband and keep clones of the games open. Agents add the LICENSE file and a
README line once the owner picks.

## D2. [HUMAN] Level data reconstructed from recordings (open)

Some boards were rebuilt by hand from screen recordings of commercial games, as test fixtures and one playable
level. Methods of play are not protected by copyright (see docs/CREDITS.md), but a specific level layout might
be, and the repo is public. The files (P1, 2026-10-14):

- `games/dotwork/level208.js`: a Dotwork board rebuilt cell by cell from a recording. It is playable as level 208
  and is the fixture in `tests/dotwork-board.test.js` and `tests/dotwork-generator.test.js`.
- `tests/fixtures/level2796.js`: a Beadloom board, its special tiles and a logged pick order from a recording
  (`tests/beadloom-solver.test.js`). The level number 2796 also appears in the solver test's list of generated
  levels, which is only a number.
- `tests/fixtures/level254.js`: a Purl board, its dispensers and a logged pick order from a recording
  (`tests/purl-solver.test.js`).

Not level data, but also taken from recordings: the colour values in `games/beadloom/colors.js` and
`games/purl/colors.js` (their comments say sampled), probably Dotwork's palette in `games/dotwork/colors.js`
(unverified), and timings such as belt and thread speeds. These are measurements, not copied assets. The art is
drawn in code and the names are ours. The level generators are our own code, but some of their targets were tuned
to match recorded levels: board outlines (`engines/slotsort/generator.js`, `games/purl/rules.js`), the tall O ring
(`games/beadloom/track.js`), Dotwork's difficulty numbers and a colour pair (`games/dotwork/generator.js`) and
Beadloom's special-tile mix (`games/beadloom/rules.js`). The private specs and reference stills were never committed (checked with `git log --all` on 2026-10-14).

Recommendation: keep them as test fixtures only if the owner is comfortable; otherwise replace each with a
generated board of the same size and difficulty (the tests only need its shape and stats), and replace Dotwork's
playable level 208 with a generated level. Agents can prepare the swap on a branch.

## D3. [HUMAN] Public hosting (open)

GitHub Pages could serve the app at a public URL, so the phone installs it from there and gets updates on its own.
Nothing is published until the owner enables Pages in the repo settings. Recommendation: yes, after P2 (whole
updates), so a half-updated app can't reach the phone.

## D4. Order of new games (agents proceed)

Default order: **Farkle** (small, reuses the dice and seats code), **Backgammon** (bigger, dice plus a board and a
bot), **Klondike** (adds a cards core that later card games reuse). Then the ideas list at the end of PLAN.md Phase 2. The owner can
reorder or veto here.
