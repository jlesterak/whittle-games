// Dotwork sound effects, synthesised with core/audio.js (no sample files), plus haptics.
// A soft whoosh per escape, a dull thunk and a falling blip for a bump.

export function makeSounds(audio, haptics) {
  return {
    escape() {
      audio.noise({ dur: 0.22, freq: 700, f2: 3200, q: 1.5, vol: 0.16 });
      audio.tone({ f: 520, f2: 880, type: 'triangle', dur: 0.08, vol: 0.08 });
      haptics.buzz(8);
    },
    bump() {
      audio.noise({ dur: 0.08, freq: 300, f2: 120, type: 'lowpass', vol: 0.4 });
      audio.tone({ f: 330, f2: 180, type: 'square', dur: 0.18, vol: 0.07, delay: 0.03 });
      haptics.buzz([40, 30, 40]);
    },
    starLost() {
      audio.tone({ f: 660, f2: 330, type: 'triangle', dur: 0.3, vol: 0.12 });
    },
    hint() {
      [880, 1175, 1568].forEach((f, i) => audio.tone({ f, type: 'sine', dur: 0.14, vol: 0.1, delay: i * 0.06 }));
      haptics.buzz(15);
    },
    rub() {
      for (let i = 0; i < 5; i++) audio.noise({ dur: 0.1, freq: 2400, f2: 1600, q: 2, vol: 0.12, delay: i * 0.15 });
      haptics.buzz([10, 60, 10, 60, 10]);
    },
    wand() {
      [1047, 1319, 1568, 2093].forEach((f, i) => audio.tone({ f, type: 'triangle', dur: 0.18, vol: 0.08, delay: i * 0.09 }));
      haptics.buzz([15, 30, 15]);
    },
    guide() {
      audio.tone({ f: 440, f2: 1320, type: 'sine', dur: 0.25, vol: 0.1 });
    },
    tap() {
      audio.tone({ f: 700, type: 'sine', dur: 0.04, vol: 0.06 });
    },
    win() {
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
        audio.tone({ f, type: 'triangle', dur: i === 5 ? 0.5 : 0.16, vol: 0.18, delay: i * 0.11 }),
      );
      haptics.buzz([30, 60, 30, 60, 80]);
    },
    lose() {
      [392, 330, 262].forEach((f, i) => audio.tone({ f, f2: f * 0.97, type: 'triangle', dur: 0.25, vol: 0.15, delay: i * 0.18 }));
      haptics.buzz([60, 80, 60]);
    },
  };
}
