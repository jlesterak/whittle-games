// Farkle sound effects, synthesised with core/audio.js (no sample files), plus haptics.
// The shared dice sounds, a click for picking dice, a coin-like bank, a low thud for a Farkle.

import { diceSounds } from '../../core/dice-sounds.js';

export function makeSounds(audio, haptics) {
  return {
    ...diceSounds(audio, haptics),
    pick(on) {
      audio.tone({ f: on ? 880 : 660, type: 'sine', dur: 0.05, vol: 0.07 });
      haptics.buzz(8);
    },
    keep(points) {
      const base = 440 + Math.min(points, 1000) * 0.5;
      audio.tone({ f: base, type: 'triangle', dur: 0.1, vol: 0.09 });
      audio.tone({ f: base * 1.5, type: 'sine', dur: 0.14, vol: 0.07, delay: 0.06 });
    },
    bank(points) {
      const notes = points >= 1000 ? [784, 988, 1175, 1568] : [784, 1175];
      notes.forEach((f, i) => audio.tone({ f, type: 'sine', dur: 0.14, vol: 0.09, delay: i * 0.07 }));
      haptics.buzz([15, 30, 15]);
    },
    hot() {
      [523, 659, 784, 1047].forEach((f, i) => audio.tone({ f, type: 'triangle', dur: i === 3 ? 0.35 : 0.12, vol: 0.11, delay: i * 0.07 }));
      haptics.buzz([20, 40, 20, 40, 60]);
    },
    farkle() {
      audio.tone({ f: 220, f2: 140, type: 'triangle', dur: 0.35, vol: 0.12 });
      audio.tone({ f: 165, f2: 110, type: 'sine', dur: 0.4, vol: 0.08, delay: 0.12 });
      haptics.buzz([40, 60, 80]);
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
