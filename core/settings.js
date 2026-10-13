// Global settings with defaults and change listeners. Game-specific settings use
// namespaced keys like 'beadloom.speed' and are declared by the game module.

import { allSettings, setSetting } from './save.js';

const prefersReduced =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const DEFAULTS = {
  sound: true,
  haptics: true,
  reducedMotion: prefersReduced,
  colourblind: false,
};

const subs = new Set();

export function get(key, fallback) {
  const s = allSettings();
  if (key in s) return s[key];
  if (key in DEFAULTS) return DEFAULTS[key];
  return fallback;
}

export function set(key, value) {
  setSetting(key, value);
  for (const fn of subs) fn(key, value);
}

export function onChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
