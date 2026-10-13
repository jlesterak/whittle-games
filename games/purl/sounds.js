// Purl sound effects, synthesised with core/audio.js (no sample files), plus haptics.
// Softer and woodier than Beadloom: spool pops, a yarn zip when a thread shoots, soft stitch
// ticks while it unravels (rate-limited by the caller).

export function makeSounds(audio, haptics) {
  return {
    pick() {
      audio.tone({ f: 440, f2: 740, type: 'triangle', dur: 0.1, vol: 0.2 });
      audio.noise({ dur: 0.04, freq: 1800, vol: 0.12 });
      haptics.buzz(12);
    },
    thread() {
      audio.noise({ dur: 0.16, freq: 1200, f2: 4200, q: 2, vol: 0.1 });
    },
    stitch(fill) {
      audio.tone({ f: 900 + fill * 600, type: 'sine', dur: 0.03, vol: 0.04 });
      audio.noise({ dur: 0.02, freq: 3000, q: 3, vol: 0.05 });
    },
    complete() {
      audio.tone({ f: 660, f2: 1320, type: 'triangle', dur: 0.12, vol: 0.12 });
      [1568, 2093, 2637].forEach((f, i) => audio.tone({ f, type: 'sine', dur: 0.12, vol: 0.07, delay: 0.08 + i * 0.05 }));
      haptics.buzz(20);
    },
    reveal() {
      audio.tone({ f: 990, f2: 1480, type: 'triangle', dur: 0.12, vol: 0.1 });
    },
    eject() {
      audio.noise({ dur: 0.12, freq: 900, f2: 300, type: 'lowpass', vol: 0.25 });
    },
    snip() {
      audio.noise({ dur: 0.05, freq: 5000, q: 4, vol: 0.25 });
      audio.noise({ dur: 0.05, freq: 5200, q: 4, vol: 0.25, delay: 0.12 });
      haptics.buzz([10, 40, 10]);
    },
    balloon() {
      audio.tone({ f: 300, f2: 900, type: 'sine', dur: 0.35, vol: 0.12 });
      haptics.buzz(15);
    },
    topple() {
      audio.noise({ dur: 0.08, freq: 260, f2: 120, type: 'lowpass', vol: 0.35 });
    },
    error() {
      audio.tone({ f: 180, f2: 140, type: 'square', dur: 0.12, vol: 0.08 });
      haptics.buzz(40);
    },
    booster() {
      [784, 988, 1175].forEach((f, i) => audio.tone({ f, type: 'triangle', dur: 0.12, vol: 0.12, delay: i * 0.05 }));
      haptics.buzz([15, 30, 15]);
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
