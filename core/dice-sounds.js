// Dice sounds shared by the dice games (Yacht, Ludo): a soft tick per tumble frame, a short
// buzz when the roll starts and a thump when the dice land. Synthesised with core/audio.js.

export function diceSounds(audio, haptics) {
  return {
    rattle() {
      audio.noise({ dur: 0.03, freq: 2200 + Math.random() * 1800, q: 2, vol: 0.12 });
    },
    roll() {
      haptics.buzz([12, 40, 12]);
    },
    land() {
      audio.noise({ dur: 0.05, freq: 900, f2: 500, type: 'lowpass', vol: 0.2 });
      audio.tone({ f: 330, f2: 300, type: 'triangle', dur: 0.06, vol: 0.05 });
    },
  };
}
