// Farkle sound effects, synthesised with core/audio.js (no sample files), plus haptics. The dice sounds are
// shared with Yacht and Ludo (core/dice-sounds.js).

import { diceSounds } from '../../core/dice-sounds.js';

export function makeSounds(audio, haptics) {
  return {
    ...diceSounds(audio, haptics),
    pick(on) {
      audio.tone({ f: on ? 880 : 660, type: 'sine', dur: 0.05, vol: 0.07 });
      haptics.buzz(8);
    },
    bank(points) {
      const base = 440 + Math.min(points, 3000) / 12;
      [1, 1.25, 1.5].forEach((m, i) => audio.tone({ f: base * m, type: 'triangle', dur: 0.12, vol: 0.09, delay: i * 0.06 }));
      haptics.buzz(14);
    },
    farkle() {
      audio.tone({ f: 260, f2: 150, type: 'triangle', dur: 0.35, vol: 0.12 });
      audio.noise({ dur: 0.12, freq: 400, type: 'lowpass', vol: 0.15 });
      haptics.buzz([40, 40, 60]);
    },
    hot() {
      [784, 988, 1175, 1568].forEach((f, i) => audio.tone({ f, type: 'triangle', dur: i === 3 ? 0.3 : 0.1, vol: 0.1, delay: i * 0.06 }));
      haptics.buzz([20, 30, 20]);
    },
    last() {
      [523, 392, 523, 659].forEach((f, i) => audio.tone({ f, type: 'sine', dur: 0.14, vol: 0.09, delay: i * 0.1 }));
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
