// A pip die as a DOM button, shared by the dice games (Yacht's five, Ludo's one), and tumble(),
// the roll animation. Size it with the CSS variable --die (core/style.css .wdie). Under reduced
// motion (body.reduced-motion) held dice don't lift and tumble() just sets the faces.

// Pip positions in a 3x3 grid, cells numbered 0-8 row by row.
const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function makeDie(el, { label = 'Die', onTap } = {}) {
  const pips = Array.from({ length: 9 }, () => el('i'));
  const node = el('button', { class: 'wdie blank', type: 'button' }, el('span', { class: 'wdie-face' }, pips));
  let value = 0;
  let held = false;
  const name = () => (value ? `${label}: ${value}${held ? ', held' : ''}` : `${label}: not rolled`);
  const die = {
    node,
    get value() {
      return value;
    },
    get held() {
      return held;
    },
    // 0 shows a blank (not yet rolled) die
    set(v) {
      value = v;
      node.classList.toggle('blank', !v);
      pips.forEach((p, i) => p.classList.toggle('on', !!v && PIPS[v].includes(i)));
      node.setAttribute('aria-label', name());
      return die;
    },
    hold(h) {
      held = !!h;
      node.classList.toggle('held', held);
      node.setAttribute('aria-pressed', held);
      node.setAttribute('aria-label', name());
      return die;
    },
  };
  if (onTap) node.addEventListener('click', () => onTap(die));
  return die.set(0);
}

// Roll animation: each die in `dice` flickers through random faces while it shakes, then lands
// on its value in `finals` (same order). onTick fires on each flicker (rattle sound), onDone at
// the end. With reduced motion the faces are set at once. Returns a cancel function.
export function tumble(dice, finals, { reduced = false, ms = 450, every = 60, onTick, onDone } = {}) {
  const land = () => {
    dice.forEach((d, i) => {
      d.node.classList.remove('tumbling');
      d.set(finals[i]);
    });
    onDone?.();
  };
  if (reduced || !dice.length) {
    land();
    return () => {};
  }
  dice.forEach((d, i) => {
    d.node.style.animationDelay = `${-i * 37}ms`;
    d.node.classList.add('tumbling');
  });
  const t0 = performance.now();
  const timer = setInterval(() => {
    if (performance.now() - t0 >= ms) {
      clearInterval(timer);
      land();
      return;
    }
    dice.forEach((d) => d.set(1 + Math.floor(Math.random() * 6)));
    onTick?.();
  }, every);
  return () => {
    clearInterval(timer);
    dice.forEach((d) => d.node.classList.remove('tumbling'));
  };
}
