// Yacht sound effects, synthesised with core/audio.js (no sample files), plus haptics.
// Gentle by design: soft dice ticks, a chime that rises with the score, a small fanfare.

import { diceSounds } from '../../core/dice-sounds.js';

export function makeSounds(audio, haptics) {
  return {
    ...diceSounds(audio, haptics),
    hold(on) {
      audio.tone({ f: on ? 880 : 660, type: 'sine', dur: 0.05, vol: 0.07 });
      haptics.buzz(8);
    },
    select() {
      audio.tone({ f: 740, type: 'sine', dur: 0.04, vol: 0.05 });
    },
    score(points) {
      if (points <= 0) {
        audio.tone({ f: 220, f2: 180, type: 'triangle', dur: 0.18, vol: 0.09 });
        haptics.buzz(20);
        return;
      }
      const base = 440 + Math.min(points, 50) * 9;
      audio.tone({ f: base, type: 'triangle', dur: 0.12, vol: 0.1 });
      audio.tone({ f: base * 1.5, type: 'sine', dur: 0.18, vol: 0.08, delay: 0.07 });
      haptics.buzz(12);
    },
    yacht() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => audio.tone({ f, type: 'triangle', dur: i === 4 ? 0.45 : 0.14, vol: 0.12, delay: i * 0.08 }));
      haptics.buzz([30, 50, 30, 50, 90]);
    },
    bonus() {
      [1568, 2093, 2637].forEach((f, i) => audio.tone({ f, type: 'sine', dur: 0.16, vol: 0.06, delay: i * 0.06 }));
      haptics.buzz([15, 30, 15]);
    },
    pass() {
      audio.tone({ f: 587, type: 'sine', dur: 0.14, vol: 0.08 });
      audio.tone({ f: 880, type: 'sine', dur: 0.22, vol: 0.08, delay: 0.12 });
    },
    over(win) {
      const notes = win ? [523, 659, 784, 1047, 784, 1047] : [392, 494, 587, 784];
      notes.forEach((f, i) => audio.tone({ f, type: 'triangle', dur: i === notes.length - 1 ? 0.5 : 0.15, vol: 0.12, delay: i * 0.12 }));
      haptics.buzz([30, 60, 30, 60, 80]);
    },
  };
}
