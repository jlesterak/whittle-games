// Vibration, gated by the haptics setting. No-op where navigator.vibrate is missing (iOS).
import * as settings from './settings.js';

export const haptics = {
  buzz(pattern = 10) {
    if (!settings.get('haptics')) return;
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
  },
};
