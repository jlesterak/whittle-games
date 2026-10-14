# Whittle

An offline game shelf for the phone: a PWA in vanilla JS (ES modules) and Canvas 2D, with no framework, no build
step and no runtime dependencies. After the first load it runs with zero network. No ads, no accounts, no tracking.

**Status:** five games playable and play-tested on an Android phone. Work continues from [PLAN.md](PLAN.md);
status is in [TODO.md](TODO.md).

## Games

- **Beadloom:** pour a ring of beads into the right crates before the slots clog.
- **Purl:** unravel a knitted picture onto the right bobbins before the slots clog.
- **Dotwork:** tap each arrow out of a dense maze, but only when its way to the edge is clear.
- **Yacht:** five dice, three rolls, thirteen boxes. House-rule toggles, 1-4 seats of humans and bots,
  pass-and-play, solo high scores.
- **Ludo:** race four tokens home. House-rule toggles including a Powerups board, 2-4 seats of humans and bots,
  pass-and-play.

Beadloom and Purl share a slot-sort engine; every game shares `core/` (stage fit, saves, sound, seats, dice).

## Run it

```sh
python3 -m http.server 8000   # from the repo root
# open http://localhost:8000/
```

Tests (Node 20+): `node --test` (a few seconds).

To install on a phone, open the page in the phone's browser and add it to the home screen. Saves live in the
browser's localStorage; use Settings -> Export to keep a copy.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layout, the game module interface, adding a game, testing helpers.
- [docs/ludo-spec.md](docs/ludo-spec.md): Ludo rules, house rules and bots.
- [docs/DECISIONS.md](docs/DECISIONS.md): open questions for the owner.
- [docs/CREDITS.md](docs/CREDITS.md): third-party sources.
- [CLAUDE.md](CLAUDE.md): how AI agents work on this repo.
