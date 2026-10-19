// Beadloom: game module. Canvas playfield (render.js) plus a DOM overlay scaled to the same
// 1080x2316 design space for the HUD, boosters and end screens. Fixed-step sim, rAF render.

import { createSim, generateLevel, generateDaily, difficulty, CRATE_ROWS } from './rules.js';
import { clearInProgress, cleanDaily, currentStreak, freshDaily, isDate, localDate, winDaily } from '../../core/daily.js';
import { DT } from '../../engines/slotsort/sim.js';
import { Renderer, FIT } from './render.js';
import { fitStage, canvasDpr } from '../../core/stage.js';
import { cleanSave } from '../../core/save.js';
import { makeSounds } from './sounds.js';
import { THEMES, COLORS } from './colors.js';

const REWARD = 25;
const PRICE = 100; // coins per booster
const START_BOOSTERS = { slot: 3, lift: 3, fill: 3 };
const FREE_BOOSTER_EVERY = 3; // levels
const SPEED_CYCLE = ['slow', 'normal', 'double', 'fast'];
const SPEED_LABEL = { slow: 'Slow', normal: 'x1', double: 'x2', fast: 'x4' };
const SPEED_CHIP = { slow: 'Slow Mode', normal: 'Speed Mode', double: 'Quick Mode', fast: 'Fast Mode' };
const BOOSTER_SLOTS = 5; // the +1 booster stops here; Add space after Out of space may go one further
const IDLE_HINT = 9; // seconds without a tap before the booster arrows show
const LEVEL_GEN = 2; // bump when the generator changes: an in-progress save of an older level restarts
const TURBO = 4; // once the win is unavoidable the belt runs at 4x the player's speed

const ICONS = {
  gear: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="none" stroke="#f3b62a" stroke-width="12" stroke-dasharray="8.4 7.3"/><circle cx="32" cy="32" r="17" fill="#f3b62a"/><circle cx="32" cy="32" r="8" fill="#2a56a6"/></svg>`,
  slot: `<svg viewBox="0 0 64 64"><rect x="10" y="10" width="44" height="44" rx="8" fill="#2f7be0" stroke="#fff" stroke-width="4"/><text x="32" y="43" font-size="28" font-weight="900" text-anchor="middle" fill="#fff" font-family="system-ui,Roboto,sans-serif">+1</text></svg>`,
  lift: `<svg viewBox="0 0 64 64"><rect x="12" y="26" width="40" height="30" rx="7" fill="#d9363e" stroke="#7a1418" stroke-width="3"/><rect x="17" y="30" width="30" height="12" rx="4" fill="#f0f0f4" opacity=".7"/><path d="M22 24V8M16 14l6-7 6 7M42 24V8M36 14l6-7 6 7" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  fill: `<svg viewBox="0 0 64 64"><rect x="10" y="22" width="44" height="34" rx="7" fill="#2f6fe0" stroke="#173a80" stroke-width="3"/><g fill="#7fb2ff" stroke="#173a80" stroke-width="1.5"><circle cx="20" cy="20" r="6"/><circle cx="32" cy="16" r="6"/><circle cx="44" cy="20" r="6"/><circle cx="26" cy="27" r="6"/><circle cx="38" cy="27" r="6"/></g></svg>`,
  skull: `<svg viewBox="0 0 64 64"><path d="M32 6C18 6 9 15 9 28c0 8 4 13 9 16v8c0 3 2 5 5 5h18c3 0 5-2 5-5v-8c5-3 9-8 9-16C55 15 46 6 32 6z" fill="#f4f1ea" stroke="#3a2a2a" stroke-width="3"/><path d="M17 30c2-6 11-6 12 1-2 5-10 6-12-1zM35 31c1-7 10-7 12-1-2 7-10 6-12 1z" fill="#ff7a1a"/><path d="M20 30c2-3 6-3 7 1-2 3-6 3-7-1zM37 31c1-4 5-4 7-1-1 4-5 4-7 1z" fill="#ffd84a"/><path d="M29 41l3-5 3 5z" fill="#3a2a2a"/><path d="M24 50v6M32 50v6M40 50v6" stroke="#3a2a2a" stroke-width="3"/></svg>`,
  coin: `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#e9a21a"/><circle cx="32" cy="32" r="21" fill="#ffd84a"/><circle cx="27" cy="26" r="6" fill="#fff6" /></svg>`,
};

function freshSave() {
  return { level: 1, coins: 0, boosters: { ...START_BOOSTERS }, cleared: 0, inProgress: null, daily: freshDaily() };
}

export default {
  settings: [
    { key: 'speed', label: 'Speed', options: [['slow', 'Super slow'], ['normal', 'Normal'], ['double', 'Double (x2)'], ['fast', 'Fast (x4)']], default: 'normal' },
  ],

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
    const canvas = el('canvas', { class: 'bo-canvas' });
    const stage = el('div', { class: 'bo-stage' });
    root.append(canvas, stage, el('style', {}, CSS));
    const renderer = new Renderer(canvas);

    const gear = el('button', { class: 'bo-gear', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openSettings() });
    const levelText = el('span');
    const levelTag = el('em', { class: 'bo-tag' });
    const levelPill = el('div', { class: 'bo-level' }, el('i', { class: 'bo-skull', html: ICONS.skull }), levelText, levelTag);
    const coinText = el('span');
    const coins = el('div', { class: 'bo-coins' }, coinText, el('i', { html: ICONS.coin }));
    const speedKnob = el('i');
    const speedLabel = el('b');
    const speedChip = el('em', { class: 'bo-chip' });
    const speedBtn = el(
      'button',
      { class: 'bo-speed', 'aria-label': 'Speed', onclick: () => cycleSpeed() },
      el('span', {}, 'Speed'),
      el('div', { class: 'bo-pill' }, speedLabel, speedKnob),
      speedChip,
    );
    const modeTip = el('div', { class: 'bo-tip' });
    // Move Box tooltip while the lift booster is armed (ref C.3)
    const liftTip = el(
      'div',
      { class: 'bo-tooltip' },
      el('i', { html: ICONS.lift }),
      el('div', {}, el('b', {}, 'Move Box'), el('span', {}, 'Pick a blocked crate and send it to a slot')),
      el('button', { class: 'bo-x', 'aria-label': 'Cancel', onclick: () => setMode(null) }, '\u00d7'),
    );
    const turboBadge = el('div', { class: 'bo-turbo', 'aria-hidden': 'true' }, '\u00bb', el('small', {}, `x${TURBO}`));
    const boosterBtns = {};
    const badges = {};
    for (const [key, x] of [['slot', 289], ['lift', 539], ['fill', 789]]) {
      badges[key] = el('b', { class: 'bo-badge' });
      boosterBtns[key] = el(
        'button',
        { class: 'bo-boost', style: `left:${x - 85}px`, 'aria-label': key, onclick: () => useBooster(key) },
        el('i', { html: ICONS[key] }),
        badges[key],
        el('em', { class: 'bo-arrow' }),
      );
    }
    stage.append(gear, levelPill, coins, speedBtn, turboBadge, modeTip, liftTip, ...Object.values(boosterBtns));

    // ---- state ----
    let level;
    let sim;
    let mode = null; // 'lift' | 'fill' | null
    let overlay = null;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let lastInput = 0;
    let lastHint = -99;
    let endTimer = 0;
    let saveTimer = 0;
    let uiKey = '';
    let turbo = false; // win unavoidable: fast-forward to the end

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
      sim.setSpeed(S.get('beadloom.speed', 'normal'));
      setTurbo(false);
      renderer.setLevel(level, sim);
      setMode(null);
      document.body.style.background = THEMES[level.theme % THEMES.length].bg;
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
    function updateHud(force) {
      const sp = S.get('beadloom.speed', 'normal');
      const slotted = sim.slots.some((s) => s && s.doneAt < 0);
      const key = [level.n, save.coins, sp, mode, slotted, sim.slots.length, sim.status, ...Object.values(save.boosters)].join();
      if (!force && key === uiKey) return;
      uiKey = key;
      levelText.textContent = level.daily ? 'Daily' : `Level ${level.n}`;
      const tag = levelTag_(level.n);
      levelTag.textContent = tag || '';
      levelPill.classList.toggle('hard', !!tag);
      speedChip.textContent = SPEED_CHIP[sp];
      coinText.textContent = save.coins;
      speedLabel.textContent = SPEED_LABEL[sp];
      speedBtn.dataset.speed = sp;
      for (const k of Object.keys(boosterBtns)) {
        const n = save.boosters[k];
        badges[k].textContent = n > 0 ? n : '+';
        boosterBtns[k].classList.toggle('on', mode === k);
      }
      boosterBtns.fill.classList.toggle('dim', !slotted);
      boosterBtns.slot.classList.toggle('dim', sim.slots.length >= BOOSTER_SLOTS);
    }

    // First levels: a one-line tip until the first pick.
    const TIPS = { 1: 'Tap a glowing crate to send it to a slot', 2: 'Beads of a crate\'s colour pour in as they pass the spout' };
    function setMode(m) {
      mode = m;
      const tip = !m && sim.board.picks === 0 && !level.daily ? TIPS[level.n] : '';
      modeTip.textContent = m === 'fill' ? 'Tap a crate in a slot to fill it' : m ? '' : tip || '';
      modeTip.classList.toggle('show', m === 'fill' || (!m && !!tip));
      liftTip.classList.toggle('show', m === 'lift');
      renderer.liftMode = m === 'lift';
      updateHud();
    }

    function cycleSpeed() {
      const cur = S.get('beadloom.speed', 'normal');
      S.set('beadloom.speed', SPEED_CYCLE[(SPEED_CYCLE.indexOf(cur) + 1) % SPEED_CYCLE.length]);
      ctx.haptics.buzz(8);
    }

    const offSettings = S.onChange((key, value) => {
      if (key === 'beadloom.speed') sim.setSpeed(value);
      if (key === 'colourblind' || key === 'reducedMotion') applyOptions();
      updateHud(true);
    });

    function applyOptions() {
      renderer.setOptions({ colourblind: S.get('colourblind'), reducedMotion: S.get('reducedMotion') });
      root.classList.toggle('bo-rm', !!S.get('reducedMotion'));
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
        body: [el('p', { class: 'bo-p' }, `${PRICE} coins for one. You have ${save.coins}.`)],
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
      lastInput = performance.now() / 1000;
      if (sim.status === 'won') return;
      if (mode === key) return setMode(null);
      if (save.boosters[key] <= 0) return offerBuy(key, () => useBooster(key));
      if (key === 'slot') {
        if (sim.slots.length >= BOOSTER_SLOTS) return toast('Already at the most slots');
        if (sim.addSlot(BOOSTER_SLOTS) && spend('slot')) {
          sounds.booster();
          closeOverlay();
          persist();
        }
      } else if (key === 'lift') {
        if (sim.status !== 'playing') return;
        if (!sim.hasFreeSlot()) return toast('No free slot');
        setMode('lift');
      } else if (key === 'fill') {
        if (sim.status !== 'playing') return;
        const slotted = sim.slots.map((s, i) => (s && s.doneAt < 0 ? i : -1)).filter((i) => i >= 0);
        if (!slotted.length) return toast('Put a crate in a slot first');
        if (slotted.length === 1) doFill(slotted[0]);
        else setMode('fill');
      }
      updateHud();
    }

    function doFill(s) {
      if (sim.fill(s) && spend('fill')) {
        sounds.booster();
        persist();
      }
      setMode(null);
    }

    // ---- input ----
    canvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      lastInput = performance.now() / 1000;
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
      } else if (r === 'blocked' || r === 'locked' || r === 'frozen') {
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
      startLevel(save.level, ip && ip.level === save.level && (ip.gen || 1) === LEVEL_GEN ? ip.sim : null);
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
        { class: 'bo-end bo-win' },
        el('h1', {}, 'Daily done'),
        el('p', { class: 'bo-reward' }, `Streak: ${streak} day${streak === 1 ? '' : 's'}`),
        el('p', { class: 'bo-note' }, level.daily),
        el('button', { class: 'bo-next', onclick: backToLevels }, 'Levels'),
      );
      stage.append(overlay);
      updateHud(true);
    }

    function showWin() {
      if (level.daily) return showDailyWin();
      const perfect = sim.boostersUsed === 0;
      const reward = perfect ? REWARD * 2 : REWARD;
      save.coins += reward;
      save.cleared++;
      let gift = null;
      if (save.cleared % FREE_BOOSTER_EVERY === 0) {
        gift = ['slot', 'lift', 'fill'][(save.cleared / FREE_BOOSTER_EVERY) % 3];
        save.boosters[gift]++;
      }
      save.level = level.n + 1;
      clearProgress();
      ctx.store.set(save);
      sounds.win();
      const pile = el('div', { class: 'bo-pile' });
      // a stacked pile: rows of 5, 4, 3, 2, 1 coins, bottom up
      for (let row = 0, n = 5; n > 0; row++, n--) {
        for (let j = 0; j < n; j++) {
          pile.append(el('i', { html: ICONS.coin, style: `left:${50 + (j - (n - 1) / 2) * 19}%;top:${86 - row * 17}%` }));
        }
      }
      overlay = el(
        'div',
        { class: 'bo-end bo-win' },
        el('div', { class: 'bo-burst' }),
        el('h1', {}, 'Congrats'),
        pile,
        el('p', { class: 'bo-reward' }, `+${reward} coins`),
        perfect ? el('p', { class: 'bo-note' }, 'No boosters used: double coins') : null,
        gift ? el('p', { class: 'bo-note' }, `Bonus: +1 ${boosterName(gift)}`) : null,
        el('button', { class: 'bo-next', onclick: () => startLevel(save.level) }, 'Next ', el('i', { html: ICONS.coin }), ` ${reward}`),
      );
      stage.append(overlay);
      updateHud(true);
    }

    // Out of space (ref C.4): the game dims around the lit slot row, with Add space (a +1 slot
    // booster, or coins) and an X that gives up to the Level failed card. Lives are left out.
    function showLose() {
      sounds.lose();
      const K = sim.slots.length;
      const canSlot = K < sim.cfg.maxSlots;
      const have = save.boosters.slot;
      const add = () => {
        if (save.boosters.slot > 0) {
          if (sim.addSlot() && spend('slot')) {
            sounds.booster();
            closeOverlay();
            persist();
          }
        } else if (save.coins >= PRICE) {
          save.coins -= PRICE;
          if (sim.addSlot()) sounds.booster();
          closeOverlay();
          persist();
        }
        updateHud(true);
      };
      const addBtn =
        canSlot && (have > 0 || save.coins >= PRICE)
          ? el('button', { class: 'bo-add', onclick: add }, 'Add space', el('small', {}, have > 0 ? `use +1 slot (${have} left)` : `${PRICE} coins`))
          : null;
      const band = el('div', { class: 'bo-band', style: `left:${540 - (K * 129) / 2 - 18}px;width:${K * 129 + 36}px` });
      overlay = el(
        'div',
        { class: 'bo-end bo-lose' },
        band,
        el('h1', { class: 'bo-oos' }, 'Out of space!'),
        addBtn,
        el('button', { class: 'bo-x bo-giveup', 'aria-label': 'Give up', onclick: () => showFailed() }, '\u00d7'),
      );
      if (!addBtn) return showFailed();
      stage.append(overlay);
    }

    function showFailed() {
      closeOverlay();
      overlay = el(
        'div',
        { class: 'bo-end bo-failed' },
        el(
          'div',
          { class: 'bo-card' },
          el('h1', {}, 'Level failed'),
          el('div', { class: 'bo-mini' }, sim.slots.map((sl) => el('i', { style: sl ? `background:${COLORS[sl.color].crate}` : '' }))),
          el('p', {}, 'Every slot is waiting for a colour the ring can no longer bring.'),
          el('button', { class: 'bo-next', onclick: restart }, 'Try again'),
        ),
      );
      stage.append(overlay);
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
    function handleEvents(now) {
      for (const e of sim.events) {
        renderer.onEvent(e, now);
        switch (e.type) {
          case 'pick':
            sounds.pick();
            if (e.info.toggled) sounds.swap();
            if (e.info.unlocked >= 0) sounds.unlock();
            if (e.info.ejects.length) sounds.eject();
            break;
          case 'land':
            sounds.bead(e.landed / CRATE_ROWS);
            break;
          case 'complete':
            sounds.complete();
            break;
          case 'slotFree':
            setTimeout(() => sounds.poof(), 400);
            break;
          case 'reveal':
          case 'feederReveal':
          case 'thaw':
            sounds.reveal();
            break;
          case 'win':
            clearProgress();
            endTimer = setTimeout(showWin, 900);
            break;
          case 'lose':
            persist();
            endTimer = setTimeout(() => sim.status === 'lost' && !overlay && showLose(), 700);
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
      // every crate placed and nothing can jam any more: run the belt at TURBO x
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
      // idle hint (ref C.3): no tap for a while -> point at the usable boosters
      if (sim.status === 'playing' && !overlay && !mode && now - lastInput > IDLE_HINT && now - lastHint > 14) {
        lastHint = now;
        root.classList.add('bo-hint');
        setTimeout(() => root.classList.remove('bo-hint'), 2200);
      }
      renderer.frame(now, dt);
      updateHud();
    }

    // ?autoplay=1 plays the solver's solution (for testing the render and feel headlessly)
    const autoplay = new URLSearchParams(location.search).has('autoplay');
    let autoK = 0;
    let autoLevel = -1;
    if (autoplay || new URLSearchParams(location.search).has('debug')) window.__bo = () => ({ sim, level, save, renderer });
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
    const jump = +new URLSearchParams(location.search).get('level'); // ?level=N to jump (testing)
    if (jump > 0) save.level = jump;
    const dailyParam = new URLSearchParams(location.search).get('daily'); // ?daily=YYYY-MM-DD opens that day's puzzle
    if (isDate(dailyParam)) startLevel(dailyParam);
    else startLevel(save.level, !jump && ip && ip.level === save.level && (ip.gen || 1) === LEVEL_GEN ? ip.sim : null);
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

// "Hard" on spike levels (every 10th), "Very Hard" once the spike tops the curve (ref C.1).
function levelTag_(n) {
  if (n % 10) return null;
  return difficulty(n) >= 0.9 ? 'Very Hard' : 'Hard';
}

const boosterName = (k) => ({ slot: '+1 slot', lift: 'Lift', fill: 'Fill' })[k];

const CSS = `
.bo-canvas { position: absolute; inset: 0; touch-action: none; }
.bo-stage { position: absolute; left: 0; top: 0; width: 1080px; height: 2316px; transform-origin: 0 0; pointer-events: none;
  font-family: ui-rounded, 'Arial Rounded MT Bold', system-ui, Roboto, sans-serif; font-weight: 900; color: #fff; }
.bo-stage :where(button) { pointer-events: auto; border: 0; padding: 0; font: inherit; color: inherit; background: none; }
.bo-gear { position: absolute; left: 52px; top: -146px; width: 96px; height: 96px; border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #3b74d0, #1d4796); border: 6px solid #f3b62a; box-shadow: 0 6px 0 #0003; }
.bo-gear svg { width: 70%; height: 70%; margin-top: 4px; }
.bo-level { position: absolute; left: 422px; top: -142px; width: 236px; height: 84px; border-radius: 26px;
  background: linear-gradient(#2f62c0, #1d4796); border: 5px solid #16367a; box-shadow: inset 0 4px 0 #ffffff30, 0 6px 0 #0003;
  display: flex; align-items: center; justify-content: center; font-size: 40px; text-shadow: 0 3px 0 #0005; }
.bo-level .bo-skull, .bo-level .bo-tag { display: none; }
.bo-level.hard { left: 400px; width: 280px; padding-left: 40px; background: linear-gradient(#e0404a, #a81c2c); border-color: #6a0c16; }
.bo-level.hard .bo-skull { display: block; position: absolute; left: -46px; top: -16px; width: 112px; height: 112px; filter: drop-shadow(0 4px 0 #0005); }
.bo-level.hard .bo-tag { display: block; position: absolute; left: 50%; top: 84px; transform: translateX(-50%); padding: 4px 22px 8px;
  border-radius: 0 0 18px 18px; background: #c0283c; font-style: normal; font-size: 28px; white-space: nowrap; }
.bo-chip { margin-top: 2px; padding: 4px 14px; border-radius: 12px; background: #2a3f8a; font-style: normal; font-size: 22px; color: #fff; }
.bo-tooltip { position: absolute; left: 120px; top: 310px; width: 600px; padding: 22px 70px 22px 150px; border-radius: 28px;
  background: linear-gradient(#fbf6e4, #e7dcc0); border: 6px solid #b89a5a; box-shadow: 0 10px 0 #0003; color: #3a2a1a;
  opacity: 0; transform: scale(.85); transition: opacity .15s, transform .15s; pointer-events: none; }
.bo-tooltip.show { opacity: 1; transform: none; pointer-events: auto; }
.bo-tooltip > i { position: absolute; left: 22px; top: 18px; width: 110px; height: 110px; }
.bo-tooltip > i svg { width: 100%; height: 100%; }
.bo-tooltip b { display: block; font-size: 52px; color: #fff; -webkit-text-stroke: 10px #4a2a10; paint-order: stroke fill; }
.bo-tooltip span { display: block; font-size: 30px; font-weight: 800; line-height: 1.15; }
.bo-x { position: absolute; width: 76px; height: 76px; border-radius: 50% !important; background: radial-gradient(circle at 40% 35%, #ff6a5a, #d0283a) !important;
  border: 6px solid #fff !important; color: #fff !important; font-size: 58px !important; line-height: 58px; box-shadow: 0 6px 0 #0004; }
.bo-tooltip .bo-x { right: -24px; top: -24px; }
.bo-tooltip:not(.show) .bo-x { pointer-events: none; }
.bo-coins { position: absolute; right: 60px; top: -138px; height: 76px; min-width: 210px; padding: 0 84px 0 24px; border-radius: 22px;
  background: linear-gradient(#fbf6e4, #e7dcc0); border: 5px solid #1d4796; color: #fff; font-size: 46px;
  display: flex; align-items: center; -webkit-text-stroke: 9px #2b2440; paint-order: stroke fill; }
.bo-coins i { position: absolute; right: -14px; top: -10px; width: 92px; height: 92px; }
.bo-coins svg, .bo-boost i svg, .bo-next i svg, .bo-pile i svg { width: 100%; height: 100%; display: block; }
.bo-speed { position: absolute; left: 20px; top: 780px; width: 180px; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.bo-speed span { font-size: 34px; color: #fff; -webkit-text-stroke: 8px #24306a; paint-order: stroke fill; }
.bo-pill { position: relative; width: 150px; height: 74px; border-radius: 37px; background: #5bcf3c; border: 5px solid #2e6fbf;
  box-shadow: inset 0 -6px 0 #0002; display: flex; align-items: center; padding-left: 14px; font-size: 34px; color: #fff;
  -webkit-text-stroke: 7px #1f5a16; paint-order: stroke fill; transition: background .2s; }
.bo-pill i { position: absolute; top: 7px; width: 50px; height: 50px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #fff, #c9cbd3);
  box-shadow: 0 2px 4px #0005; transition: left .2s; right: auto; }
.bo-speed[data-speed=slow] .bo-pill { background: #9aa3b8; padding-left: 64px; font-size: 28px; -webkit-text-stroke: 7px #404858; }
.bo-speed[data-speed=slow] .bo-pill i { left: 7px; }
.bo-speed[data-speed=normal] .bo-pill { padding-left: 22px; }
.bo-speed[data-speed=normal] .bo-pill i { left: 86px; }
.bo-speed[data-speed=double] .bo-pill { background: #f2c21b; padding-left: 22px; -webkit-text-stroke: 7px #7a5a00; }
.bo-speed[data-speed=double] .bo-pill i { left: 86px; }
.bo-speed[data-speed=fast] .bo-pill { background: #f39a1d; padding-left: 22px; -webkit-text-stroke: 7px #7a3d00; }
.bo-speed[data-speed=fast] .bo-pill i { left: 86px; }
.bo-turbo { position: absolute; left: 20px; top: 960px; width: 180px; text-align: center; font-size: 96px; line-height: 80px;
  color: #ffd84a; -webkit-text-stroke: 12px #7a3d00; paint-order: stroke fill; opacity: 0; transform: scale(.6); transition: opacity .2s, transform .2s; }
.bo-turbo small { display: block; font-size: 36px; line-height: 40px; -webkit-text-stroke: 8px #7a3d00; }
.bo-turbo.show { opacity: 1; transform: none; animation: bo-ff .5s infinite alternate; }
.bo-rm .bo-turbo.show { animation: none; }
@keyframes bo-ff { to { transform: translateX(14px); } }
.bo-tip { position: absolute; left: 0; right: 0; top: 1150px; text-align: center; font-size: 40px; opacity: 0; transition: opacity .2s;
  -webkit-text-stroke: 9px #24306a; paint-order: stroke fill; }
.bo-tip.show { opacity: 1; }
.bo-boost { position: absolute; top: 2080px; width: 170px; height: 170px; border-radius: 50%;
  background: radial-gradient(circle at 45% 35%, #7ee05a, #2f9a26 70%); border: 9px solid #f3b62a; box-shadow: 0 8px 0 #0004, inset 0 -8px 0 #0002; }
.bo-boost > i { position: absolute; inset: 22px; }
.bo-boost.dim { filter: grayscale(.7) brightness(.85); opacity: .55; }
.bo-boost.on { box-shadow: 0 0 0 10px #fff, 0 0 40px 18px #fff8; animation: bo-pulse .8s infinite alternate; }
.bo-badge { position: absolute; right: -8px; bottom: -4px; min-width: 62px; height: 62px; border-radius: 31px; background: #d6243f;
  border: 5px solid #fff; font-size: 36px; display: flex; align-items: center; justify-content: center; padding: 0 8px; }
.bo-arrow { position: absolute; left: 50%; top: -110px; width: 0; height: 0; margin-left: -34px; border: 34px solid transparent;
  border-top: 48px solid #ffcc1a; opacity: 0; }
.bo-hint .bo-boost:not(.dim) .bo-arrow { opacity: 1; animation: bo-bob .5s infinite alternate; }
.bo-rm .bo-arrow, .bo-rm .bo-boost.on { animation: none; }
@keyframes bo-bob { to { transform: translateY(18px); } }
@keyframes bo-pulse { to { transform: scale(1.06); } }

.bo-end { position: absolute; inset: 0; box-shadow: 0 0 0 3000px var(--edge, transparent); pointer-events: auto; display: flex; flex-direction: column; align-items: center; animation: bo-fade .3s; }
.bo-win { --edge: #0f2a62; background: radial-gradient(circle closest-side at 50% 42%, #2c7ff0 0, #18408f 40%, #0f2a62 75%); padding-top: 180px; }
.bo-burst { position: absolute; left: 50%; top: 42%; width: 1400px; height: 1400px; margin: -700px; border-radius: 50%; opacity: .25;
  background: repeating-conic-gradient(#fff 0 8deg, transparent 8deg 24deg); animation: bo-spin 18s linear infinite; }
.bo-rm .bo-burst { animation: none; }
.bo-end h1 { position: relative; font-size: 110px; margin: 0; color: #fff; -webkit-text-stroke: 16px #1b2550; paint-order: stroke fill; }
.bo-pile { position: relative; width: 520px; height: 420px; margin-top: 60px; }
.bo-pile i { position: absolute; width: 150px; height: 150px; margin: -75px; filter: drop-shadow(0 6px 0 #0004); }
.bo-reward { position: relative; font-size: 72px; margin: 40px 0 0; color: #ffd84a; -webkit-text-stroke: 12px #5a3500; paint-order: stroke fill; }
.bo-note { position: relative; font-size: 40px; margin: 16px 0 0; }
.bo-next { position: relative; color: #fff !important; margin-top: 80px; min-width: 420px; height: 140px; border-radius: 44px !important;
  background: linear-gradient(#41b6ff, #1f7fe0) !important; border: 7px solid #144a9a !important; box-shadow: 0 10px 0 #0005;
  font-size: 64px !important; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 0 40px !important;
  -webkit-text-stroke: 10px #10306a; paint-order: stroke fill; }
.bo-next i { width: 70px; height: 70px; }
.bo-lose { overflow: hidden; }
.bo-band { position: absolute; top: 1000px; height: 136px; border-radius: 26px; background: #ffffff38;
  box-shadow: 0 0 0 3000px #0a1030c0; }
.bo-oos { position: absolute !important; top: 330px; left: 0; right: 0; text-align: center; font-size: 120px !important;
  color: #ff6a5a !important; -webkit-text-stroke: 18px #5a1010 !important; animation: bo-pop .35s; }
.bo-add { position: absolute; left: 90px; width: 900px; top: 1560px; height: 210px; border-radius: 50px !important;
  background: linear-gradient(#a8ef3c, #5cbf1c) !important; border: 9px solid #f3b62a !important; box-shadow: 0 12px 0 #0005;
  font-size: 86px !important; color: #fff !important; -webkit-text-stroke: 14px #2a5a10; paint-order: stroke fill;
  display: flex; flex-direction: column; align-items: center; justify-content: center; animation: bo-pop .35s; }
.bo-add small { font-size: 40px; -webkit-text-stroke: 8px #2a5a10; }
.bo-giveup { left: 502px; top: 1830px; opacity: 0; animation: bo-show .3s .6s forwards; }
@keyframes bo-show { to { opacity: 1; } }
.bo-failed { --edge: #0a1030c0; background: #0a1030c0; justify-content: center; }
.bo-card { width: 860px; background: linear-gradient(#f6f3ea, #e6dfcd); border: 10px solid #1d4796; border-radius: 60px;
  padding: 60px 50px 70px; display: flex; flex-direction: column; align-items: center; color: #24306a; animation: bo-pop .3s; }
.bo-card h1 { font-size: 96px; color: #ff5a4a; -webkit-text-stroke: 14px #5a1010; }
.bo-card p { font-size: 44px; text-align: center; margin: 30px 0 10px; font-weight: 800; }
.bo-mini { display: flex; gap: 16px; margin-top: 40px; }
.bo-mini i { width: 100px; height: 86px; border-radius: 18px; background: #c3c5e0; border: 4px solid #fff; box-shadow: inset 0 -12px 0 #0003; }
.bo-retry { margin-top: 40px; min-width: 360px; height: 120px; border-radius: 40px !important; background: linear-gradient(#ff7a5a, #e04030) !important;
  border: 7px solid #8a1a10 !important; color: #fff !important; font-size: 56px !important; -webkit-text-stroke: 9px #6a1008; paint-order: stroke fill; box-shadow: 0 10px 0 #0004; }
.bo-p { font-size: 17px; text-align: center; margin: 0; }
@keyframes bo-fade { from { opacity: 0; } }
@keyframes bo-pop { from { transform: scale(.8); opacity: 0; } }
@keyframes bo-spin { to { transform: rotate(360deg); } }
`;

