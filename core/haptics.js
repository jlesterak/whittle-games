// Vibration, gated by the haptics setting. No-op where navigator.vibrate is missing (iOS).
// Browsers refuse (and Chrome logs an error) before the first tap, so skip it until then.
import * as settings from './settings.js';

export const haptics = {
  buzz(pattern = 10) {
    if (!settings.get('haptics')) return;
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate(pattern);
  },
};
