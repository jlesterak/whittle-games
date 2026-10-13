// Beadloom sound effects, synthesised with core/audio.js (no sample files), plus haptics.
// Bead clicks are rate-limited so fast speed doesn't turn into noise.

export function makeSounds(audio, haptics) {
  let lastClick = 0;
  let clickN = 0;
  return {
    pick() {
      audio.tone({ f: 520, f2: 880, type: 'triangle', dur: 0.09, vol: 0.22 });
      audio.noise({ dur: 0.03, freq: 2500, vol: 0.15 });
      haptics.buzz(12);
    },
    bead(fill) {
      const t = audio.now;
      if (t - lastClick < 0.045) return;
      lastClick = t;
      clickN++;
      // glassy tick that rises as the crate fills
      audio.tone({ f: 1500 + fill * 900 + (clickN % 3) * 120, type: 'sine', dur: 0.035, vol: 0.07 });
      audio.noise({ dur: 0.018, freq: 5200 + (clickN % 4) * 400, q: 4, vol: 0.08 });
    },
    complete() {
      audio.noise({ dur: 0.08, freq: 400, f2: 150, type: 'lowpass', vol: 0.4 }); // lid thump
      audio.tone({ f: 660, f2: 990, type: 'square', dur: 0.08, vol: 0.06, delay: 0.02 });
      [1320, 1760, 2093].forEach((f, i) => audio.tone({ f, type: 'sine', dur: 0.14, vol: 0.08, delay: 0.1 + i * 0.06 })); // sparkle
      haptics.buzz(25);
    },
    poof() {
      audio.noise({ dur: 0.25, freq: 1200, f2: 4000, q: 0.7, vol: 0.18 });
    },
    reveal() {
      audio.tone({ f: 990, f2: 1480, type: 'triangle', dur: 0.12, vol: 0.1 });
    },
    swap() {
      audio.noise({ dur: 0.18, freq: 800, f2: 2400, q: 1.5, vol: 0.12 });
    },
    unlock() {
      audio.noise({ dur: 0.04, freq: 3000, q: 3, vol: 0.25 });
      audio.tone({ f: 1200, f2: 1800, type: 'square', dur: 0.06, vol: 0.06, delay: 0.25 });
      audio.noise({ dur: 0.05, freq: 2200, q: 3, vol: 0.25, delay: 0.3 });
    },
    eject() {
      audio.noise({ dur: 0.1, freq: 300, f2: 120, type: 'lowpass', vol: 0.35, delay: 0.18 });
      audio.noise({ dur: 0.25, freq: 2000, f2: 600, q: 0.8, vol: 0.08, delay: 0.18 });
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
