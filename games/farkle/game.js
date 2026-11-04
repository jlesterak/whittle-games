// Farkle: game module (docs/games/farkle.md). Setup is plain responsive DOM like the shelf; play sits in a
// fixed portrait design space (1080 wide) fitted by core/stage.js, letterboxed on wide screens. Rules in
// rules.js, bots in bot.js; dice, seats, the pass card and bot pacing come from core/, as in Yacht.

import { normRules, newTurn, keep, scoreKeep, isFarkle, canRoll, canBank, stuck, bankMin, reached, gameOver, DICE } from './rules.js';
import { botKeep, botBank } from './bot.js';
import { makeRng } from '../../core/rng.js';
import { rollDice, botDelay, BOT_SPEEDS } from '../../core/dice.js';
import { createSeats, restoreSeats, needsPass, cleanPlayers, SEAT_COLOURS } from '../../core/seats.js';
import { isPlain } from '../../core/save.js';
import { seatSetup, passScreen } from '../../core/seats-ui.js';
import { makeDie, tumble } from '../../core/dice-view.js';
import { fitStage } from '../../core/stage.js';
import { icons } from '../../core/icons.js';
import { makeSounds } from './sounds.js';

const ID = 'farkle';
const DESIGN = { W: 1080, H: 1820 };
const PACE = { think: 600, roll: 450, look: 700, pick: 900, farkle: 1400, next: 500 }; // ms at Slow (core/dice.js botDelay)
const HIGH_N = 10;
const TARGETS = ['10000', '5000'];

const SETTINGS = [
  { key: 'target', label: 'Play to', options: [['10000', '10,000'], ['5000', '5,000']], default: '10000' },
  { key: 'entry', label: 'Entry minimum', options: [['0', 'None'], ['500', '500'], ['1000', '1,000']], default: '0' },
  { key: 'threePairs', label: 'Three pairs', options: [['on', '1,500'], ['off', 'Off']], default: 'on' },
  { key: 'fourKind', label: 'Four of a kind+', options: [['flat', 'Flat'], ['double', 'Doubling']], default: 'flat' },
  { key: 'hotDice', label: 'Hot dice', options: [['on', 'On'], ['off', 'Off']], default: 'on' },
  { key: 'botSpeed', label: 'Bot speed', options: BOT_SPEEDS, default: 'normal' },
];

const DEFAULT_PLAYERS = [
  { name: 'Player 1', kind: 'human', level: 'medium' },
  { name: 'Rusty', kind: 'bot', level: 'medium' },
];

const BG = '#4a2a1c';
const ICONS = { back: icons.back(), gear: icons.gear(BG), bot: icons.bot(BG), crown: icons.crown() };

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmt = (n) => n.toLocaleString('en-GB');
const isDie = (v) => Number.isInteger(v) && v >= 1 && v <= 6;

export default {
  settings: SETTINGS,

  mount(root, ctx) {
    const { el, modal, toast } = ctx.ui;
    const S = ctx.settings;
    const sounds = makeSounds(ctx.audio, ctx.haptics);
    const stored = ctx.store.get() || {};
    const high = isPlain(stored.high) ? stored.high : {};
    const runs = (list) => (Array.isArray(list) ? list.filter((e) => isPlain(e) && Number.isInteger(e.turns) && e.turns > 0 && typeof e.date === 'string') : []);
    const save = {
      ...stored,
      setup: { players: cleanPlayers(stored.setup?.players, { min: 1, max: 4, fallback: DEFAULT_PLAYERS }) },
      game: isPlain(stored.game) ? stored.game : null,
      high: { ...high, ...Object.fromEntries(TARGETS.map((t) => [t, runs(high[t])])) },
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const dropped =
      (stored.setup !== undefined && !same(stored.setup?.players, save.setup.players)) ||
      (stored.game !== undefined && stored.game !== null && save.game === null) ||
      (stored.high !== undefined && (!isPlain(stored.high) || TARGETS.some((k) => k in high && !same(high[k], save.high[k]))));
    if (dropped) ctx.store.keep(stored);
    const rng = makeRng((Date.now() ^ (Math.random() * 2 ** 32)) >>> 0);
    const params = new URLSearchParams(location.search);
    const autoplay = params.has('autoplay'); // humans are played by the Hard bot, fast (testing)
    const rm = () => !!S.get('reducedMotion');
    const speed = () => (autoplay ? 'fast' : S.get(`${ID}.botSpeed`, 'normal'));
    const pace = (k) => botDelay(speed(), PACE[k]);
    const rulesFromSettings = () =>
      normRules({
        target: S.get(`${ID}.target`, '10000'),
        entry: S.get(`${ID}.entry`, '0'),
        threePairs: S.get(`${ID}.threePairs`, 'on'),
        fourKind: S.get(`${ID}.fourKind`, 'flat'),
        hotDice: S.get(`${ID}.hotDice`, 'on'),
      });

    // ---- state ----
    // the saved game: { v, rules, seats, turn, sel, phase: 'start' | 'pick' | 'farkle', turns, finalFrom, lastHuman,
    // over, recorded, rank, date }. Scores live on the seats (players[i].score).
    let g = null;
    let seats = null;
    let anim = false;
    let passing = false;
    let between = false; // a turn has ended and the next has not begun: no input (the pass card is still to come)
    let cancelTumble = () => {};
    let timers = [];
    let gen = 0;
    const later = (ms, fn) => {
      const my = gen;
      timers.push(setTimeout(() => my === gen && fn(), ms));
    };
    const stopTimers = () => {
      gen++;
      timers.forEach(clearTimeout);
      timers = [];
      cancelTumble();
      anim = false;
      between = false;
    };

    function persist() {
      if (g) g.seats = seats.toJSON();
      save.game = g;
      ctx.store.set(save);
    }

    // ---- setup view ----
    const rulesLine = el('p', { class: 'setup-rules-line' });
    const soloLine = el('p', { class: 'setup-note' });
    const seatsUi = seatSetup(el, {
      players: save.setup.players,
      onChange: (players) => {
        save.setup.players = players;
        persist();
        drawSetupNotes();
      },
    });
    const setupView = el(
      'div',
      { class: 'setup', style: `--setup-bg:${BG}` },
      el(
        'header',
        {},
        el('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: ctx.exit }, '‹'),
        el('h1', {}, 'Farkle'),
        el('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => ctx.openSettings() }, '⚙'),
      ),
      el('h2', {}, 'Players'),
      seatsUi.node,
      soloLine,
      el('div', { class: 'setup-rules' }, rulesLine, el('button', { class: 'btn', onclick: () => ctx.openSettings() }, 'House rules')),
      el(
        'div',
        { class: 'setup-actions' },
        el('button', { class: 'btn', onclick: () => showHigh() }, 'Best runs'),
        el('button', { class: 'btn btn-primary setup-start', onclick: () => startGame(seatsUi.players()) }, 'Start'),
      ),
    );

    function rulesText(r) {
      return [
        `to ${fmt(r.target)}`,
        r.entry ? `${fmt(r.entry)} to get on` : 'no entry minimum',
        r.threePairs ? 'three pairs 1,500' : 'no three pairs',
        r.fourKind === 'double' ? 'doubling kinds' : 'flat kinds',
        r.hotDice ? 'hot dice' : 'no hot dice',
      ].join(' · ');
    }
    function drawSetupNotes() {
      rulesLine.textContent = rulesText(rulesFromSettings());
      const ps = seatsUi.players();
      soloLine.textContent = ps.length === 1 && ps[0].kind === 'human' ? 'Solo: reach the target in as few turns as you can.' : ps.every((p) => p.kind === 'bot') ? 'All bots: sit back and watch.' : '';
    }

    // ---- play view ----
    const roundText = el('div', { class: 'fk-round' });
    const strip = el('div', { class: 'fk-strip' });
    const keptBox = el('div', { class: 'fk-kept' });
    const turnPts = el('div', { class: 'fk-pts', 'aria-live': 'polite' });
    const msg = el('div', { class: 'fk-msg', 'aria-live': 'polite' });
    const dice = Array.from({ length: DICE }, (_, i) => makeDie(el, { label: `Die ${i + 1}`, onTap: () => tapDie(i) }));
    const rollBtn = el('button', { class: 'fk-btn fk-roll', onclick: () => humanRoll() });
    const bankBtn = el('button', { class: 'fk-btn fk-bank', onclick: () => humanBank() });
    const tray = el(
      'div',
      { class: 'fk-tray' },
      msg,
      el('div', { class: 'fk-dice' }, dice.map((d) => d.node)),
      el('div', { class: 'fk-actions' }, rollBtn, bankBtn),
    );
    const overPanel = el('div', { class: 'fk-over' });
    const banner = el('div', { class: 'fk-banner', 'aria-live': 'polite' });
    const stage = el(
      'div',
      { class: 'fk-stage' },
      el(
        'div',
        { class: 'fk-top' },
        el('button', { class: 'fk-icon', 'aria-label': 'Back to shelf', html: ICONS.back, onclick: ctx.exit }),
        roundText,
        el('button', { class: 'fk-icon', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openPlaySettings() }),
      ),
      strip,
      el('div', { class: 'fk-felt' }, keptBox, turnPts),
      tray,
      overPanel,
      banner,
    );
    const playView = el('div', { class: 'fk-play' }, stage);
    root.append(setupView, playView, el('style', {}, CSS));

    function showView(which) {
      setupView.hidden = which !== 'setup';
      playView.hidden = which !== 'play';
      if (which === 'setup') drawSetupNotes();
      else resize();
    }

    function resize() {
      if (playView.hidden) return;
      const w = root.clientWidth || innerWidth;
      const h = root.clientHeight || innerHeight;
      const f = fitStage(w, h, DESIGN);
      stage.style.width = `${DESIGN.W}px`;
      stage.style.height = `${h / f.scale}px`;
      stage.style.transform = `translate(${f.offX}px, 0) scale(${f.scale})`;
    }

    // ---- game flow ----
    const score = () => seats.player.score;
    const humanTurn = () => g && !g.over && seats.player.kind === 'human' && !autoplay;
    const canAct = () => humanTurn() && !anim && !passing && !between;
    const situation = () => ({
      lastTurn: g.finalFrom >= 0,
      toBeat: Math.max(0, ...seats.players.filter((p) => p.seat !== seats.current).map((p) => p.score)),
    });
    const picked = () => g.turn.roll.filter((_, i) => g.sel[i]);
    const pickedScore = () => scoreKeep(picked(), g.rules);
    // the turn as it would be after keeping the picked dice (null if they don't score)
    const afterKeep = () => (pickedScore() ? keep(structuredClone(g.turn), g.sel, g.rules) : null);

    function startGame(players, rules = rulesFromSettings()) {
      stopTimers();
      const ps = players.map((p, i) => ({ name: p.name, kind: p.kind, level: p.level || 'medium', colour: SEAT_COLOURS[i].hex }));
      seats = createSeats(ps);
      g = { v: 1, rules, seats: null, turn: newTurn(), sel: [], phase: 'start', turns: ps.map(() => 0), finalFrom: -1, lastHuman: -1, over: false, recorded: false, date: today() };
      overPanel.replaceChildren();
      persist();
      showView('play');
      beginTurn();
    }

    // A saved game that can't be played is kept under 'farkle.broken' and the setup screen comes back.
    function resumeGame() {
      try {
        g = save.game;
        g.rules = normRules(g.rules);
        seats = restoreSeats(g.seats);
        const ps = seats.players;
        const t = g.turn;
        const ok =
          ps.length >= 1 &&
          ps.length <= 4 &&
          cleanPlayers(ps, { min: 1, fallback: [] }).length === ps.length &&
          ps.every((p) => Number.isInteger(p.score) && p.score >= 0) &&
          Number.isInteger(seats.current) && seats.current >= 0 && seats.current < ps.length &&
          isPlain(t) && Array.isArray(t.roll) && t.roll.every(isDie) && Number.isInteger(t.left) && t.left >= 0 && t.left <= DICE && t.roll.length <= t.left &&
          Number.isInteger(t.pts) && t.pts >= 0 && Array.isArray(t.kept) && Number.isInteger(t.hot) &&
          Array.isArray(g.sel) && ['start', 'pick', 'farkle'].includes(g.phase) && (g.phase !== 'pick' || (t.roll.length > 0 && g.sel.length === t.roll.length && !isFarkle(t.roll, g.rules))) &&
          Array.isArray(g.turns) && g.turns.length === ps.length && Number.isInteger(g.finalFrom);
        if (!ok) throw new Error('bad save');
        showView('play');
        if (g.over) return showOver(false);
        beginTurn(true);
      } catch (e) {
        console.warn('farkle: could not resume', e);
        ctx.store.keep({ game: save.game });
        g = null;
        save.game = null;
        persist();
        toast('Could not resume the last game');
        showView('setup');
      }
    }

    function beginTurn(resumed = false) {
      between = false;
      render();
      if (g.phase === 'farkle') return later(pace('next'), () => endTurn(0));
      const p = seats.player;
      if (p.kind === 'human' && !autoplay) {
        if (g.phase === 'start' && g.turn.pts === 0 && needsPass(seats, g.lastHuman)) {
          passing = true;
          sounds.pass();
          root.append(
            passScreen(el, {
              name: p.name,
              colour: p.colour,
              onGo: () => {
                passing = false;
                g.lastHuman = p.seat;
                persist();
                render();
              },
            }),
          );
          return;
        }
        g.lastHuman = p.seat;
        persist();
        render();
      } else later(resumed ? pace('look') : pace('think'), botStep);
    }

    function doRoll(after) {
      g.turn.roll = rollDice(rng, g.turn.left);
      g.sel = g.turn.roll.map(() => false);
      g.phase = 'pick';
      const farkled = isFarkle(g.turn.roll, g.rules);
      if (farkled) g.phase = 'farkle';
      persist();
      const n = g.turn.roll.length;
      anim = true;
      sounds.roll();
      render();
      cancelTumble = tumble(dice.slice(0, n), g.turn.roll, {
        reduced: rm(),
        ms: PACE.roll,
        onTick: () => sounds.rattle(),
        onDone: () => {
          anim = false;
          sounds.land();
          if (farkled) {
            sounds.farkle();
            showBanner('FARKLE!', 'big bad');
            render();
            later(pace('farkle'), () => endTurn(0));
            return;
          }
          render();
          after?.();
        },
      });
    }

    // keep the picked dice; returns false (and ends the turn with nothing) if the dice ran out under the entry minimum
    function keepPicked() {
      const before = g.turn.hot;
      const pts = pickedScore();
      keep(g.turn, g.sel, g.rules);
      g.sel = [];
      g.phase = 'start';
      sounds.keep(pts);
      if (g.turn.hot > before) {
        later(120, () => sounds.hot());
        showBanner('Hot dice!', 'hot');
      }
      if (stuck(g.turn, score(), g.rules)) {
        persist();
        showBanner('No dice left', 'bad');
        later(pace('farkle'), () => endTurn(0));
        return false;
      }
      return true;
    }

    function humanRoll() {
      if (!canAct()) return;
      if (g.phase === 'start') return doRoll();
      const next = afterKeep();
      if (!next || !canRoll(next)) return;
      if (keepPicked()) doRoll();
    }

    function humanBank() {
      if (!canAct() || g.phase !== 'pick') return;
      const next = afterKeep();
      if (!next) return;
      if (stuck(next, score(), g.rules)) return keepPicked();
      if (!canBank(next, score(), g.rules)) return;
      keepPicked();
      bank();
    }

    function tapDie(i) {
      if (!canAct() || g.phase !== 'pick' || i >= g.turn.roll.length) return;
      g.sel[i] = !g.sel[i];
      sounds.pick(g.sel[i]);
      persist();
      render();
    }

    function bank() {
      const p = seats.player;
      const pts = g.turn.pts;
      p.score += pts;
      sounds.bank(pts);
      showBanner(`+${fmt(pts)}`, 'gain');
      if (g.finalFrom < 0 && reached(p.score, g.rules)) {
        g.finalFrom = seats.current;
        if (seats.players.length > 1) later(700, () => showBanner('Last round!', 'hot'));
      }
      endTurn(pts);
    }

    function endTurn() {
      g.turns[seats.current]++;
      g.turn = newTurn();
      g.sel = [];
      g.phase = 'start';
      const n = seats.players.length;
      const nextSeat = (seats.current + 1) % n;
      if (gameOver(g.finalFrom, nextSeat, n)) {
        g.over = true;
        persist();
        render();
        later(pace('next'), () => showOver(true));
        return;
      }
      seats.next();
      between = true;
      persist();
      render();
      later(pace('next'), () => beginTurn());
    }

    // A bot (or an autoplayed human) works from the saved state, so it resumes mid-turn too.
    function botStep() {
      if (!g || g.over) return;
      const p = seats.player;
      const level = p.kind === 'bot' ? p.level : 'hard';
      const next = () => later(pace('look'), botStep);
      if (g.phase === 'start') return doRoll(next);
      if (g.phase !== 'pick') return;
      g.sel = botKeep(level, g.turn, score(), g.rules, situation());
      sounds.pick(true);
      persist();
      render();
      later(pace('pick'), () => {
        const after = afterKeep();
        const banks = botBank(level, after, score(), g.rules, situation());
        if (!keepPicked()) return;
        if (banks) bank();
        else {
          render();
          later(pace('look') / 2, () => doRoll(next));
        }
      });
    }

    // ---- game over and best runs ----
    const standings = () => seats.players.map((p) => ({ p, total: p.score })).sort((a, b) => b.total - a.total);
    const ruleTag = (r) => [r.entry ? `entry ${fmt(r.entry)}` : '', r.threePairs ? '' : 'no pairs', r.fourKind === 'double' ? 'doubling' : '', r.hotDice ? '' : 'no hot dice'].filter(Boolean).join(', ');

    function showOver(fresh) {
      const st = standings();
      const top = st[0].total;
      const winners = st.filter((s) => s.total === top);
      const solo = seats.players.length === 1 && seats.players[0].kind === 'human';
      const turnsTaken = g.turns[0];
      let rank = 0;
      let entry = null;
      if (solo && !g.recorded) {
        entry = { turns: turnsTaken, date: g.date || today(), tag: ruleTag(g.rules) };
        const list = save.high[String(g.rules.target)];
        list.push(entry);
        list.sort((a, b) => a.turns - b.turns);
        list.length = Math.min(list.length, HIGH_N);
        rank = list.indexOf(entry) + 1;
        g.recorded = true;
        g.rank = rank;
        persist();
      } else if (solo) rank = g.rank || 0;
      let title;
      let note = '';
      if (solo) {
        title = `${fmt(top)} in ${turnsTaken} turns`;
        note = rank === 1 ? 'New best run!' : rank ? `#${rank} on your top ${HIGH_N}` : `Not in your top ${HIGH_N} this time`;
      } else if (winners.length > 1) title = `Tie: ${winners.map((w) => w.p.name).join(' & ')}`;
      else title = `${winners[0].p.name} wins!`;
      const parts = [
        el('h2', {}, title),
        note ? el('p', { class: `fk-note${rank === 1 ? ' best' : ''}` }, note) : null,
        solo
          ? null
          : el(
              'ol',
              { class: 'fk-standings' },
              st.map((s) =>
                el('li', { style: `--seat:${s.p.colour}` }, s.total === top ? el('i', { class: 'fk-crown', html: ICONS.crown }) : el('i'), el('span', {}, s.p.name), el('b', {}, fmt(s.total))),
              ),
            ),
        el(
          'div',
          { class: 'fk-actions' },
          el('button', { class: 'fk-btn fk-alt', onclick: () => (solo ? showHigh(entry || g.rank) : confirmNew()) }, solo ? 'Best runs' : 'New game'),
          el('button', { class: 'fk-btn fk-roll', onclick: () => startGame(seats.players, rulesFromSettings()) }, 'Play again'),
        ),
        solo ? el('button', { class: 'fk-link', onclick: () => confirmNew() }, 'Change players') : null,
      ];
      overPanel.replaceChildren(...parts.filter(Boolean));
      render();
      if (fresh) {
        sounds.over(solo ? rank > 0 : winners.some((w) => w.p.kind === 'human'));
        if (solo && rank === 1) showBanner('New best!', 'big');
      }
    }

    function showHigh(mark) {
      let tab = String(g?.rules.target || rulesFromSettings().target);
      const list = el('ol', { class: 'fk-high' });
      const segBtns = TARGETS.map((v) => el('button', { 'data-v': v, onclick: () => ((tab = v), draw()) }, `To ${fmt(+v)}`));
      function draw() {
        const rows = save.high[tab];
        const mine = (e, i) => e === mark || (typeof mark === 'number' && g?.recorded && tab === String(g.rules.target) && i + 1 === mark);
        list.replaceChildren(
          ...(rows.length
            ? rows.map((e, i) => el('li', { class: mine(e, i) ? 'me' : '' }, el('b', {}, `${e.turns} turns`), el('span', {}, fmtDate(e.date) + (e.tag ? ` · ${e.tag}` : ''))))
            : [el('li', { class: 'empty' }, 'No solo games yet. Play with one human seat to set one.')]),
        );
        segBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === tab));
      }
      draw();
      modal({ title: 'Best runs (fewest turns)', body: [el('div', { class: 'seg fk-tabs' }, segBtns), list], actions: [{ label: 'Done', primary: true }] });
    }

    function confirmNew() {
      const go = () => {
        stopTimers();
        document.querySelectorAll('.pass-screen').forEach((n) => n.remove());
        passing = false;
        g = null;
        persist();
        showView('setup');
      };
      if (!g || g.over) return go();
      modal({
        title: 'New game?',
        body: [el('p', { class: 'fk-p' }, 'This game will be abandoned.')],
        actions: [{ label: 'Keep playing' }, { label: 'New game', primary: true, onClick: (close) => (close(), go()) }],
      });
    }

    function openPlaySettings() {
      ctx.openSettings([{ label: 'New game', onClick: (close) => (close(), confirmNew()) }]);
    }

    let bannerTimer = 0;
    function showBanner(text, cls) {
      banner.textContent = text;
      banner.className = `fk-banner ${cls}`;
      void banner.offsetWidth; // restart the animation
      banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('show'), 1500);
    }

    // ---- render ----
    function render() {
      if (!g) return;
      const round = Math.min(...g.turns) + 1;
      roundText.textContent = g.over ? 'Game over' : `${g.finalFrom >= 0 && seats.players.length > 1 ? 'Last round' : `Round ${round}`} · to ${fmt(g.rules.target)}`;
      stage.classList.toggle('over', g.over);
      drawStrip();
      drawFelt();
      drawTray();
    }

    function drawStrip() {
      strip.replaceChildren(
        ...seats.players.map((p, i) =>
          el(
            'div',
            {
              class: `fk-chip${i === seats.current && !g.over ? ' cur' : ''}`,
              style: `--seat:${p.colour}`,
              'aria-label': `${p.name}${p.kind === 'bot' ? ` (${p.level} bot)` : ''}: ${p.score}`,
            },
            el('span', { class: 'fk-chip-name' }, p.kind === 'bot' ? el('i', { class: 'fk-bot', html: ICONS.bot }) : null, p.name),
            el('b', {}, fmt(p.score)),
            p.kind === 'bot' ? el('small', {}, seats.players.length > 3 ? p.level[0] : p.level) : null,
            el('i', { class: 'fk-bar', style: `--fill:${Math.min(1, p.score / g.rules.target)}` }),
          ),
        ),
      );
    }

    // The dice set aside this turn, since the last hot dice (earlier sixes are summed in the label).
    function drawFelt() {
      const t = g.turn;
      let start = 0;
      let used = 0;
      t.kept.forEach((k, i) => {
        used += k.dice.length;
        if (used >= DICE) {
          used = 0;
          start = i + 1;
        }
      });
      const earlier = t.kept.slice(0, start).reduce((a, k) => a + k.score, 0);
      const groups = t.kept.slice(start).map((k) => {
        const ds = k.dice.map((v) => makeDie(el, { label: 'Kept die' }).set(v));
        ds.forEach((d) => (d.node.disabled = true));
        return el('div', { class: 'fk-group' }, el('div', { class: 'fk-gdice' }, ds.map((d) => d.node)), el('b', {}, `+${fmt(k.score)}`));
      });
      keptBox.replaceChildren(
        ...(earlier ? [el('div', { class: 'fk-hot' }, `Hot dice ×${t.hot}: +${fmt(earlier)}`)] : []),
        ...(groups.length || earlier ? groups : [el('p', { class: 'fk-empty' }, g.over ? '' : 'Dice you keep go here')]),
      );
      const sel = g.phase === 'pick' && !anim ? pickedScore() : 0;
      turnPts.replaceChildren(el('span', {}, 'This turn'), el('b', {}, fmt(t.pts)), ...(sel ? [el('em', {}, `+${fmt(sel)}`)] : []));
    }

    function drawTray() {
      const p = seats.player;
      const human = humanTurn();
      const t = g.turn;
      const n = g.phase === 'start' ? t.left : t.roll.length;
      dice.forEach((d, i) => {
        d.node.hidden = i >= n;
        if (!anim) d.set(g.phase === 'start' ? 0 : t.roll[i] || 0);
        d.hold(g.phase === 'pick' && !!g.sel[i]);
        d.node.disabled = !human || g.phase !== 'pick' || anim;
      });
      const ps = g.phase === 'pick' && !anim ? pickedScore() : 0;
      const next = ps ? afterKeep() : null;
      const min = bankMin(p.score, g.rules);
      let text;
      if (g.over) text = '';
      else if (g.phase === 'farkle') text = `${p.name} farkled: nothing scores`;
      else if (!human) text = `${p.name} is playing`;
      else if (g.phase === 'start') text = t.pts ? `Roll ${t.left} dice to go on (${fmt(t.pts)} at stake)` : seats.players.length > 1 ? `${p.name}, roll the dice` : 'Roll the dice';
      else if (anim) text = '';
      else if (!g.sel.some(Boolean)) text = 'Tap the scoring dice you want to keep';
      else if (!ps) text = 'Every kept die has to score';
      else if (next && stuck(next, p.score, g.rules)) text = `No dice left and under ${fmt(min)}: the turn scores nothing`;
      else if (next && !canBank(next, p.score, g.rules)) text = `You need ${fmt(min)} in one turn to get on the board`;
      else text = 'Roll on for more, or bank it';
      msg.textContent = text;

      const busy = !human || anim || passing || between;
      if (g.phase === 'start') {
        rollBtn.textContent = `Roll ${t.left}`;
        rollBtn.disabled = busy;
        bankBtn.textContent = 'Bank';
        bankBtn.disabled = true;
      } else {
        const rollsOn = next && canRoll(next);
        rollBtn.textContent = next ? (rollsOn ? `Keep, roll ${next.left}` : 'No dice left') : 'Roll';
        rollBtn.disabled = busy || g.phase !== 'pick' || !rollsOn;
        const isStuck = next && stuck(next, p.score, g.rules);
        bankBtn.textContent = isStuck ? 'End turn' : next ? `Bank ${fmt(next.pts)}` : 'Bank';
        bankBtn.disabled = busy || g.phase !== 'pick' || !next || (!isStuck && !canBank(next, p.score, g.rules));
      }
    }

    // ---- settings changes ----
    const offSettings = S.onChange((key) => {
      if (!key.startsWith(`${ID}.`)) return;
      if (!setupView.hidden) drawSetupNotes();
      else if (g && !g.over && key !== `${ID}.botSpeed`) toast('Rule changes apply to the next game');
    });

    // ---- lifecycle ----
    const onVis = () => document.hidden && persist();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', persist);
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    document.body.style.background = BG;
    if (autoplay || params.has('debug')) window.__fk = () => ({ save, g, seats });

    if (save.game) resumeGame();
    else showView('setup');

    return {
      unmount() {
        persist();
        stopTimers();
        clearTimeout(bannerTimer);
        ro.disconnect();
        offSettings();
        document.querySelectorAll('.pass-screen').forEach((n) => n.remove());
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pagehide', persist);
        document.body.style.background = '';
      },
    };
  },
};

const CSS = `
.fk-p { margin: 0; text-align: center; font-size: 17px; }
.fk-tabs { justify-content: center; margin: 0 auto 4px; }
.fk-high { margin: 0; padding: 0; list-style: none; counter-reset: r; display: grid; gap: 6px; }
.fk-high li { counter-increment: r; display: flex; align-items: baseline; gap: 12px; padding: 8px 12px; border-radius: 12px; background: #fff; }
.fk-high li::before { content: counter(r) '.'; width: 28px; font-weight: 800; color: #8a90a8; }
.fk-high li b { font-size: 18px; min-width: 76px; }
.fk-high li span { font-size: 14px; color: #5a6078; }
.fk-high li.me { background: #fff1c2; box-shadow: inset 0 0 0 2px #e0a020; }
.fk-high li.empty::before { content: none; }
.fk-high li.empty { color: #5a6078; font-size: 15px; }

.fk-play { position: absolute; inset: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 35%, #6b3c26, #4a2a1c 75%); }
.fk-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; display: flex; flex-direction: column; gap: 22px;
  padding: 22px 30px 30px; font-family: var(--font); color: #fff; }
.fk-stage button:not(.wdie) { font: inherit; color: inherit; border: 0; background: none; padding: 0; }
.fk-top { display: flex; align-items: center; justify-content: space-between; height: 96px; flex: none; }
.fk-icon { width: 96px; height: 96px; border-radius: 50%; background: #0003 !important; color: #f4d27a !important; padding: 20px !important; }
.fk-icon svg { width: 100%; height: 100%; display: block; }
.fk-round { font-size: 42px; font-weight: 900; text-shadow: 0 4px 0 #0005; }
.fk-strip { display: flex; gap: 14px; flex: none; }
.fk-chip { flex: 1 1 0; min-width: 0; position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 130px; border-radius: 28px; background: #0003; opacity: .8; }
.fk-chip.cur { opacity: 1; background: #ffffff26; box-shadow: 0 0 0 5px var(--seat); }
.fk-chip-name { display: flex; align-items: center; gap: 8px; max-width: 92%; font-size: 32px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fk-bot { width: 34px; height: 34px; flex: none; color: #f4d27a; }
.fk-bot svg { width: 100%; height: 100%; display: block; }
.fk-chip b { font-size: 46px; font-weight: 900; line-height: 1.05; }
.fk-chip small { position: absolute; right: 14px; bottom: 14px; font-size: 22px; font-weight: 800; opacity: .7; text-transform: uppercase; }
.fk-bar { position: absolute; left: 0; bottom: 0; height: 10px; width: 100%; background: #0004; }
.fk-bar::after { content: ''; position: absolute; inset: 0; width: calc(var(--fill) * 100%); background: var(--seat); }
.fk-felt { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 18px; padding: 24px 28px; border-radius: 34px;
  background: #2f5e3f; box-shadow: inset 0 6px 18px #0007; }
.fk-kept { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 18px 26px; }
.fk-group { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.fk-gdice { display: flex; gap: 10px; }
.fk-gdice .wdie { --die: 84px; }
.fk-group b { font-size: 32px; font-weight: 900; color: #ffe08a; }
.fk-hot { width: 100%; font-size: 32px; font-weight: 800; color: #ffb35a; }
.fk-empty { margin: auto; font-size: 32px; font-weight: 700; opacity: .5; }
.fk-pts { flex: none; display: flex; align-items: baseline; justify-content: center; gap: 22px; }
.fk-pts span { font-size: 34px; font-weight: 700; opacity: .8; }
.fk-pts b { font-size: 92px; font-weight: 900; text-shadow: 0 5px 0 #0005; }
.fk-pts em { font-style: normal; font-size: 56px; font-weight: 900; color: #b8f070; }
.fk-tray { display: flex; flex-direction: column; align-items: center; gap: 24px; flex: none; }
.fk-msg { min-height: 96px; font-size: 36px; font-weight: 700; text-align: center; opacity: .92; display: flex; align-items: center; }
.fk-dice { display: flex; gap: 22px; min-height: 150px; padding-top: 16px; }
.fk-dice .wdie { --die: 145px; }
.fk-dice .wdie[hidden] { display: none; }
.fk-actions { display: flex; gap: 24px; width: 100%; }
.fk-btn { flex: 1 1 0; min-width: 0; height: 132px; border-radius: 38px !important; font-size: 44px !important; font-weight: 900;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 24px !important; box-shadow: 0 10px 0 #0005; }
.fk-btn:active { transform: translateY(5px); box-shadow: 0 5px 0 #0005; }
.fk-btn:disabled { filter: grayscale(.7); opacity: .45; transform: none; box-shadow: 0 10px 0 #0003; }
.fk-roll { background: linear-gradient(#ffd451, #e9a210) !important; color: #3a2400 !important; }
.fk-bank { background: linear-gradient(#5ad06a, #2c9a3e) !important; color: #fff !important; }
.fk-alt { background: #ffffff2a !important; color: #fff !important; }
.fk-over { display: none; flex-direction: column; align-items: center; gap: 18px; flex: none; }
.fk-stage.over .fk-tray { display: none; }
.fk-stage.over .fk-over { display: flex; }
.fk-over h2 { margin: 0; font-size: 64px; font-weight: 900; text-shadow: 0 5px 0 #0005; text-align: center; }
.fk-note { margin: 0; font-size: 40px; font-weight: 800; opacity: .9; }
.fk-note.best { color: #ffd451; }
.fk-standings { list-style: none; margin: 0; padding: 0; width: 100%; display: grid; gap: 10px; }
.fk-standings li { display: flex; align-items: center; gap: 16px; padding: 0 28px; height: 74px; border-radius: 24px; background: #0003;
  border-left: 12px solid var(--seat); font-size: 40px; font-weight: 800; }
.fk-standings li i { width: 52px; height: 52px; flex: none; }
.fk-standings li i svg { width: 100%; height: 100%; display: block; }
.fk-standings li span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fk-standings li b { font-size: 48px; }
.fk-link { font-size: 34px !important; font-weight: 800; text-decoration: underline; opacity: .8; padding: 8px 20px !important; }
.fk-banner { position: absolute; left: 0; right: 0; top: 36%; text-align: center; pointer-events: none; opacity: 0; font-weight: 900;
  font-size: 96px; color: #ffd451; -webkit-text-stroke: 14px #5a2a00; paint-order: stroke fill; text-shadow: 0 10px 20px #0008; }
.fk-banner.big { font-size: 150px; }
.fk-banner.bad { color: #ff8a7a; -webkit-text-stroke-color: #4a0e08; }
.fk-banner.hot { color: #ffb35a; }
.fk-banner.gain { color: #b8f070; -webkit-text-stroke-color: #1a4a10; }
.fk-banner.show { animation: fk-banner 1.5s forwards; }
@keyframes fk-banner { 0% { opacity: 0; transform: scale(.4); } 15% { opacity: 1; transform: scale(1.06); } 25%, 80% { opacity: 1; transform: none; } 100% { opacity: 0; } }
.reduced-motion .fk-banner.show { animation: fk-banner-rm 1.5s forwards; }
@keyframes fk-banner-rm { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
`;
