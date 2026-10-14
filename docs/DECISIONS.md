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
be, and the repo is public. P1 lists every such file here.

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
