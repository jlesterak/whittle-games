// Purl: game module. Canvas playfield (render.js) plus a DOM overlay scaled to the same
// 1080x2316 design space for the HUD, boosters and end screens. Fixed-step sim, rAF render.

import { createSim, generateLevel, generateDaily, isHard, BOBBIN_ROWS } from './rules.js';
import { clearInProgress, cleanDaily, currentStreak, freshDaily, isDate, localDate, winDaily } from '../../core/daily.js';
import { DT } from '../../engines/slotsort/sim.js';
import { Renderer, FIT } from './render.js';
import { fitStage, canvasDpr } from '../../core/stage.js';
import { cleanSave } from '../../core/save.js';
import { makeSounds } from './sounds.js';
import { COLORS } from './colors.js';

const REWARD = 20;
const HARD_REWARD = 40; // ref 4.2 (normal levels unrecorded: half)
const PRICE = 100; // coins per booster, and for Continue after Out of space
const START_BOOSTERS = { fill: 3, lift: 3, balloon: 3 };
const FREE_BOOSTER_EVERY = 3; // levels
const LEVEL_GEN = 1; // bump when the generator changes: an in-progress save of an older level restarts
const TURBO = 4; // once the win is unavoidable the picture unravels at 4x
const TOPPLE = 1.7; // seconds from the clog to the Out of space panel (ref 4.1)

const ICONS = {
  restart: `<svg viewBox="0 0 64 64"><path d="M50 30a18 18 0 1 1-6-13" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/><path d="M36 8l14 4-4 14z" fill="#fff"/></svg>`,
  gear: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="none" stroke="#fff" stroke-width="11" stroke-dasharray="8.4 7.3"/><circle cx="32" cy="32" r="16" fill="#fff"/><circle cx="32" cy="32" r="7" fill="#9f4e45"/></svg>`,
  skull: `<svg viewBox="0 0 64 64"><path d="M10 10l10 12M54 10L44 22" stroke="#e8323c" stroke-width="7" stroke-linecap="round"/><path d="M32 12C19 12 11 20 11 31c0 7 4 12 9 14v6c0 3 2 5 5 5h14c3 0 5-2 5-5v-6c5-2 9-7 9-14 0-11-8-19-21-19z" fill="#f4f1ea" stroke="#5a1010" stroke-width="3"/><circle cx="24" cy="32" r="6" fill="#e8323c"/><circle cx="40" cy="32" r="6" fill="#e8323c"/><path d="M29 43l3-4 3 4z" fill="#5a1010"/></svg>`,
  coin: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#d18a10"/><circle cx="32" cy="32" r="22" fill="#f6c23a"/><path d="M20 38l4-14 8 8 8-8 4 14z" fill="#d18a10"/></svg>`,
  fill: `<svg viewBox="0 0 64 64"><g stroke="#888" stroke-width="5" stroke-linecap="round"><path d="M20 10l24 30M44 10L20 40"/></g><circle cx="18" cy="48" r="9" fill="none" stroke="#d8303a" stroke-width="6"/><circle cx="46" cy="48" r="9" fill="none" stroke="#d8303a" stroke-width="6"/><circle cx="32" cy="26" r="3" fill="#555"/></svg>`,
  lift: `<svg viewBox="0 0 64 64"><ellipse cx="26" cy="50" rx="18" ry="6" fill="#1d5fc8"/><rect x="14" y="22" width="24" height="28" fill="#c9a26e"/><g fill="#2f7ae0"><rect x="14" y="26" width="24" height="5"/><rect x="14" y="34" width="24" height="5"/><rect x="14" y="42" width="24" height="5"/></g><ellipse cx="26" cy="22" rx="18" ry="6" fill="#3f86f0"/><path d="M50 40V14M42 22l8-9 8 9" stroke="#3cb43c" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  balloon: `<svg viewBox="0 0 64 64"><path d="M32 46c2 6-4 8 0 14" stroke="#777" stroke-width="2" fill="none"/><ellipse cx="32" cy="26" rx="17" ry="21" fill="#e8323c"/><ellipse cx="25" cy="18" rx="5" ry="7" fill="#ff9a9a"/><path d="M28 47h8l-4-5z" fill="#a1121e"/></svg>`,
  trophy: `<svg viewBox="0 0 120 120"><path d="M30 18h60v20c0 22-14 36-30 36S30 60 30 38z" fill="#f6c23a" stroke="#a8700a" stroke-width="4"/><path d="M30 26H14c0 18 10 26 20 26M90 26h16c0 18-10 26-20 26" fill="none" stroke="#f6c23a" stroke-width="8"/><rect x="52" y="74" width="16" height="16" fill="#d9a020"/><rect x="36" y="90" width="48" height="14" rx="4" fill="#a8700a"/><path d="M44 30c0 14 6 24 14 28" stroke="#fff8" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`,
};

function freshSave() {
  return { level: 1, coins: 0, boosters: { ...START_BOOSTERS }, cleared: 0, inProgress: null, daily: freshDaily() };
}

export default {
  settings: [],

  mount(root, ctx) {
    const { el, modal, toast } = ctx.ui;
    const S = ctx.settings;
    const stored = ctx.store.get();
    const repaired = [];
    const save = cleanSave(stored, freshSave(), repaired);
    save.daily = cleanDaily(save.daily); // dates and streak checked; old saves get an empty one
    if (repaired.length) ctx.store.keep(stored); // a copy of what was there before it is saved over
    save.level = Math.max(1, save.level);
    const sounds = makeSounds(ctx.audio, ctx.haptics);

    // ---- DOM ----
    const canvas = el('canvas', { class: 'ck-canvas' });
    const stage = el('div', { class: 'ck-stage' });
    root.append(canvas, stage, el('style', {}, CSS));
    const renderer = new Renderer(canvas);

    const restartBtn = el('button', { class: 'ck-icon ck-restart', 'aria-label': 'Restart level', html: ICONS.restart, onclick: () => confirmRestart() });
    const gear = el('button', { class: 'ck-icon ck-gear', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openSettings() });
    const levelPill = el('div', { class: 'ck-level' });
    const hardBadge = el('div', { class: 'ck-hard' }, el('i', { html: ICONS.skull }), el('b', {}, 'HARD'));
    const coinText = el('span');
    const coins = el('div', { class: 'ck-coins' }, el('i', { html: ICONS.coin }), coinText);
    const modeTip = el('div', { class: 'ck-tip' });
    const intro = el('div', { class: 'ck-intro', 'data-over-level': '' }, el('i', { html: ICONS.skull }), el('b', {}, 'HARD LEVEL'));
    const turboBadge = el('div', { class: 'ck-turbo', 'aria-hidden': 'true' }, '»');
    const boosterBtns = {};
    const badges = {};
    for (const [key, x] of [['fill', 270], ['lift', 540], ['balloon', 810]]) {
      badges[key] = el('b', { class: 'ck-badge' });
      boosterBtns[key] = el(
        'button',
        { class: 'ck-boost', style: `left:${x - 72}px`, 'aria-label': boosterName(key), onclick: () => useBooster(key) },
        el('i', { html: ICONS[key] }),
        badges[key],
      );
    }
    stage.append(restartBtn, gear, levelPill, hardBadge, coins, modeTip, turboBadge, intro, ...Object.values(boosterBtns));

    // ---- state ----
    let level;
    let sim;
    let mode = null; // 'lift' | 'fill' | null
    let overlay = null;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let endTimer = 0;
    let saveTimer = 0;
    let uiKey = '';
    let turbo = false;

    function persist() {
      const ip = sim && sim.status === 'playing' ? { level: level.n, gen: LEVEL_GEN, sim: sim.serialize() } : null;
      // the daily puzzle keeps its own in-progress slot, so the campaign's is never touched (E2)
      if (level?.daily) save.daily.inProgress = ip && { ...ip, date: level.daily };
      else save.inProgress = ip;
      ctx.store.set(save);
    }

    // Won but not yet recorded (the end screen, which records it, isn't up): switching levels then would cancel the
    // pending win, so startLevel waits and leaving the game records it first (E2 verifiers).
    const winUnrecorded = () => sim?.status === 'won' && !overlay;
    // n: a campaign level number, or a 'YYYY-MM-DD' date for that day's daily puzzle
    function startLevel(n, resume) {
      if (winUnrecorded()) return; // a won level's result is recorded first (showWin), then any button may move on
      if (level && sim) persist(); // save the level being left (taps only save every 5 s), daily or campaign
      clearTimeout(endTimer);
      closeOverlay();
      level = typeof n === 'string' ? generateDaily(n) : generateLevel(n);
      sim = createSim(level);
      if (resume) {
        try {
          sim.load(resume);
        } catch (e) {
          console.warn('could not resume, restarting level', e);
          sim = createSim(level);
        }
      }
      setTurbo(false);
      renderer.setLevel(level, sim);
      setMode(null);
      document.body.style.background = '#7f4645';
      if (level.hard && !resume) {
        intro.classList.remove('show');
        void intro.offsetWidth; // restart the animation
        intro.classList.add('show');
      }
      updateHud(true);
      persist();
    }

    // ---- layout ----
    function resize() {
      const w = root.clientWidth || innerWidth;
      const h = root.clientHeight || innerHeight;
      renderer.resize(w, h, canvasDpr(fitStage(w, h, FIT).scale));
      stage.style.transform = `translate(${renderer.offX}px, ${renderer.offY}px) scale(${renderer.scale})`;
    }

    // ---- HUD ----
    const waiting = () => sim.slots.some((s) => s && s.doneAt < 0);
    function updateHud(force) {
      const key = [level.n, save.coins, mode, waiting(), sim.supply.hooksFree(), sim.slots.indexOf(null) >= 0, sim.status, ...Object.values(save.boosters)].join();
      if (!force && key === uiKey) return;
      uiKey = key;
      levelPill.textContent = level.daily ? 'Daily' : `Level ${level.n}`;
      hardBadge.classList.toggle('show', !!level.hard);
      coinText.textContent = save.coins.toLocaleString('en');
      for (const k of Object.keys(boosterBtns)) {
        const n = save.boosters[k];
        badges[k].textContent = n > 0 ? n : '+';
        boosterBtns[k].classList.toggle('on', mode === k);
      }
      boosterBtns.fill.classList.toggle('dim', !waiting());
      boosterBtns.lift.classList.toggle('dim', !sim.hasFreeSlot());
      boosterBtns.balloon.classList.toggle('dim', sim.supply.hooksFree() === 0);
    }

    // First levels: a one-line tip until the first pick.
    const TIPS = {
      1: 'Tap a standing bobbin to send it to a slot',
      2: 'Matching yarn unravels from the bottom of the picture',
    };
    function setMode(m) {
      mode = m;
      const tip = !m && sim.board.picks === 0 && !level.daily ? TIPS[level.n] : '';
      modeTip.textContent = m === 'fill' ? 'Tap a bobbin in a slot: scissors cut its yarn from anywhere' : m === 'lift' ? 'Tap any bobbin to pull it straight to a slot' : tip || '';
      modeTip.classList.toggle('show', !!m || !!tip);
      renderer.liftMode = m === 'lift';
      renderer.fillMode = m === 'fill';
      updateHud();
    }

    const offSettings = S.onChange((key) => {
      if (key === 'colourblind' || key === 'reducedMotion') applyOptions();
      updateHud(true);
    });

    function applyOptions() {
      renderer.setOptions({ colourblind: S.get('colourblind'), reducedMotion: S.get('reducedMotion') });
      root.classList.toggle('ck-rm', !!S.get('reducedMotion'));
    }

    // ---- boosters ----
    function spend(key) {
      if (save.boosters[key] > 0) {
        save.boosters[key]--;
        return true;
      }
      return false;
    }

    function offerBuy(key, then) {
      if (save.coins < PRICE) {
        toast(`No ${boosterName(key)} left. Clear levels to earn coins (${PRICE} buys one).`, 2400);
        return;
      }
      modal({
        title: `Buy ${boosterName(key)}?`,
        body: [el('p', { class: 'ck-p' }, `${PRICE} coins for one. You have ${save.coins}.`)],
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
              then?.();
            },
          },
        ],
      });
    }

    function useBooster(key) {
      if (sim.status !== 'playing' || overlay) return;
      if (mode === key) return setMode(null);
      if (save.boosters[key] <= 0) return offerBuy(key, () => useBooster(key));
      if (key === 'lift') {
        if (!sim.hasFreeSlot()) return toast('No free slot');
        setMode('lift');
      } else if (key === 'fill') {
        const slotted = sim.slots.map((s, i) => (s && s.doneAt < 0 ? i : -1)).filter((i) => i >= 0);
        if (!slotted.length) return toast('Put a bobbin in a slot first');
        if (slotted.length === 1) doFill(slotted[0]);
        else setMode('fill');
      } else if (key === 'balloon') {
        if (!sim.supply.hooksFree()) return toast('Both hooks are full');
        if (sim.supply.balloon(sim.waitingColours()).length && spend('balloon')) {
          sim.boostersUsed++;
          sounds.booster();
          persist();
        } else toast('No idle bottom block to lift');
      }
      updateHud();
    }

    function doFill(s) {
      // scissors: cut at thread speed-ish, not instantly (ref 5.2)
      if (sim.fill(s, 0.07, 0.35) && spend('fill')) {
        sounds.snip();
        persist();
      }
      setMode(null);
    }

    // ---- input ----
    canvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (overlay || sim.status !== 'playing') return;
      const [x, y] = renderer.toDesign(ev.clientX, ev.clientY, canvas.getBoundingClientRect());
      const now = performance.now() / 1000;
      if (mode === 'fill') {
        const s = renderer.hitSlot(x, y);
        if (s >= 0 && sim.slots[s] && sim.slots[s].doneAt < 0) doFill(s);
        else setMode(null);
        return;
      }
      const cell = renderer.hitCell(x, y);
      if (cell < 0) {
        if (mode) setMode(null);
        return;
      }
      const lift = mode === 'lift';
      const r = sim.pick(cell, lift);
      if (r === 'ok') {
        if (!mode && modeTip.classList.contains('show')) setMode(null);
        if (lift) {
          spend('lift');
          sounds.booster();
          setMode(null);
        }
        persist();
      } else if (r === 'blocked' || r === 'locked') {
        renderer.shake(cell, now);
        sounds.error();
      } else if (r === 'full') {
        renderer.shakeSlots(now);
        sounds.error();
        toast('No free slot');
      }
    });

    // ---- end screens ----
    function closeOverlay() {
      overlay?.remove();
      overlay = null;
    }

    const clearProgress = () => clearInProgress(save, level);
    // The level again from the start (daily or campaign), and the way back from a daily to the campaign.
    const restart = () => startLevel(level.daily || level.n);
    function backToLevels() {
      const ip = save.inProgress;
      startLevel(save.level, ip && ip.level === save.level && ip.gen === LEVEL_GEN ? ip.sim : null);
    }
    function startToday() {
      const today = localDate();
      const ip = save.daily.inProgress;
      startLevel(today, ip?.date === today && ip.gen === LEVEL_GEN ? ip.sim : null);
    }

    // The daily puzzle's win: only save.daily changes (core/daily.js winDaily): no coins, no campaign level, no
    // cleared count or gift. No stars in this game, so a win without boosters counts as 3 and any other as 1.
    function showDailyWin() {
      save.daily = winDaily(save, level.daily, sim.boostersUsed === 0 ? 3 : 1).daily;
      ctx.store.set(save);
      sounds.win();
      const streak = currentStreak(save.daily, save.daily.lastDate); // the streak as it now stands
      overlay = el(
        'div',
        { class: 'ck-end ck-win' },
        el('h1', { class: 'ck-stamp' }, 'DAILY', el('br'), 'DONE!'),
        el('p', { class: 'ck-reward' }, `Streak: ${streak} day${streak === 1 ? '' : 's'}`),
        el('p', { class: 'ck-note' }, level.daily),
        el('button', { class: 'ck-btn ck-green', onclick: backToLevels }, 'Levels'),
      );
      stage.append(overlay);
      updateHud(true);
    }

    function showWin() {
      if (level.daily) return showDailyWin();
      const reward = level.hard ? HARD_REWARD : REWARD;
      const from = save.coins;
      save.coins += reward;
      save.cleared++;
      let gift = null;
      if (save.cleared % FREE_BOOSTER_EVERY === 0) {
        gift = ['fill', 'lift', 'balloon'][(save.cleared / FREE_BOOSTER_EVERY) % 3];
        save.boosters[gift]++;
      }
      save.level = level.n + 1;
      clearProgress();
      ctx.store.set(save);
      sounds.win();
      overlay = el(
        'div',
        { class: 'ck-end ck-win' },
        el('h1', { class: 'ck-stamp' }, 'LEVEL', el('br'), 'COMPLETE!'),
        el('div', { class: 'ck-trophy' }, el('div', { class: 'ck-glow' }), el('i', { html: ICONS.trophy }), el('b', {}, 'Reward')),
        el('p', { class: 'ck-reward' }, el('i', { html: ICONS.coin }), String(reward)),
        gift ? el('p', { class: 'ck-note' }, `Bonus: +1 ${boosterName(gift)}`) : null,
        el('button', { class: 'ck-btn ck-green', onclick: () => startLevel(save.level) }, 'Next'),
      );
      stage.append(overlay);
      // coins count up into the pill
      const t0 = performance.now();
      const tick = () => {
        const k = Math.min(1, (performance.now() - t0 - 1300) / 900);
        coinText.textContent = Math.round(from + reward * Math.max(0, k)).toLocaleString('en');
        if (k < 1 && overlay) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      uiKey = 'win';
    }

    // Out of space (ref 4.1): the panel offers Continue (an 8th slot, for coins) or Give Up.
    function showLose() {
      sounds.lose();
      const canSlot = sim.slots.length < sim.cfg.maxSlots;
      const afford = save.coins >= PRICE;
      const cont = () => {
        if (!afford) return;
        save.coins -= PRICE;
        if (sim.addSlot()) sounds.booster();
        closeOverlay();
        persist();
        updateHud(true);
      };
      overlay = el(
        'div',
        { class: 'ck-end ck-dim' },
        el(
          'div',
          { class: 'ck-card' },
          el('h1', {}, 'OUT OF SPACE'),
          el('div', { class: 'ck-mini' }, sim.slots.map((sl) => el('i', { style: sl ? `background:${COLORS[sl.color].bobbin}` : '' }))),
          el('p', {}, canSlot ? 'Open one more slot and keep playing' : 'Every slot is waiting for a colour the picture is not showing'),
          el(
            'div',
            { class: 'ck-row' },
            el('button', { class: 'ck-btn ck-red', onclick: () => showFailed() }, 'Give Up'),
            canSlot
              ? el('button', { class: `ck-btn ck-yellow${afford ? '' : ' ck-off'}`, onclick: cont }, 'Continue ', el('i', { html: ICONS.coin }), String(PRICE))
              : null,
          ),
          canSlot && !afford ? el('p', { class: 'ck-small' }, `You have ${save.coins} coins`) : null,
        ),
      );
      stage.append(overlay);
    }

    function showFailed() {
      closeOverlay();
      clearProgress();
      ctx.store.set(save);
      overlay = el(
        'div',
        { class: 'ck-end ck-dark' },
        el('h1', { class: 'ck-failed' }, 'LEVEL FAILED'),
        el('div', { class: 'ck-heart' }, '\u{1F494}'),
        el('p', {}, 'You did not complete the level goals'),
        el('button', { class: 'ck-btn ck-green', onclick: restart }, 'Try Again'),
      );
      stage.append(overlay);
    }

    function confirmRestart() {
      if (sim.board.picks === 0 || sim.status !== 'playing') return restart();
      modal({ title: 'Restart level?', actions: [{ label: 'Cancel' }, { label: 'Restart', primary: true, onClick: (close) => (close(), restart()) }] });
    }

    function openSettings() {
      ctx.openSettings([
        { label: 'Restart level', onClick: (close) => (close(), restart()) },
        level.daily
          ? { label: 'Back to levels', onClick: (close) => (close(), backToLevels()) }
          : { label: "Today's puzzle", onClick: (close) => (close(), startToday()) },
      ]);
    }

    function setTurbo(on) {
      turbo = on;
      renderer.rate = on ? TURBO : 1;
      turboBadge.classList.toggle('show', on);
    }

    // ---- loop ----
    let lastUnravel = 0;
    function handleEvents(now) {
      for (const e of sim.events) {
        renderer.onEvent(e, now);
        switch (e.type) {
          case 'pick':
            sounds.pick();
            if (e.info.ejects.length) sounds.eject();
            break;
          case 'thread':
            sounds.thread();
            break;
          case 'land':
            if (now - lastUnravel > 0.09) {
              lastUnravel = now;
              sounds.stitch(e.landed / BOBBIN_ROWS);
            }
            break;
          case 'slotFree':
            sounds.complete();
            break;
          case 'reveal':
            sounds.reveal();
            break;
          case 'park':
            sounds.balloon();
            break;
          case 'win':
            clearProgress();
            endTimer = setTimeout(showWin, 500);
            break;
          case 'lose':
            persist();
            for (let s = 0; s < sim.slots.length; s++) setTimeout(() => sim.status === 'lost' && sounds.topple(), (0.1 + s * 0.18) * 1000);
            endTimer = setTimeout(() => sim.status === 'lost' && !overlay && showLose(), TOPPLE * 1000);
            break;
        }
      }
      sim.events.length = 0;
    }

    function loop(t) {
      raf = requestAnimationFrame(loop);
      const now = t / 1000;
      const dt = Math.min(0.1, now - (last || now));
      last = now;
      acc += dt;
      if (!turbo && sim.status === 'playing' && sim.winLocked()) setTurbo(true);
      else if (turbo && sim.status !== 'playing') setTurbo(false);
      const rate = turbo ? TURBO : 1;
      let steps = 0;
      while (acc >= DT && steps < 8) {
        for (let k = 0; k < rate && sim.status === 'playing'; k++) sim.step();
        acc -= DT;
        steps++;
      }
      if (steps === 8) acc = 0;
      if (autoplay) autoStep();
      handleEvents(now);
      renderer.frame(now, dt);
      if (!overlay) updateHud();
    }

    // ?autoplay=1 plays the solver's solution (for testing the render and feel headlessly)
    const params = new URLSearchParams(location.search);
    const autoplay = params.has('autoplay');
    let autoK = 0;
    let autoLevel = -1;
    if (autoplay || params.has('debug')) window.__ck = () => ({ sim, level, save, renderer });
    function autoStep() {
      if (autoLevel !== level.n) {
        autoLevel = level.n;
        autoK = 0;
      }
      const picks = level.meta?.solution || [];
      if (sim.status === 'playing' && autoK < picks.length && sim.hasFreeSlot() && sim.isSettled()) {
        if (sim.pick(picks[autoK]) === 'ok') autoK++;
      }
    }

    const onVis = () => {
      if (document.hidden) persist();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', persist);
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    saveTimer = setInterval(persist, 5000);

    applyOptions();
    resize();
    const ip = save.inProgress;
    const jump = +params.get('level'); // ?level=N to jump (testing)
    if (jump > 0) save.level = jump;
    const dailyParam = new URLSearchParams(location.search).get('daily'); // ?daily=YYYY-MM-DD opens that day's puzzle
    if (isDate(dailyParam)) startLevel(dailyParam);
    else startLevel(save.level, !jump && ip && ip.level === save.level && ip.gen === LEVEL_GEN ? ip.sim : null);
    raf = requestAnimationFrame(loop);

    return {
      unmount() {
        if (winUnrecorded()) showWin(); // leaving during the win animation still records the win
        persist();
        cancelAnimationFrame(raf);
        clearInterval(saveTimer);
        clearTimeout(endTimer);
        ro.disconnect();
        offSettings();
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pagehide', persist);
        document.body.style.background = '';
      },
    };
  },
};

const boosterName = (k) => ({ fill: 'Scissors', lift: 'Bobbin pull', balloon: 'Balloon' })[k];

const CSS = `
.ck-canvas { position: absolute; inset: 0; touch-action: none; }
.ck-stage { position: absolute; left: 0; top: 0; width: 1080px; height: 2316px; transform-origin: 0 0; pointer-events: none;
  font-family: ui-rounded, 'Arial Rounded MT Bold', system-ui, Roboto, sans-serif; font-weight: 900; color: #fff; }
.ck-stage :where(button) { pointer-events: auto; border: 0; padding: 0; font: inherit; color: inherit; background: none; }
.ck-icon { position: absolute; top: 80px; width: 84px; height: 84px; filter: drop-shadow(0 4px 0 #0004); }
.ck-icon svg { width: 100%; height: 100%; }
.ck-restart { left: 18px; }
.ck-gear { left: 106px; }
.ck-level { position: absolute; left: 12px; top: 200px; padding: 6px 22px; border-radius: 16px; background: #5a4a4ad0; font-size: 38px;
  box-shadow: inset 0 -4px 0 #0003; }
.ck-hard { position: absolute; left: 22px; top: 270px; width: 120px; display: none; flex-direction: column; align-items: center; }
.ck-hard.show { display: flex; }
.ck-hard i { width: 90px; height: 90px; filter: drop-shadow(0 4px 0 #0005); }
.ck-hard i svg { width: 100%; height: 100%; }
.ck-hard b { margin-top: -18px; font-size: 30px; -webkit-text-stroke: 8px #8a1010; paint-order: stroke fill; }
.ck-coins { position: absolute; right: 24px; top: 92px; height: 72px; min-width: 220px; padding: 0 22px 0 80px; border-radius: 36px;
  background: #3a2a2ad0; font-size: 42px; display: flex; align-items: center; justify-content: flex-end; }
.ck-coins i { position: absolute; left: -10px; top: -8px; width: 88px; height: 88px; }
.ck-coins svg, .ck-boost i svg, .ck-btn i svg, .ck-reward i svg { width: 100%; height: 100%; display: block; }
.ck-tip { position: absolute; left: 40px; right: 40px; top: 790px; text-align: center; font-size: 38px; opacity: 0; transition: opacity .2s;
  -webkit-text-stroke: 9px #5a2424; paint-order: stroke fill; }
.ck-tip.show { opacity: 1; }
.ck-boost { position: absolute; top: 1956px; width: 144px; height: 144px; border-radius: 50%;
  background: radial-gradient(circle at 45% 35%, #fffaf0, #ecdcc4 70%); border: 8px solid #d8b78a; box-shadow: 0 8px 0 #0005; }
.ck-boost > i { position: absolute; inset: 22px; }
.ck-boost.dim { filter: grayscale(.6) brightness(.85); opacity: .6; }
.ck-boost.on { box-shadow: 0 0 0 10px #4fd8f0, 0 0 40px 16px #4fd8f088; animation: ck-pulse .8s infinite alternate; }
.ck-badge { position: absolute; right: -10px; bottom: -6px; min-width: 56px; height: 56px; border-radius: 28px; background: #fff;
  color: #4a3a3a; border: 4px solid #d8b78a; font-size: 32px; display: flex; align-items: center; justify-content: center; padding: 0 6px; }
.ck-turbo { position: absolute; right: 40px; top: 880px; font-size: 96px; color: #ffd84a; -webkit-text-stroke: 12px #7a3d00; paint-order: stroke fill;
  opacity: 0; transition: opacity .2s; }
.ck-turbo.show { opacity: 1; animation: ck-ff .5s infinite alternate; }
.ck-intro { position: absolute; left: 0; right: 0; top: 900px; display: flex; flex-direction: column; align-items: center; opacity: 0; }
.ck-intro i { width: 300px; height: 300px; }
.ck-intro i svg { width: 100%; height: 100%; }
.ck-intro b { font-size: 96px; -webkit-text-stroke: 16px #8a1010; paint-order: stroke fill; margin-top: -40px; }
.ck-intro.show { animation: ck-intro 1.4s forwards; }
.ck-rm .ck-intro.show { animation: ck-fadeout 1.2s forwards; }
.ck-rm .ck-boost.on, .ck-rm .ck-turbo.show { animation: none; }
@keyframes ck-intro { 0% { opacity: 0; transform: scale(.6); } 15% { opacity: 1; transform: scale(1.05); } 30%,70% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: translate(-460px, -620px) scale(.25); } }
@keyframes ck-fadeout { 0%,70% { opacity: 1; } 100% { opacity: 0; } }
@keyframes ck-pulse { to { transform: scale(1.06); } }
@keyframes ck-ff { to { transform: translateX(14px); } }

.ck-end { position: absolute; inset: 0; box-shadow: 0 0 0 3000px var(--edge, transparent); pointer-events: auto; display: flex; flex-direction: column; align-items: center; animation: ck-fade .3s; }
.ck-win { --edge: #2a1414f0; background: radial-gradient(circle closest-side at 50% 45%, #6a3a3ae0, #2a1414f0 70%); padding-top: 360px; }
.ck-stamp { margin: 0; text-align: center; font-size: 130px; line-height: 1; color: #ffd84a; -webkit-text-stroke: 18px #7a3d00; paint-order: stroke fill;
  transform: rotate(-6deg); animation: ck-stamp .35s cubic-bezier(.2,1.6,.5,1); }
.ck-trophy { position: relative; margin-top: 70px; width: 360px; height: 360px; display: flex; flex-direction: column; align-items: center;
  animation: ck-pop .4s .9s backwards; }
.ck-trophy i { position: relative; width: 300px; height: 300px; }
.ck-trophy i svg { width: 100%; height: 100%; }
.ck-trophy b { position: relative; margin-top: -40px; padding: 8px 60px; background: #d8303a; border-radius: 10px; font-size: 44px; box-shadow: 0 6px 0 #7a1010; }
.ck-glow { position: absolute; left: 50%; top: 45%; width: 900px; height: 900px; margin: -450px; border-radius: 50%; opacity: .3;
  background: repeating-conic-gradient(#ffd84a 0 8deg, transparent 8deg 24deg); animation: ck-spin 18s linear infinite; }
.ck-rm .ck-glow { animation: none; }
.ck-reward { display: flex; align-items: center; gap: 16px; font-size: 80px; margin: 50px 0 0; -webkit-text-stroke: 12px #5a3500; paint-order: stroke fill;
  animation: ck-pop .3s 1.2s backwards; }
.ck-reward i { width: 90px; height: 90px; }
.ck-note { font-size: 40px; margin: 16px 0 0; }
.ck-btn { position: relative; margin-top: 70px; min-width: 380px; height: 130px; border-radius: 40px !important; padding: 0 44px !important;
  font-size: 58px !important; display: flex; align-items: center; justify-content: center; gap: 10px; color: #fff !important;
  -webkit-text-stroke: 10px #0006; paint-order: stroke fill; box-shadow: 0 10px 0 #0005; }
.ck-btn i { width: 64px; height: 64px; }
.ck-green { background: linear-gradient(#7ad84a, #3f9a26) !important; border: 6px solid #2a6a14 !important; }
.ck-red { background: linear-gradient(#ff6a5a, #d0283a) !important; border: 6px solid #7a1010 !important; min-width: 320px !important; }
.ck-row .ck-btn { white-space: nowrap; font-size: 50px !important; padding: 0 30px !important; }
.ck-yellow { background: linear-gradient(#ffe066, #f2b21a) !important; border: 6px solid #a8700a !important; min-width: 360px !important; }
.ck-off { filter: grayscale(.8); opacity: .6; }
.ck-dim { --edge: #1a0a0ac8; background: #1a0a0ac8; justify-content: center; }
.ck-dark { --edge: #1a0e14f2; background: #1a0e14f2; justify-content: center; }
.ck-card { width: 900px; background: linear-gradient(#f9eee0, #ead6bd); border: 14px solid #c98b61; border-radius: 50px; padding: 50px 40px 60px;
  display: flex; flex-direction: column; align-items: center; color: #5a3a2a; animation: ck-pop .3s; }
.ck-card h1 { margin: 0; font-size: 92px; color: #fff; -webkit-text-stroke: 16px #a8303a; paint-order: stroke fill; }
.ck-card p { font-size: 42px; text-align: center; margin: 30px 0 0; font-weight: 800; }
.ck-small { font-size: 32px !important; margin-top: 16px !important; }
.ck-row { display: flex; gap: 30px; }
.ck-mini { display: flex; gap: 12px; margin-top: 40px; padding: 16px; border-radius: 20px; background: #d9b9a0; }
.ck-mini i { width: 86px; height: 72px; border-radius: 14px; background: #e2e0de; box-shadow: inset 0 -10px 0 #0003; }
.ck-failed { margin: 0; font-size: 110px; color: #fff; -webkit-text-stroke: 18px #a8303a; paint-order: stroke fill; }
.ck-heart { font-size: 300px; line-height: 1.1; margin-top: 40px; }
.ck-dark p { font-size: 46px; margin: 20px 0 0; }
.ck-p { font-size: 17px; text-align: center; margin: 0; }
@keyframes ck-fade { from { opacity: 0; } }
@keyframes ck-pop { from { transform: scale(.7); opacity: 0; } }
@keyframes ck-stamp { from { transform: rotate(-6deg) scale(2.2); opacity: 0; } }
@keyframes ck-spin { to { transform: rotate(360deg); } }
`;
