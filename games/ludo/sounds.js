// Ludo sound effects (core/audio.js synth, no sample files) plus haptics. Gentle by design: soft
// wooden hops, a pop out of the yard, a bonk for a capture, a chime for home.
import { diceSounds } from '../../core/dice-sounds.js';

export function makeSounds(audio, haptics) {
  return {
    ...diceSounds(audio, haptics),
    hop(i) {
      audio.noise({ dur: 0.035, freq: 1400 + i * 60, q: 4, vol: 0.13 });
      audio.tone({ f: 520 + i * 25, type: 'sine', dur: 0.04, vol: 0.035 });
    },
    exit() {
      audio.tone({ f: 380, f2: 760, type: 'triangle', dur: 0.14, vol: 0.09 });
      haptics.buzz(12);
    },
    capture() {
      audio.noise({ dur: 0.09, freq: 500, f2: 200, type: 'lowpass', vol: 0.3 });
      audio.tone({ f: 660, f2: 180, type: 'triangle', dur: 0.4, vol: 0.09, delay: 0.05 });
      haptics.buzz([25, 40, 25]);
    },
    home() {
      [784, 988, 1175, 1568].forEach((f, i) => audio.tone({ f, type: 'sine', dur: i === 3 ? 0.35 : 0.12, vol: 0.08, delay: i * 0.07 }));
      haptics.buzz([15, 30, 15]);
    },
    power(good, kind) {
      if (kind === 'freeze') [1568, 1319, 1175, 988].forEach((f, i) => audio.tone({ f, type: 'sine', dur: 0.1, vol: 0.06, delay: i * 0.06 }));
      else if (good) [523, 659, 784, 1047].forEach((f, i) => audio.tone({ f, type: 'triangle', dur: 0.1, vol: 0.08, delay: i * 0.055 }));
      else audio.tone({ f: 520, f2: 140, type: 'sawtooth', dur: 0.4, vol: 0.06 });
      haptics.buzz(good ? 14 : [30, 30]);
    },
    none() {
      audio.tone({ f: 240, f2: 200, type: 'triangle', dur: 0.18, vol: 0.07 });
    },
    forfeit() {
      [440, 370, 294].forEach((f, i) => audio.tone({ f, type: 'triangle', dur: 0.16, vol: 0.08, delay: i * 0.12 }));
      haptics.buzz([20, 40, 20]);
    },
    tap() {
      audio.tone({ f: 740, type: 'sine', dur: 0.04, vol: 0.05 });
      haptics.buzz(8);
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
