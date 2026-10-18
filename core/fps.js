// Frame-rate overlay for measuring on a real phone (?fps, item P7b). Off unless the URL asks for it.
// frameStats is shared with tools/smoke.mjs --perf, so the phone and the headless numbers mean the same thing.

const WINDOW = 2000; // ms of frames the overlay summarises

// Frame intervals (ms) -> median fps and "95th pct fps" (1000 / the 95th percentile interval: the slow end).
export function frameStats(intervals) {
  const d = [...intervals].sort((a, b) => a - b);
  if (!d.length) return { median: 0, p95: 0 };
  const at = (q) => d[Math.min(d.length - 1, Math.floor(q * d.length))];
  return { median: 1000 / at(0.5), p95: 1000 / at(0.95) };
}

export function startFpsMeter() {
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;left:4px;top:50%;z-index:100;padding:2px 6px;border-radius:6px;' +
    'background:#000a;color:#fff;font:12px/1.3 monospace;pointer-events:none';
  document.body.append(box);
  const times = [];
  let shown = 0;
  const step = (now) => {
    times.push(now);
    while (times.length > 2 && now - times[0] > WINDOW) times.shift();
    if (now - shown > 500 && times.length > 2) {
      shown = now;
      const { median, p95 } = frameStats(times.slice(1).map((t, i) => t - times[i]));
      box.textContent = `${median.toFixed(0)} fps (slow 5%: ${p95.toFixed(0)})`;
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
