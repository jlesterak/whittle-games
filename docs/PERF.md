# Frame rate

How fast the heaviest levels draw, how that was measured, and what the numbers do and don't say.

## Method

`node tools/smoke.mjs --perf` (item P7):

- Headless Chromium over the DevTools protocol, one page at a time so pages don't compete for the CPU.
- Page 412x915, touch, device pixel ratio 3 (a common phone). `PERF_DPR=1` overrides the ratio.
- CPU slowed 4x with `Emulation.setCPUThrottlingRate` (`PERF_THROTTLE` overrides it).
- `?autoplay=1&level=N`; wait 4 s (mount, splash, first moves), then record `requestAnimationFrame` times for 10 s.
- Reported: median fps (1000 / the median frame interval), "95th pct fps" (1000 / the 95th percentile interval, so
  the slow end), the worst frame, and the game's own script time per frame (its rAF callbacks: update plus the canvas
  calls it issues). Wrapping rAF to time the callbacks doesn't change the fps (checked against an unwrapped loop).
- `--perf` exits 1 while any level is under 50 fps, so it is not in CI.
- Levels: Beadloom 55 and 60, Purl 60, Dotwork 80 and 208 (the heaviest of each game).

Machine: Claude cloud sandbox, Intel Xeon 2.8 GHz (4 cores), 15 GB RAM, Chromium 141.0.7390.37 headless, **no GPU**
(canvas is rasterised in software on the page's main thread). Measured 2026-10-18.

## Results

Medians snap to vsync steps (60, 30, 20, 15 fps), so a level near a step can read one step apart between runs. A
second run on the same machine matched every DPR 3 median below, but at DPR 1 read Beadloom 55 at 20.0 and Dotwork 80
and 208 at 59.9. Dotwork caps its canvas at 2x (`Math.min(devicePixelRatio, 2)`), so its DPR 3 rows are really DPR 2.

DPR 3, CPU slowed 4x (the `--perf` default):

| Game | Level | Median fps | 95th pct fps | Worst frame ms | Script ms (median / 95th) |
|---|---|---|---|---|---|
| Beadloom | 55 | 7.5 | 5.5 | 200 | 11.2 / 21.2 |
| Beadloom | 60 | 7.5 | 5.5 | 267 | 11.5 / 19.2 |
| Purl | 60 | 15.0 | 15.0 | 117 | 3.4 / 6.0 |
| Dotwork | 80 | 20.0 | 20.0 | 67 | 28.0 / 33.3 |
| Dotwork | 208 | 20.0 | 15.0 | 83 | 32.5 / 45.2 |

DPR 1, CPU slowed 4x (`PERF_DPR=1`):

| Game | Level | Median fps | 95th pct fps | Script ms (median / 95th) |
|---|---|---|---|---|
| Beadloom | 55 | 29.9 | 20.0 | 9.7 / 13.3 |
| Beadloom | 60 | 20.0 | 15.0 | 10.8 / 16.8 |
| Purl | 60 | 59.9 | 30.0 | 3.4 / 6.8 |
| Dotwork | 80 | 30.0 | 20.0 | 17.7 / 31.2 |
| Dotwork | 208 | 30.0 | 29.9 | 18.4 / 28.6 |

DPR 3, no throttling (`PERF_THROTTLE=1`): Beadloom 55 59.5, Beadloom 60 30.0, Purl 60 59.9, Dotwork 80 59.9,
Dotwork 208 59.9 median fps.

## What the numbers say

Every game is under the 50 fps budget at 4x here. Most of the cost is software rasterisation, which a phone does on
its GPU:

- Frame rate falls with pixel count: Purl 60 is at the vsync cap at DPR 1, 30 fps at DPR 2 and 15 fps at DPR 3, with
  the same 3.4 ms of script.
- CPU profiles (CDP `Profiler`, 200 us sampling, 5 s after a 4 s settle, 4x, DPR 1 for Beadloom and DPR 3 for
  Dotwork) put Beadloom 60 at 73 % native "(program)" time and 18 % `drawImage` (about 1,500 bead sprites a frame;
  a 10 s run at DPR 3 gave 91 % and 6 %), and Dotwork 208 at 53 % `drawImage` (51 % in a second run): the copy of
  its cached board layer onto the screen canvas each frame. JavaScript itself is a few per cent.
- "Script ms" includes that `drawImage` work, because software canvas copies inside the call. On a GPU canvas the
  call only records a command.
- Turning on SwiftShader (a CPU-emulated GPU) made it worse (Beadloom 60: 2.4 fps), so the sandbox can't stand in
  for a phone's GPU.

So these numbers are a pessimistic bound, not a phone measurement. They do rank the games: Beadloom is the heaviest
(it is also the only one under 50 fps without throttling, at DPR 3), then Dotwork, then Purl. Fix item P7b in
PLAN.md tracks them.

## On the phone

Add `?fps` to any URL (for example `?fps&autoplay=1&level=60#/beadloom`) for a small overlay at the middle of the
left edge: median fps over the last 2 s and the slow end ("slow 5%": 1000 / the 95th percentile frame interval).
It uses the same `frameStats` as `--perf` (`core/fps.js`), so the numbers compare directly.

Owner's phone, 2026-10-20, read off the overlay by the owner (P7bh):

| Page | Median fps | Slow 5% fps |
|---|---|---|
| `?fps&autoplay=1&level=60#/beadloom` | 60 | 60 |
| `?fps&autoplay=1#/purl` | 60 | 60 |
| `?fps&autoplay=1&level=208#/dotwork` | 60 | 60 |

All three hold 60 fps (the display's refresh rate) even at the slow end, well over the 50 fps budget. So the
sandbox's low numbers were software rasterisation, as expected, and the P7b fixes (Beadloom row sprites, a stacked
static canvas) are not needed. They stay written down in PLAN.md P7b in case a slower phone shows a drop.
