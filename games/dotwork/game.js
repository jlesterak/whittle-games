// Dotwork: game module. A full-screen canvas board with a pan/zoom camera (render.js) under a
// DOM overlay in a 1080-wide design space (core/stage.js): the HUD bar pinned to the top, the
// booster row pinned to the bottom, end screens over everything. Taps fire on release;
// drags pan, two fingers pinch, double-tap on empty space toggles fit <-> 2x, the wheel zooms.

import { createBoard, loadBoard, fire, erase, addStar, freeArrows, serialize, STARS } from './board.js';
import { generateLevel } from './generator.js';
import { Renderer } from './render.js';
import { fitStage } from '../../core/stage.js';
import { cleanSave } from '../../core/save.js';
import { makeSounds } from './sounds.js';

const DW = 1080;
const MIN_H = 1760; // design height that must always fit: HUD + end screens + boosters
const HUD_BOTTOM = 200;
const BOOST_TOP = 240; // from the bottom of the stage
const PRICE = 100; // coins per booster and per "+1 star" (ref 3, 4.3 [G])
const REWARD = 5; // per star left (ref 3: +5 for a 1-star clear), doubled on hard levels
const START_BOOSTERS = { hint: 9, erase: 3, wand: 4, guide: 5 }; // ref 4.3
const WAND_MAX = 10; // ref unknown 4: the batch looked like 8-10 arrows
const LEVEL_GEN = 1; // bump when the generator changes: an in-progress save restarts its level
const TAP_MS = 350;
const SLOP = 10; // px a touch may move and still be a tap (ref 4.1)

const ICONS = {
  gear: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="none" stroke="#8d96b8" stroke-width="11" stroke-dasharray="8.4 7.3"/><circle cx="32" cy="32" r="16" fill="#8d96b8"/><circle cx="32" cy="32" r="7" fill="#19243f"/></svg>`,
  coin: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#d18a10"/><circle cx="32" cy="32" r="22" fill="#f6c23a"/><path d="M20 38l4-14 8 8 8-8 4 14z" fill="#d18a10"/></svg>`,
  star: `<svg viewBox="0 0 64 64"><path d="M32 4l8.6 18.2 19.9 2.5-14.6 13.8 3.7 19.7L32 48.6 14.4 58.2l3.7-19.7L3.5 24.7l19.9-2.5z" stroke-linejoin="round"/></svg>`,
  hint: `<svg viewBox="0 0 64 64"><path d="M32 6c-11 0-19 8-19 18 0 7 4 11 7 15 2 3 3 5 3 8h18c0-3 1-5 3-8 3-4 7-8 7-15 0-10-8-18-19-18z" fill="#ffd23c"/><path d="M24 14c-4 2-6 6-6 10" stroke="#fff6" stroke-width="5" fill="none" stroke-linecap="round"/><rect x="22" y="47" width="20" height="5" rx="2" fill="#7d8cb0"/><rect x="23" y="53" width="18" height="5" rx="2" fill="#5c6a90"/><path d="M27 58h10l-2 4h-6z" fill="#3f4a6a"/></svg>`,
  erase: `<svg viewBox="0 0 64 64"><g transform="rotate(-35 32 32)"><rect x="8" y="20" width="48" height="24" rx="6" fill="#f08ab8"/><rect x="34" y="20" width="22" height="24" rx="6" fill="#4a7ae0"/><rect x="34" y="20" width="6" height="24" fill="#3a62c0"/><rect x="10" y="22" width="22" height="6" rx="3" fill="#fff5"/></g></svg>`,
  wand: `<svg viewBox="0 0 64 64"><path d="M30 34L14 58" stroke="#7a5230" stroke-width="6" stroke-linecap="round"/><path d="M38 4l5.7 12 13.1 1.7-9.6 9.1 2.4 13L38 33.4 26.4 39.8l2.4-13-9.6-9.1 13.1-1.7z" fill="#ffd23c" stroke="#e0a000" stroke-width="2" stroke-linejoin="round"/></svg>`,
  guide: `<svg viewBox="0 0 64 64"><path d="M8 56L56 8v48z" fill="#4aa8f0"/><path d="M24 48l20-20v20z" fill="#253a6a"/><g stroke="#d8f0ff" stroke-width="2.5"><path d="M50 14h-5M50 22h-5M50 30h-5M50 38h-5M50 46h-5"/></g></svg>`,
  mascot: `<svg viewBox="0 0 200 200"><path d="M100 10c20 30 60 40 50 90 20-10 25-30 22-45 18 30 10 80-30 100H68C28 135 20 85 38 55c-3 15 2 35 22 45-10-50 30-60 40-90z" fill="#ff6a2a"/><path d="M100 50c10 20 35 30 28 62 10-6 12-16 12-26 8 22 0 50-28 62H88c-28-12-36-40-28-62 0 10 2 20 12 26-7-32 18-42 28-62z" fill="#ffc23a"/><path d="M60 120h60v-22l40 37-40 37v-22H60z" fill="#a91bad" stroke="#5a0a60" stroke-width="6" stroke-linejoin="round"/><path d="M78 136l14 6M106 136l-14 6" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg>`,
  cracked: `<svg viewBox="0 0 64 64"><path d="M32 4l8.6 18.2 19.9 2.5-14.6 13.8 3.7 19.7L32 48.6 14.4 58.2l3.7-19.7L3.5 24.7l19.9-2.5z" fill="#e2ce04" stroke="#a07a00" stroke-width="2" stroke-linejoin="round"/><path d="M32 6l-4 14 6 8-5 10 4 10" stroke="#6a4a00" stroke-width="3" fill="none" stroke-linejoin="round"/></svg>`,
};
const BOOSTERS = [
  ['hint', 'Hint'],
  ['erase', 'Eraser'],
  ['wand', 'Star wand'],
  ['guide', 'Guide lines'],
];
const TIPS = {
  1: 'Tap an arrow with a clear line to the edge',
  2: 'A blocked arrow bumps back and costs a star',
};
const ZOOM_TIP = 'Pinch or double-tap to zoom';

function freshSave() {
  return { level: 1, coins: 0, boosters: { ...START_BOOSTERS }, best: {}, zoomTip: false, inProgress: null };
}

export default {
  settings: [],

  mount(root, ctx) {
    const { el, modal, toast } = ctx.ui;
    const S = ctx.settings;
    const stored = ctx.store.get();
    const repaired = [];
    const save = cleanSave(stored, freshSave(), repaired);
    if (repaired.length) ctx.store.keep(stored); // a copy of what was there before it is saved over
    save.level = Math.max(1, save.level);
    const sounds = makeSounds(ctx.audio, ctx.haptics);

    // ---- DOM ----
    const canvas = el('canvas', { class: 'po-canvas' });
    const stage = el('div', { class: 'po-stage' });
    root.append(canvas, stage, el('style', {}, CSS));
    const renderer = new Renderer(canvas);

    const hardTab = el('div', { class: 'po-hard' }, 'HARD LEVEL');
    const lvlText = el('div', { class: 'po-lvl' });
    const starEls = [0, 1, 2].map(() => el('i', { class: 'po-star', html: ICONS.star }));
    const barFill = el('i');
    const coinText = el('span');
    const gear = el('button', { class: 'po-gear', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openSettings() });
    const hud = el(
      'div',
      { class: 'po-hud' },
      hardTab,
      lvlText,
      el('div', { class: 'po-stars' }, starEls, el('div', { class: 'po-bar' }, barFill)),
      el('div', { class: 'po-coins' }, el('i', { html: ICONS.coin }), coinText),
      gear,
    );
    const banner = el(
      'div',
      { class: 'po-banner' },
      el('b', {}, 'Eraser'),
      el('span', {}, 'Tap an arrow to remove it!'),
      el('button', { class: 'po-x', 'aria-label': 'Cancel eraser', onclick: () => setMode(null) }, '×'),
    );
    const tip = el('div', { class: 'po-tip' });
    const badges = {};
    const tiles = {};
    const row = el(
      'div',
      { class: 'po-boosts' },
      BOOSTERS.map(([k, name]) => {
        badges[k] = el('b', { class: 'po-badge' });
        tiles[k] = el('button', { class: 'po-tile', 'aria-label': name, onclick: () => useBooster(k) }, el('i', { html: ICONS[k] }), badges[k]);
        return tiles[k];
      }),
    );
    const splash = el('div', { class: 'po-splash' }, el('i', { html: ICONS.mascot }), el('b', {}, 'HARD LEVEL'));
    stage.append(hud, banner, tip, row, splash);

    // ---- state ----
    let level;
    let board;
    let mode = null; // 'erase' | null
    let overlay = null;
    let raf = 0;
    let timers = [];
    let winAt = 0; // when the win wave started
    let saveTimer = 0;
    let uiKey = '';
    let shownStars = STARS;
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));

    function persist() {
      save.inProgress = board?.status === 'playing' ? { level: level.n, gen: LEVEL_GEN, board: serialize(board), hint: renderer.hint } : null;
      ctx.store.set(save);
    }

    function startLevel(n, resume) {
      timers.forEach(clearTimeout);
      timers = [];
      closeOverlay();
      level = generateLevel(n);
      board = createBoard(level);
      if (resume) {
        try {
          board = loadBoard(level, resume.board);
        } catch (e) {
          console.warn('could not resume, restarting level', e);
          board = createBoard(level);
        }
      }
      shownStars = board.stars;
      winAt = 0;
      renderer.setLevel(level, board);
      const h = resume?.hint;
      if (Number.isInteger(h) && h >= 0 && h < level.arrows.length && !board.gone[h]) renderer.hint = h;
      setMode(null);
      if (level.hard && !resume) {
        splash.classList.remove('show');
        void splash.offsetWidth; // restart the animation
        splash.classList.add('show');
      }
      showTip();
      updateHud(true);
      persist();
    }

    function showTip() {
      let t = board.removed === 0 ? TIPS[level.n] || '' : '';
      if (!t && !save.zoomTip && renderer.fitPitch < 24) {
        t = ZOOM_TIP;
        save.zoomTip = true;
      }
      tip.textContent = t;
      tip.classList.toggle('show', !!t);
      if (t === ZOOM_TIP) later(5000, () => tip.classList.remove('show'));
    }

    // ---- layout ----
    function resize() {
      const w = root.clientWidth || innerWidth;
      const h = root.clientHeight || innerHeight;
      const f = fitStage(w, h, { W: DW, H: MIN_H });
      const sh = h / f.scale;
      stage.style.height = `${sh}px`;
      stage.style.transform = `translate(${f.offX}px, 0) scale(${f.scale})`;
      const top = (HUD_BOTTOM + 24) * f.scale;
      const bottom = h - (BOOST_TOP + 16) * f.scale;
      renderer.resize(w, h, Math.min(globalThis.devicePixelRatio || 1, 2), { x: 12, y: top, w: w - 24, h: bottom - top });
    }

    // ---- HUD ----
    function updateHud(force) {
      const key = [level.n, save.coins, mode, shownStars, board.removed, ...Object.values(save.boosters)].join();
      if (!force && key === uiKey) return;
      uiKey = key;
      lvlText.textContent = `LVL ${level.n}`;
      hardTab.classList.toggle('show', !!level.hard);
      starEls.forEach((s, i) => s.classList.toggle('on', i < shownStars));
      barFill.style.width = `${(100 * board.removed) / level.arrows.length}%`;
      coinText.textContent = save.coins.toLocaleString('en');
      for (const [k] of BOOSTERS) {
        const n = save.boosters[k];
        badges[k].textContent = n > 0 ? n : '+';
        badges[k].classList.toggle('buy', n <= 0);
      }
      root.classList.toggle('po-erasing', mode === 'erase');
    }

    function setMode(m) {
      mode = m;
      updateHud(true);
    }

    const offSettings = S.onChange((key) => {
      if (key === 'reducedMotion') applyOptions();
    });
    function applyOptions() {
      renderer.setOptions({ reducedMotion: !!S.get('reducedMotion') });
      root.classList.toggle('po-rm', !!S.get('reducedMotion'));
    }

    // ---- playing ----
    const now = () => performance.now() / 1000;

    function tapArrow(id) {
      if (board.status !== 'playing' || overlay) return;
      if (mode === 'erase') {
        if (!spend('erase')) return setMode(null);
        erase(board, id);
        renderer.erase(id, now());
        sounds.rub();
        setMode(null);
        afterMove();
        return;
      }
      const r = fire(board, id);
      if (!r) return;
      tip.classList.remove('show');
      if (r.ok) {
        renderer.escape(id, now());
        sounds.escape();
      } else {
        const tOut = renderer.bump(id, r.blocker, now());
        later(tOut * 1000, () => sounds.bump());
        const stars = board.stars;
        later((tOut + 0.45) * 1000, () => {
          shownStars = Math.min(shownStars, stars);
          sounds.starLost();
          updateHud(true);
        });
        if (board.status === 'lost') later((tOut + 0.9) * 1000, () => board.status === 'lost' && !overlay && showOutOfStars());
      }
      afterMove();
    }

    function afterMove() {
      persist();
      updateHud();
    }

    // ---- boosters (ref 4.3) ----
    function spend(key) {
      if (save.boosters[key] > 0) {
        save.boosters[key]--;
        return true;
      }
      return false;
    }

    function offerBuy(key, name) {
      if (save.coins < PRICE) {
        toast(`No ${name} left. Clear levels to earn coins (${PRICE} buys one).`, 2400);
        return;
      }
      modal({
        title: `Buy ${name}?`,
        body: [el('p', { class: 'po-p' }, `${PRICE} coins for one. You have ${save.coins}.`)],
        actions: [
          { label: 'Not now' },
          {
            label: `Buy (${PRICE})`,
            primary: true,
            onClick: (close) => {
              save.coins -= PRICE;
              save.boosters[key]++;
              persist();
              updateHud(true);
              close();
            },
          },
        ],
      });
    }

    function tileCentre(key) {
      const r = tiles[key].getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      return [r.left + r.width / 2 - c.left, r.top + r.height / 2 - c.top];
    }

    function useBooster(key) {
      if (board.status !== 'playing' || overlay) return;
      const name = BOOSTERS.find(([k]) => k === key)[1];
      if (mode === 'erase') return setMode(null);
      if (save.boosters[key] <= 0) return offerBuy(key, name);
      const free = freeArrows(board);
      const t = now();
      if (key === 'hint') {
        if (renderer.hint >= 0 && !board.gone[renderer.hint]) return toast('The green arrow is free: tap it');
        if (!free.length) return toast('No free arrow right now');
        spend('hint');
        renderer.fit(true, t);
        later(450, () => {
          renderer.hint = free[Math.floor(Math.random() * free.length)];
          renderer.dirty = true;
          sounds.hint();
          persist();
        });
      } else if (key === 'erase') {
        setMode('erase');
        return;
      } else if (key === 'wand') {
        if (!free.length) return toast('No free arrow right now');
        spend('wand');
        renderer.fit(true, t);
        const ids = free.sort(() => Math.random() - 0.5).slice(0, WAND_MAX);
        const [sx, sy] = tileCentre('wand');
        sounds.wand();
        renderer.sparkTo(ids, sx, sy, t + 0.45, 1.1);
        later(1700, () => {
          let n = 0;
          for (const id of ids) {
            if (board.status !== 'playing' || board.gone[id]) continue;
            if (fire(board, id)?.ok) {
              renderer.escape(id, now());
              n++;
            }
          }
          if (n) sounds.escape();
          afterMove();
        });
      } else if (key === 'guide') {
        if (renderer.guides) return toast('Guide lines stay until the next arrow flies');
        spend('guide');
        renderer.guides = true;
        renderer.dirty = true;
        sounds.guide();
      }
      afterMove();
    }

    // ---- input: tap on release, drag pans, pinch / wheel zoom, double-tap toggles zoom ----
    const ptrs = new Map();
    let gesture = null; // { moved, t0, pinch? }
    let lastEmpty = { t: 0, x: 0, y: 0 };
    const local = (ev) => {
      const r = canvas.getBoundingClientRect();
      return [ev.clientX - r.left, ev.clientY - r.top];
    };
    canvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      canvas.setPointerCapture?.(ev.pointerId);
      const [x, y] = local(ev);
      ptrs.set(ev.pointerId, { x, y, x0: x, y0: y });
      if (ptrs.size === 1) gesture = { moved: false, t0: performance.now() };
      else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        gesture.moved = true;
        gesture.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, p: renderer.pitch, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
    });
    canvas.addEventListener('pointermove', (ev) => {
      const p = ptrs.get(ev.pointerId);
      if (!p || !gesture) return;
      const [x, y] = local(ev);
      const dx = x - p.x;
      const dy = y - p.y;
      p.x = x;
      p.y = y;
      if (ptrs.size >= 2 && gesture.pinch) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        renderer.panBy(mx - gesture.pinch.mx, my - gesture.pinch.my);
        renderer.zoomAt(mx, my, (gesture.pinch.p * d) / gesture.pinch.d);
        gesture.pinch.mx = mx;
        gesture.pinch.my = my;
        return;
      }
      if (!gesture.moved && Math.hypot(x - p.x0, y - p.y0) > SLOP) gesture.moved = true;
      if (gesture.moved) renderer.panBy(dx, dy);
    });
    const up = (ev) => {
      const p = ptrs.get(ev.pointerId);
      if (!p) return;
      ptrs.delete(ev.pointerId);
      if (ptrs.size === 1 && gesture?.pinch) {
        gesture.pinch = null; // keep panning with the remaining finger, never a tap
        return;
      }
      if (ptrs.size || !gesture) return;
      const g = gesture;
      gesture = null;
      if (ev.type === 'pointercancel' || g.moved || performance.now() - g.t0 > TAP_MS) return;
      const id = renderer.hit(p.x, p.y);
      if (id >= 0) return tapArrow(id);
      const t = performance.now();
      if (t - lastEmpty.t < 320 && Math.hypot(p.x - lastEmpty.x, p.y - lastEmpty.y) < 40) {
        renderer.zoomToggle(p.x, p.y, t / 1000);
        lastEmpty.t = 0;
      } else lastEmpty = { t, x: p.x, y: p.y };
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        const [x, y] = local(ev);
        renderer.zoomAt(x, y, renderer.pitch * Math.exp(-ev.deltaY * 0.0015));
      },
      { passive: false },
    );

    // ---- end screens ----
    function closeOverlay() {
      overlay?.remove();
      overlay = null;
    }

    function showWin() {
      const stars = Math.max(1, board.stars);
      const reward = REWARD * stars * (level.hard ? 2 : 1);
      save.coins += reward;
      save.best[level.n] = Math.max(save.best[level.n] || 0, stars);
      save.level = Math.max(save.level, level.n + 1);
      save.inProgress = null;
      ctx.store.set(save);
      sounds.win();
      const rm = S.get('reducedMotion');
      overlay = el(
        'div',
        { class: 'po-end po-win' },
        rm ? null : el('div', { class: 'po-confetti' }, Array.from({ length: 28 }, (_, i) => el('i', { style: `left:${(i * 37) % 100}%;background:${['#e2ce04', '#3475dc', '#ca4e53', '#3cb94a', '#d37013'][i % 5]};animation-delay:${((i * 0.13) % 1.4).toFixed(2)}s` }))),
        el(
          'div',
          { class: 'po-bigstars' },
          [0, 1, 2].map((i) => el('i', { class: i < stars ? 'on' : '', style: `animation-delay:${0.2 + i * 0.25}s`, html: ICONS.star })),
        ),
        el('div', { class: 'po-pill' }, el('span', {}, `LEVEL ${level.n}`), el('b', {}, 'COMPLETED!')),
        el('div', { class: 'po-reward' }, el('h3', {}, 'REWARD'), el('p', {}, el('i', { html: ICONS.coin }), `+${reward}`)),
        el(
          'div',
          { class: 'po-row' },
          stars < STARS ? el('button', { class: 'po-btn po-purple', onclick: () => startLevel(level.n) }, 'Replay') : null,
          el('button', { class: 'po-btn po-green', onclick: () => startLevel(level.n + 1) }, 'Next'),
        ),
      );
      stage.append(overlay);
      updateHud(true);
    }

    // Out of Stars (ref 3): +1 star for coins keeps the board, or give up.
    function showOutOfStars() {
      sounds.lose();
      const afford = save.coins >= PRICE;
      overlay = el(
        'div',
        { class: 'po-end po-dim' },
        el(
          'div',
          { class: 'po-card' },
          el('h1', {}, 'Out of Stars!'),
          el('i', { class: 'po-cracked', html: ICONS.cracked }),
          el('p', {}, 'Get one more star and keep your progress'),
          el(
            'div',
            { class: 'po-row' },
            el('button', { class: 'po-btn po-red', onclick: () => showFailed() }, 'Give Up'),
            el(
              'button',
              {
                class: `po-btn po-yellow${afford ? '' : ' po-off'}`,
                onclick: () => {
                  if (!afford) return;
                  save.coins -= PRICE;
                  addStar(board);
                  shownStars = board.stars;
                  closeOverlay();
                  persist();
                  updateHud(true);
                },
              },
              '+1 ',
              el('i', { class: 'po-s', html: ICONS.star }),
              el('i', { html: ICONS.coin }),
              String(PRICE),
            ),
          ),
          afford ? null : el('p', { class: 'po-small' }, `You have ${save.coins} coins`),
        ),
      );
      stage.append(overlay);
    }

    function showFailed() {
      closeOverlay();
      save.inProgress = null;
      ctx.store.set(save);
      overlay = el(
        'div',
        { class: 'po-end po-dark' },
        el('h1', { class: 'po-failed' }, 'LEVEL FAILED'),
        el('i', { class: 'po-cracked big', html: ICONS.cracked }),
        el('p', {}, `${board.removed} of ${level.arrows.length} arrows out`),
        el('button', { class: 'po-btn po-green', onclick: () => startLevel(level.n) }, 'Replay'),
      );
      stage.append(overlay);
    }

    function openSettings() {
      ctx.openSettings([{ label: 'Restart level', onClick: (close) => (close(), startLevel(level.n)) }]);
    }

    // ---- loop ----
    function loop(t) {
      raf = requestAnimationFrame(loop);
      const n = t / 1000;
      if (autoplay) autoStep(n);
      if (board.status === 'won' && !winAt && !renderer.busy()) {
        winAt = n;
        renderer.startWave(n);
        later(S.get('reducedMotion') ? 300 : 1800, showWin);
      }
      renderer.frame(n);
      if (!overlay) updateHud();
    }

    // ?autoplay=1 fires the peel solution (testing); ?debug exposes window.__po()
    const params = new URLSearchParams(location.search);
    const autoplay = params.has('autoplay');
    let autoNext = 0;
    if (autoplay || params.has('debug')) window.__po = () => ({ board, level, save, renderer });
    function autoStep(n) {
      if (board.status !== 'playing' || overlay || n < autoNext) return;
      const id = freeArrows(board)[0];
      if (id === undefined) return;
      tapArrow(id);
      autoNext = n + 0.12;
    }

    const onVis = () => {
      if (document.hidden) persist();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', persist);
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    saveTimer = setInterval(persist, 5000);
    document.body.style.background = '#151823';

    applyOptions();
    resize();
    const ip = save.inProgress;
    const jump = +params.get('level'); // ?level=N to jump (testing)
    if (jump > 0) save.level = jump;
    startLevel(save.level, !jump && ip && ip.level === save.level && ip.gen === LEVEL_GEN ? ip : null);
    raf = requestAnimationFrame(loop);

    return {
      unmount() {
        persist();
        cancelAnimationFrame(raf);
        clearInterval(saveTimer);
        timers.forEach(clearTimeout);
        ro.disconnect();
        offSettings();
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pagehide', persist);
        document.body.style.background = '';
      },
    };
  },
};

const CSS = `
.po-canvas { position: absolute; inset: 0; touch-action: none; }
.po-stage { position: absolute; left: 0; top: 0; width: 1080px; transform-origin: 0 0; pointer-events: none;
  font-family: ui-rounded, 'Arial Rounded MT Bold', system-ui, Roboto, sans-serif; font-weight: 900; color: #fff; }
.po-stage :where(button) { pointer-events: auto; border: 0; padding: 0; font: inherit; color: inherit; background: none; }
.po-hud { position: absolute; left: 30px; right: 30px; top: 40px; height: 150px; border-radius: 44px; background: #19243f;
  box-shadow: 0 10px 24px #0008; transition: transform .25s, opacity .25s; }
.po-hard { position: absolute; left: 50px; top: -18px; padding: 4px 22px; border-radius: 14px 14px 14px 4px; background: #a91bad;
  font-size: 32px; display: none; }
.po-hard.show { display: block; }
.po-lvl { position: absolute; left: 70px; top: 0; line-height: 150px; font-size: 60px; -webkit-text-stroke: 8px #1d2f66; paint-order: stroke fill; }
.po-stars { position: absolute; left: 400px; top: 22px; width: 220px; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.po-star { width: 66px; height: 66px; }
.po-star svg { width: 100%; height: 100%; fill: #142038; stroke: #2a3a60; stroke-width: 2; transition: fill .3s; }
.po-star.on svg { fill: #e2ce04; stroke: #a07a00; }
.po-bar { width: 216px; height: 14px; border-radius: 7px; background: #0f1526; margin-top: 10px; overflow: hidden; }
.po-bar i { display: block; height: 100%; width: 0; background: #90c453; border-radius: 7px; transition: width .3s; }
.po-coins { position: absolute; right: 150px; top: 45px; height: 60px; padding: 0 18px 0 64px; border-radius: 30px; background: #0f1526;
  font-size: 36px; display: flex; align-items: center; }
.po-coins i { position: absolute; left: 6px; top: 6px; width: 48px; height: 48px; }
.po-coins svg, .po-tile > i svg, .po-btn i svg, .po-reward i svg, .po-cracked svg { width: 100%; height: 100%; display: block; }
.po-gear { position: absolute; right: 40px; top: 35px; width: 80px; height: 80px; }
.po-gear svg { width: 100%; height: 100%; }
.po-banner { position: absolute; left: 30px; right: 30px; top: 40px; height: 150px; border-radius: 44px; background: #f08ab8;
  display: flex; align-items: center; gap: 24px; padding: 0 140px 0 50px; font-size: 40px; color: #4a1030;
  transform: translateY(-260px); visibility: hidden; transition: transform .25s, visibility 0s .25s; }
.po-banner b { font-size: 52px; color: #fff; -webkit-text-stroke: 8px #a0306a; paint-order: stroke fill; }
.po-x { position: absolute !important; right: 30px; top: 30px; width: 90px; height: 90px; border-radius: 50% !important;
  background: #e8323c !important; color: #fff !important; font-size: 64px !important; line-height: 1; box-shadow: 0 6px 0 #8a1010; }
/* parked bars slide out, then hide so they can't be focused or tapped off-screen */
.po-erasing .po-banner { transform: none; visibility: visible; transition: transform .25s; }
.po-erasing .po-hud { transform: translateY(-260px); visibility: hidden; transition: transform .25s, opacity .25s, visibility 0s .25s; }
.po-erasing .po-boosts { transform: translateY(400px); visibility: hidden; transition: transform .25s, visibility 0s .25s; }
.po-tip { position: absolute; left: 60px; right: 60px; top: 230px; text-align: center; font-size: 42px; opacity: 0; transition: opacity .3s;
  -webkit-text-stroke: 9px #151823; paint-order: stroke fill; }
.po-tip.show { opacity: 1; }
.po-boosts { position: absolute; left: 0; right: 0; bottom: 60px; height: 175px; display: flex; justify-content: center; gap: 23px;
  transition: transform .25s; }
.po-tile { position: relative; width: 188px; height: 175px; border-radius: 40px !important; background: #253a6a !important;
  box-shadow: inset 0 -8px 0 #0003, 0 8px 18px #0006; }
.po-tile > i { position: absolute; inset: 26px 34px; }
.po-tile:active { transform: translateY(4px); }
.po-badge { position: absolute; right: -14px; top: -18px; min-width: 64px; height: 64px; border-radius: 32px; background: #3cb94a;
  border: 5px solid #19243f; font-size: 36px; display: flex; align-items: center; justify-content: center; padding: 0 8px; }
.po-badge.buy { background: #e2a012; }
.po-splash { position: absolute; inset: 0; box-shadow: 0 0 0 3000px #2a0838e0; background: radial-gradient(circle at 50% 45%, #a91bad80, #2a0838f0 65%);
  display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; visibility: hidden; }
.po-splash i { width: 420px; height: 420px; }
.po-splash i svg { width: 100%; height: 100%; }
.po-splash b { font-size: 120px; color: #ffc23a; -webkit-text-stroke: 18px #7a1a10; paint-order: stroke fill; margin-top: -20px; }
.po-splash.show { visibility: visible; animation: po-splash 2.1s forwards; }
.po-splash.show i { animation: po-bounce .5s cubic-bezier(.2,1.6,.5,1); }
.po-rm .po-splash.show i { animation: none; }
@keyframes po-splash { 0% { opacity: 0; } 12%, 85% { opacity: 1; } 100% { opacity: 0; visibility: hidden; } }
@keyframes po-bounce { from { transform: scale(.3); } }

.po-end { position: absolute; inset: 0; box-shadow: 0 0 0 3000px var(--edge, transparent); pointer-events: auto; display: flex;
  flex-direction: column; align-items: center; justify-content: center; animation: po-fade .3s; overflow: hidden; }
.po-win { --edge: #0e1a3a; background: radial-gradient(circle at 50% 40%, #1d3a6a, #0e1a3a 70%); }
.po-bigstars { display: flex; align-items: flex-end; gap: 10px; }
.po-bigstars i { width: 230px; height: 230px; animation: po-pop .45s cubic-bezier(.2,1.6,.5,1) backwards; }
.po-bigstars i:nth-child(2) { width: 280px; height: 280px; margin-bottom: 40px; }
.po-bigstars svg { width: 100%; height: 100%; fill: #2f6fe0; stroke: #1a3a90; stroke-width: 3; }
.po-bigstars i.on svg { fill: #f6d21a; stroke: #b08000; }
.po-pill { margin-top: 50px; padding: 24px 60px; border-radius: 40px; background: #0b1226d8; text-align: center; font-size: 56px; line-height: 1.15;
  animation: po-pop .3s 1s backwards; }
.po-pill span, .po-pill b { display: block; }
.po-pill b { color: #ffd84a; }
.po-reward { margin-top: 50px; width: 640px; border: 5px solid #e2c040; border-radius: 40px; padding: 10px 0 30px; text-align: center;
  animation: po-pop .3s 1.4s backwards; }
.po-reward h3 { margin: -36px auto 0; width: 260px; background: #13234a; color: #ffd84a; font-size: 40px; }
.po-reward p { margin: 20px 0 0; font-size: 72px; display: flex; justify-content: center; align-items: center; gap: 16px; }
.po-reward i { width: 90px; height: 90px; }
.po-row { display: flex; gap: 30px; margin-top: 60px; }
.po-win .po-row { animation: po-pop .3s 1.8s backwards; }
.po-rm .po-end, .po-rm .po-end * { animation: none !important; }
.po-btn { position: relative; min-width: 330px; height: 130px; border-radius: 36px !important; padding: 0 40px !important; font-size: 56px !important;
  display: flex; align-items: center; justify-content: center; gap: 8px; color: #fff !important; -webkit-text-stroke: 9px #0005; paint-order: stroke fill;
  box-shadow: 0 10px 0 #0006; white-space: nowrap; }
.po-btn i { width: 60px; height: 60px; }
.po-btn .po-s svg { fill: #f6d21a; stroke: #b08000; stroke-width: 3; }
.po-green { background: linear-gradient(#6ad84a, #2f9a2a) !important; }
.po-purple { background: linear-gradient(#b86ae8, #7a2ac0) !important; }
.po-red { background: linear-gradient(#ff6a5a, #d0283a) !important; min-width: 300px; }
.po-yellow { background: linear-gradient(#ffd84a, #e29a10) !important; }
.po-off { filter: grayscale(.8); opacity: .6; }
.po-dim { --edge: #070a14c8; background: #070a14c8; }
.po-dark { --edge: #0b1020f4; background: #0b1020f4; }
.po-card { width: 920px; background: linear-gradient(#26386a, #19243f); border: 8px solid #3a5aa0; border-radius: 50px; padding: 50px 40px 60px;
  display: flex; flex-direction: column; align-items: center; animation: po-pop .3s; }
.po-card h1, .po-failed { margin: 0; font-size: 96px; color: #fff; -webkit-text-stroke: 16px #a8303a; paint-order: stroke fill; }
.po-cracked { width: 240px; height: 240px; margin-top: 30px; }
.po-cracked.big { width: 360px; height: 360px; }
.po-card p, .po-dark p { font-size: 44px; text-align: center; margin: 30px 0 0; }
.po-small { font-size: 34px !important; opacity: .8; }
.po-confetti { position: absolute; inset: 0; pointer-events: none; }
.po-confetti i { position: absolute; top: -40px; width: 22px; height: 34px; border-radius: 4px; animation: po-fall 2.6s linear infinite; }
.po-p { font-size: 17px; text-align: center; margin: 0; }
@keyframes po-fade { from { opacity: 0; } }
@keyframes po-pop { from { transform: scale(.4); opacity: 0; } }
@keyframes po-fall { to { transform: translateY(2400px) rotate(540deg); } }
`;
