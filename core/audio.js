// Tiny WebAudio synth: tones and filtered noise bursts. No sample files.
// The context is created on the first user gesture (browsers block audio before that).
import * as settings from './settings.js';

let ctx = null;
let master = null;
let noiseBuf = null;

function ensure(create = true) {
  if (!ctx) {
    if (!create) return null;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Sounds are silent until a user gesture has created the context (unlock()).
const on = () => settings.get('sound') && ensure(false);

export const audio = {
  unlock: () => ensure(),
  get now() {
    return ctx ? ctx.currentTime : 0;
  },

  // A pitched blip. f -> f2 glide over dur seconds.
  tone({ f = 440, f2 = f, type = 'sine', dur = 0.12, vol = 0.25, attack = 0.004, delay = 0 } = {}) {
    if (!on()) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2 !== f) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  },

  // A filtered noise burst: clicks, thumps, whooshes.
  noise({ dur = 0.05, vol = 0.3, freq = 3000, f2 = freq, q = 1, type = 'bandpass', delay = 0 } = {}) {
    if (!on()) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(freq, t);
    if (f2 !== freq) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  },
};
