// Farkle: game module (docs/games/farkle.md). Setup is plain responsive DOM like the shelf; play sits in a fixed
// design space fitted by core/stage.js (portrait 1080 wide, or a two-pane 1900x1000 layout on wide screens), the
// same frame as Yacht. Rules in rules.js, bots in bot.js; dice, seats, the pass card and bot pacing come from core/.

import { normRules, newGame, roll, bank, endFarkle, canBank, keepScore, keepOptions, keepIndices, isHot, free, rolledDice, lastRound, winners, validGame, kindScore, DICE } from './rules.js';
import { botMove } from './bot.js';
import { makeRng } from '../../core/rng.js';
import { botDelay, BOT_SPEEDS } from '../../core/dice.js';
import { needsPassAt, cleanPlayers, SEAT_COLOURS } from '../../core/seats.js';
import { isPlain } from '../../core/save.js';
import { seatSetup, passScreen } from '../../core/seats-ui.js';
import { makeDie, tumble } from '../../core/dice-view.js';
import { fitStage } from '../../core/stage.js';
import { icons } from '../../core/icons.js';
import { makeSounds } from './sounds.js';

const ID = 'farkle';
const PORTRAIT = { W: 1080, H: 1820 };
const WIDE = { W: 1900, H: 1000 };
const WIDE_AT = 1.15; // aspect (w / h) above which the two-pane layout is used
const PACE = { think: 600, roll: 450, look: 700, pick: 900, next: 500 }; // ms at Slow; Normal x0.45, Fast x0.2 (core/dice.js botDelay)
const FARKLE_MS = 1500; // how long a farkle stays on screen, whatever the bot speed
const BEST_N = 10;
const TARGETS = ['10000', '5000', '2500'];

const SETTINGS = [
  { key: 'target', label: 'Target', options: [['10000', '10,000'], ['5000', '5,000'], ['2500', '2,500']], default: '10000' },
  { key: 'threePairs', label: 'Three pairs', options: [['1500', '1,500'], ['750', '750'], ['off', 'Off']], default: '1500' },
  { key: 'kinds', label: 'Four or more of a kind', options: [['fixed', 'Fixed'], ['double', 'Doubling']], default: 'fixed' },
  { key: 'hotDice', label: 'Hot dice', options: [['may', 'May roll'], ['must', 'Must roll']], default: 'may' },
  { key: 'entry', label: 'Entry minimum', options: [['0', 'None'], ['500', '500'], ['1000', '1,000']], default: '0' },
  { key: 'botSpeed', label: 'Bot speed', options: BOT_SPEEDS, default: 'normal' },
];

const DEFAULT_PLAYERS = [
  { name: 'Player 1', kind: 'human', level: 'medium' },
  { name: 'Rusty', kind: 'bot', level: 'medium' },
];

const BG = '#4a2a52';
const ICONS = { back: icons.back(), gear: icons.gear(BG), bot: icons.bot(BG), crown: icons.crown() };

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmt = (n) => n.toLocaleString('en-GB');

export default {
  settings: SETTINGS,

  mount(root, ctx) {
    const { el, modal, toast } = ctx.ui;
    const S = ctx.settings;
    const sounds = makeSounds(ctx.audio, ctx.haptics);
    const stored = ctx.store.get() || {};
    const storedBest = isPlain(stored.best) ? stored.best : {};
    const entries = (list) => (Array.isArray(list) ? list.filter((e) => isPlain(e) && Number.isInteger(e.turns) && e.turns > 0 && Number.isFinite(e.score) && typeof e.date === 'string') : []);
    const save = {
      ...stored,
      setup: { players: cleanPlayers(stored.setup?.players, { min: 1, max: 4, fallback: DEFAULT_PLAYERS }) },
      game: isPlain(stored.game) ? stored.game : null,
      best: Object.fromEntries(TARGETS.map((t) => [t, entries(storedBest[t])])),
    };
    // anything that was there but had to be dropped: keep a copy of the original before it is saved over
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const dropped =
      (stored.setup !== undefined && !same(stored.setup?.players, save.setup.players)) ||
      (stored.game !== undefined && stored.game !== null && save.game === null) ||
      (stored.best !== undefined && (!isPlain(stored.best) || TARGETS.some((t) => t in storedBest && !same(storedBest[t], save.best[t]))));
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
        threePairs: S.get(`${ID}.threePairs`, '1500'),
        kinds: S.get(`${ID}.kinds`, 'fixed'),
        hotDice: S.get(`${ID}.hotDice`, 'may'),
        entry: S.get(`${ID}.entry`, '0'),
      });

    // ---- state ----
    let g = null; // the saved game: rules.js newGame() plus { players, lastHuman, recorded, rank, date }
    let pick = []; // die positions the player has picked to keep (not saved)
    let anim = false;
    let passing = false;
    let cancelTumble = () => {};
    let timers = [];
    let gen = 0; // bumps on new game / unmount so stale timers do nothing
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
    };

    function persist() {
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
        el('button', { class: 'btn', onclick: () => showBest() }, 'Best turns'),
        el('button', { class: 'btn btn-primary setup-start', onclick: () => startGame(seatsUi.players()) }, 'Start'),
      ),
    );

    function rulesText(r) {
      return [
        `to ${fmt(r.target)}`,
        r.threePairs ? `three pairs ${fmt(r.threePairs)}` : 'no three pairs',
        r.kinds === 'double' ? 'doubling kinds' : '',
        r.hotDice === 'must' ? 'hot dice must roll' : '',
        r.entry ? `entry ${fmt(r.entry)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    function drawSetupNotes() {
      rulesLine.textContent = rulesText(rulesFromSettings());
      const ps = seatsUi.players();
      soloLine.textContent = ps.length === 1 && ps[0].kind === 'human' ? 'Solo: reach the target in as few turns as you can.' : ps.every((p) => p.kind === 'bot') ? 'All bots: sit back and watch.' : '';
    }

    // ---- play view ----
    const roundText = el('div', { class: 'fk-round' });
    const strip = el('div', { class: 'fk-strip' });
    const guide = el('div', { class: 'fk-guide' });
    const turnPts = el('div', { class: 'fk-turn' });
    const msg = el('div', { class: 'fk-msg', 'aria-live': 'polite' });
    const dice = Array.from({ length: DICE }, (_, i) => makeDie(el, { label: `Die ${i + 1}`, onTap: () => tapDie(i) }));
    const rollBtn = el('button', { class: 'fk-btn fk-roll', onclick: () => humanRoll() });
    const bankBtn = el('button', { class: 'fk-btn fk-bank', onclick: () => humanBank() });
    const tray = el(
      'div',
      { class: 'fk-tray' },
      turnPts,
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
      el('div', { class: 'fk-card' }, guide),
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

    // ---- layout ----
    function resize() {
      if (playView.hidden) return;
      const w = root.clientWidth || innerWidth;
      const h = root.clientHeight || innerHeight;
      const wide = w / h > WIDE_AT;
      const d = wide ? WIDE : PORTRAIT;
      const f = fitStage(w, h, d);
      stage.classList.toggle('wide', wide);
      stage.style.width = `${d.W}px`;
      stage.style.height = `${h / f.scale}px`;
      stage.style.transform = `translate(${f.offX}px, 0) scale(${f.scale})`;
    }

    // ---- game flow ----
    const player = () => g.players[g.cur];
    const humanTurn = () => g && !g.over && player().kind === 'human' && !autoplay;
    const canAct = () => humanTurn() && !anim && !passing;
    const solo = () => g.players.length === 1 && g.players[0].kind === 'human';

    function startGame(players, rules = rulesFromSettings()) {
      stopTimers();
      pick = [];
      const ps = players.map((p, i) => ({ name: p.name, kind: p.kind, level: p.level || 'medium', colour: SEAT_COLOURS[i].hex }));
      g = { ...newGame(ps.length, rules), players: ps, lastHuman: -1, recorded: false, date: today() };
      overPanel.replaceChildren();
      persist();
      showView('play');
      beginTurn();
    }

    // A saved game that can't be played (a bug, or a hand-edited import) is kept under 'farkle.broken' and the
    // setup screen comes back, rather than a crash.
    function resumeGame() {
      try {
        g = save.game;
        if (!isPlain(g)) throw new Error('bad save');
        g.rules = normRules(g.rules);
        const ps = Array.isArray(g.players) ? g.players : [];
        const ok = ps.length >= 1 && ps.length <= 4 && cleanPlayers(ps, { min: 1, fallback: [] }).length === ps.length && ps.every((p) => typeof p.colour === 'string');
        if (!ok || !validGame(g, ps.length)) throw new Error('bad save');
        showView('play');
        if (g.over) return showOver(false);
        beginTurn();
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

    function beginTurn() {
      pick = [];
      render();
      const p = player();
      if (g.turn.phase === 'farkle') return farkled();
      if (p.kind === 'human' && !autoplay) {
        if (g.turn.phase === 'roll' && needsPassAt(g.players, g.cur, g.lastHuman)) {
          passing = true;
          sounds.pass();
          root.append(
            passScreen(el, {
              name: p.name,
              colour: p.colour,
              onGo: () => {
                passing = false;
                g.lastHuman = g.cur;
                persist();
                render();
              },
            }),
          );
          return;
        }
        g.lastHuman = g.cur;
        persist();
        render();
      } else {
        later(pace('think'), botStep);
      }
    }

    // Keep `keep` (none at the start of a turn) and roll the free dice.
    function doRoll(keep = [], after) {
      const r = roll(g, rng, keep);
      pick = [];
      persist();
      const moving = free(g.turn);
      anim = true;
      sounds.roll();
      if (r.hot) {
        sounds.hot();
        showBanner('Hot dice!', 'hot');
      }
      render();
      cancelTumble = tumble(
        moving.map((i) => dice[i]),
        moving.map((i) => g.turn.dice[i]),
        {
          reduced: rm(),
          ms: PACE.roll,
          onTick: () => sounds.rattle(),
          onDone: () => {
            anim = false;
            sounds.land();
            render();
            if (r.farkle) return farkled();
            after?.();
          },
        },
      );
    }

    function farkled() {
      sounds.farkle();
      showBanner('Farkle!', 'farkle');
      render();
      later(FARKLE_MS, () => {
        endFarkle(g);
        afterTurn();
      });
    }

    function doBank(keep) {
      const before = g.final;
      const r = bank(g, keep);
      sounds.bank(r.banked);
      if (g.final >= 0 && before < 0 && !g.over) {
        later(300, () => sounds.last());
        showBanner('Last round!', 'hot');
      } else showBanner(`+${fmt(r.banked)}`, 'bank');
      afterTurn();
    }

    function afterTurn() {
      pick = [];
      persist();
      render();
      if (g.over) later(pace('next'), () => showOver(true));
      else later(pace('next'), beginTurn);
    }

    function humanRoll() {
      if (!canAct()) return;
      if (g.turn.phase === 'roll') return doRoll();
      if (g.turn.phase === 'pick' && keepScore(g.turn, pick, g.rules)) doRoll(pick);
    }

    function humanBank() {
      if (!canAct() || g.turn.phase !== 'pick' || !canBank(g, pick)) return;
      doBank(pick);
    }

    function tapDie(i) {
      if (!canAct() || g.turn.phase !== 'pick' || g.turn.aside[i]) return;
      const on = !pick.includes(i);
      pick = on ? [...pick, i] : pick.filter((j) => j !== i);
      sounds.pick(on);
      render();
    }

    // A bot (or an autoplayed human) works from the saved state, so it resumes mid-turn too.
    function botStep() {
      if (!g || g.over) return;
      const next = () => later(pace('look'), botStep);
      if (g.turn.phase === 'roll') return doRoll([], next);
      if (g.turn.phase === 'farkle') return farkled();
      const p = player();
      const m = botMove(p.kind === 'bot' ? p.level : 'hard', g, rng);
      pick = m.keep;
      sounds.pick(true);
      render(m.bank ? 'bank' : 'roll');
      later(pace('pick'), () => (m.bank ? doBank(m.keep) : doRoll(m.keep, next)));
    }

    // ---- game over and best turns ----
    function standings() {
      return g.players.map((p, i) => ({ p, score: g.scores[i] })).sort((a, b) => b.score - a.score);
    }

    function ruleTag(r) {
      return [r.threePairs === 1500 ? '' : r.threePairs ? `pairs ${r.threePairs}` : 'no pairs', r.kinds === 'double' ? 'doubling' : '', r.hotDice === 'must' ? 'must roll' : '', r.entry ? `entry ${r.entry}` : '']
        .filter(Boolean)
        .join(', ');
    }

    function showOver(fresh) {
      const st = standings();
      const top = st[0].score;
      const won = winners(g);
      let rank = 0;
      let entry = null;
      if (solo() && !g.recorded) {
        entry = { turns: g.turns[0], score: top, date: g.date || today(), tag: ruleTag(g.rules) };
        const list = save.best[String(g.rules.target)];
        list.push(entry);
        list.sort((a, b) => a.turns - b.turns || b.score - a.score);
        list.length = Math.min(list.length, BEST_N);
        rank = list.indexOf(entry) + 1;
        g.recorded = true;
        g.rank = rank;
        persist();
      } else if (solo()) rank = g.rank || 0;
      let title;
      let note = '';
      if (solo()) {
        title = `${g.turns[0]} turns to ${fmt(g.rules.target)}`;
        note = rank === 1 ? 'New best!' : rank ? `#${rank} on your top ${BEST_N}` : `Not in your top ${BEST_N} this time`;
      } else if (won.length > 1) title = `Tie: ${won.map((i) => g.players[i].name).join(' & ')}`;
      else title = `${g.players[won[0]].name} wins!`;
      const parts = [
        el('h2', {}, title),
        note ? el('p', { class: `fk-note${rank === 1 ? ' best' : ''}` }, note) : null,
        solo()
          ? null
          : el(
              'ol',
              { class: `fk-standings${st.length > 2 ? ' two' : ''}` },
              st.map((s) => el('li', { style: `--seat:${s.p.colour}` }, s.score === top ? el('i', { class: 'fk-crown', html: ICONS.crown }) : el('i'), el('span', {}, s.p.name), el('b', {}, fmt(s.score)))),
            ),
        el(
          'div',
          { class: 'fk-actions' },
          el('button', { class: 'fk-btn fk-alt', onclick: () => (solo() ? showBest(entry || g.rank) : confirmNew()) }, solo() ? 'Best turns' : 'New game'),
          el('button', { class: 'fk-btn fk-roll', onclick: () => startGame(g.players, rulesFromSettings()) }, 'Play again'),
        ),
        solo() ? el('button', { class: 'fk-link', onclick: () => confirmNew() }, 'Change players') : null,
      ];
      overPanel.replaceChildren(...parts.filter(Boolean));
      render();
      if (fresh) {
        sounds.over(solo() ? rank > 0 : won.some((i) => g.players[i].kind === 'human'));
        if (solo() && rank === 1) showBanner('New best!', 'hot');
      }
    }

    function showBest(mark) {
      let tab = String(g?.rules.target || rulesFromSettings().target);
      const list = el('ol', { class: 'fk-best' });
      const segBtns = TARGETS.map((t) => el('button', { 'data-v': t, onclick: () => ((tab = t), draw()) }, fmt(Number(t))));
      function draw() {
        const rows = save.best[tab];
        const mine = (e, i) => e === mark || (typeof mark === 'number' && g?.recorded && tab === String(g.rules.target) && i + 1 === mark);
        list.replaceChildren(
          ...(rows.length
            ? rows.map((e, i) => el('li', { class: mine(e, i) ? 'me' : '' }, el('b', {}, `${e.turns} turns`), el('span', {}, fmtDate(e.date) + (e.tag ? ` · ${e.tag}` : ''))))
            : [el('li', { class: 'empty' }, 'No solo games yet. Play with one human seat to set one.')]),
        );
        segBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === tab));
      }
      draw();
      modal({ title: 'Best turns', body: [el('div', { class: 'seg fk-tabs' }, segBtns), list], actions: [{ label: 'Done', primary: true }] });
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
    // botIntent: 'roll' or 'bank' while a bot shows the dice it is keeping
    function render(botIntent) {
      if (!g) return;
      if (g.over) roundText.textContent = 'Game over';
      else if (lastRound(g)) roundText.textContent = 'Last round';
      else if (solo()) roundText.textContent = `Turn ${g.turns[0] + 1}`;
      else roundText.textContent = `Round ${g.turns[g.cur] + 1}`;
      stage.classList.toggle('over', g.over);
      drawStrip();
      drawGuide();
      drawTray(botIntent);
    }

    function drawStrip() {
      strip.replaceChildren(
        ...g.players.map((p, i) => {
          const pct = Math.min(100, (g.scores[i] / g.rules.target) * 100);
          return el(
            'div',
            {
              class: `fk-chip${i === g.cur && !g.over ? ' cur' : ''}${g.final === i ? ' final' : ''}`,
              style: `--seat:${p.colour};--pct:${pct}%`,
              role: 'img',
              'aria-label': `${p.name}${p.kind === 'bot' ? ` (${p.level} bot)` : ''}: ${g.scores[i]}${g.entered[i] || !g.rules.entry ? '' : ', not entered yet'}`,
            },
            el('span', { class: 'fk-chip-name' }, p.kind === 'bot' ? el('i', { class: 'fk-bot', html: ICONS.bot }) : null, p.name),
            el('b', {}, fmt(g.scores[i])),
            p.kind === 'bot' ? el('small', {}, g.players.length > 3 ? p.level[0] : p.level) : null,
          );
        }),
      );
    }

    // The scoring table for this game's rules, so nobody has to remember it.
    function drawGuide() {
      const r = g.rules;
      const row = (faces, text, score) =>
        el('div', { class: 'fk-row' }, el('span', { class: 'fk-faces' }, faces.map((v) => miniDie(v))), el('span', { class: 'fk-what' }, text), el('b', {}, score));
      const kinds = (k) => (r.kinds === 'double' ? `three ×${2 ** (k - 3)}` : fmt(kindScore(2, k, r)));
      const rows = [
        row([1], 'Each 1', '100'),
        row([5], 'Each 5', '50'),
        row([1, 1, 1], 'Three 1s', '1,000'),
        row([4, 4, 4], 'Three 2s-6s', 'face ×100'),
        row([3, 3, 3, 3], 'Four of a kind', kinds(4)),
        row([6, 6, 6, 6, 6], 'Five of a kind', kinds(5)),
        row([2, 2, 2, 2, 2, 2], 'Six of a kind', kinds(6)),
        r.threePairs ? row([2, 2, 4, 4, 6, 6], 'Three pairs', fmt(r.threePairs)) : null,
        row([1, 2, 3, 4, 5, 6], 'Run 1-6', '2,500'),
      ];
      const foot = [`First to ${fmt(r.target)}`, r.entry ? `bank ${fmt(r.entry)}+ to enter` : '', r.hotDice === 'must' ? 'hot dice must roll' : ''].filter(Boolean).join(' · ');
      guide.replaceChildren(...rows.filter(Boolean), el('p', { class: 'fk-foot' }, foot));
    }

    function miniDie(v) {
      const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
      return el('span', { class: 'fk-mini', 'aria-hidden': 'true' }, Array.from({ length: 9 }, (_, i) => el('i', { class: PIPS[v].includes(i) ? 'on' : '' })));
    }

    // Dice that some keep could use, so the rest can be dimmed.
    function usable() {
      if (g.turn.phase !== 'pick') return new Set();
      return new Set(keepOptions(rolledDice(g.turn), g.rules).flatMap((o) => keepIndices(g.turn, o.c)));
    }

    function drawTray(botIntent) {
      const t = g.turn;
      const p = player();
      const human = humanTurn();
      const live = t.phase === 'pick' && !anim;
      const use = live ? usable() : new Set();
      const keep = live ? keepScore(t, pick, g.rules) : 0;
      dice.forEach((d, i) => {
        const moving = anim && !t.aside[i];
        if (!moving) d.set(t.phase === 'roll' && !anim ? 0 : t.dice[i]);
        d.hold(live && pick.includes(i));
        d.node.classList.toggle('aside', t.aside[i] && t.phase !== 'roll');
        d.node.classList.toggle('dead', live && !t.aside[i] && !use.has(i));
        d.node.disabled = !human || !live || t.aside[i];
        if (t.aside[i] && t.phase !== 'roll') d.node.setAttribute('aria-label', `Die ${i + 1}: ${t.dice[i]}, set aside`);
      });
      const shown = t.pts + keep;
      turnPts.textContent = t.phase === 'farkle' ? `${fmt(t.pts)} lost` : `This turn ${fmt(shown)}`;
      turnPts.classList.toggle('lost', t.phase === 'farkle');
      let text;
      if (g.over) text = '';
      else if (t.phase === 'farkle') text = `Farkle! Nothing scores${p.kind === 'bot' || autoplay ? '' : ', turn over'}`;
      else if (!human) text = botIntent ? `${p.name} keeps ${fmt(keep)} and ${botIntent === 'bank' ? 'banks' : 'rolls on'}` : `${p.name} is playing`;
      else if (t.phase === 'roll') text = g.players.length > 1 ? `${p.name}, roll the dice` : 'Roll the dice';
      else if (!pick.length) text = 'Tap the dice to keep';
      else if (!keep) text = 'Every die you keep must score';
      else text = `Keep ${fmt(keep)}`;
      msg.textContent = text;

      const hot = live && keep && isHot(t, pick);
      if (t.phase === 'roll') rollBtn.textContent = 'Roll';
      else if (!keep) rollBtn.textContent = 'Roll';
      else rollBtn.textContent = hot ? 'Hot dice: roll 6' : `Roll ${free(t).length - pick.length}`;
      rollBtn.disabled = !human || anim || passing || !(t.phase === 'roll' || (live && keep));

      const bankable = live && canBank(g, pick);
      if (live && keep && !bankable && g.rules.hotDice === 'must' && hot) bankBtn.textContent = 'Must roll';
      else if (live && keep && !bankable) bankBtn.textContent = `Need ${fmt(g.rules.entry)}`;
      else bankBtn.textContent = live && keep ? `Bank ${fmt(t.pts + keep)}` : 'Bank';
      bankBtn.disabled = !human || anim || passing || !bankable;
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
    if (autoplay || params.has('debug')) window.__fk = () => ({ save, g, pick });

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
.fk-best { margin: 0; padding: 0; list-style: none; counter-reset: r; display: grid; gap: 6px; }
.fk-best li { counter-increment: r; display: flex; align-items: baseline; gap: 12px; padding: 8px 12px; border-radius: 12px; background: #fff; }
.fk-best li::before { content: counter(r) '.'; width: 28px; font-weight: 800; color: #8a90a8; }
.fk-best li b { font-size: 20px; min-width: 88px; }
.fk-best li span { font-size: 14px; color: #5a6078; }
.fk-best li.me { background: #fff1c2; box-shadow: inset 0 0 0 2px #e0a020; }
.fk-best li.empty::before { content: none; }
.fk-best li.empty { color: #5a6078; font-size: 15px; }

.fk-play { position: absolute; inset: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 30%, #6a3d74, #4a2a52 75%); }
.fk-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; display: flex; flex-direction: column; gap: 18px;
  padding: 22px 30px 30px; font-family: var(--font); color: #fff; }
.fk-stage button:not(.wdie) { font: inherit; color: inherit; border: 0; background: none; padding: 0; }
.fk-top { display: flex; align-items: center; justify-content: space-between; height: 96px; flex: none; }
.fk-icon { width: 96px; height: 96px; border-radius: 50%; background: #0003 !important; color: #f4d27a !important; padding: 20px !important; }
.fk-icon svg { width: 100%; height: 100%; display: block; }
.fk-round { font-size: 46px; font-weight: 900; text-shadow: 0 4px 0 #0005; }
.fk-strip { display: flex; gap: 14px; flex: none; }
.fk-chip { flex: 1 1 0; min-width: 0; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 118px; border-radius: 28px; background: #0003; opacity: .8; overflow: hidden; }
.fk-chip::after { content: ''; position: absolute; left: 0; bottom: 0; height: 10px; width: var(--pct); background: var(--seat); }
.fk-chip::before { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 10px; background: #0004; }
.fk-chip.cur { opacity: 1; background: #ffffff26; box-shadow: inset 0 0 0 5px var(--seat); }
.fk-chip.final b { color: #ffd451; }
.fk-chip-name { display: flex; align-items: center; gap: 8px; max-width: 92%; font-size: 32px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fk-bot { width: 34px; height: 34px; flex: none; color: #f4d27a; }
.fk-bot svg { width: 100%; height: 100%; display: block; }
.fk-chip b { font-size: 44px; font-weight: 900; line-height: 1.05; }
.fk-chip small { position: absolute; right: 14px; bottom: 12px; font-size: 22px; font-weight: 800; opacity: .7; text-transform: uppercase; }
.fk-card { flex: none; background: #fbf7ea; border-radius: 34px; padding: 18px 30px 14px; color: #23304a; box-shadow: 0 10px 24px #0006, inset 0 -6px 0 #0001; }
.fk-guide { display: grid; gap: 4px; }
.fk-row { display: grid; grid-template-columns: 380px 1fr auto; align-items: center; gap: 20px; height: 74px; border-bottom: 2px solid #ece5cf; }
.fk-faces { display: flex; gap: 6px; }
.fk-mini { width: 56px; height: 56px; padding: 6px; border-radius: 10px; background: #fff; box-shadow: inset 0 -3px 0 #0002, 0 2px 3px #0003;
  display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); box-sizing: border-box; }
.fk-mini i { place-self: center; width: 70%; height: 70%; border-radius: 50%; }
.fk-mini i.on { background: #1a1d28; }
.fk-what { font-size: 36px; font-weight: 700; white-space: nowrap; }
.fk-row b { font-size: 38px; font-weight: 900; text-align: right; }
.fk-foot { margin: 8px 0 0; font-size: 28px; font-weight: 700; color: #6a7088; text-align: center; }
.fk-tray { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 20px; flex: none; }
.fk-turn { font-size: 58px; font-weight: 900; text-shadow: 0 4px 0 #0005; }
.fk-turn.lost { color: #ff9a8a; text-decoration: line-through; }
.fk-msg { min-height: 50px; font-size: 36px; font-weight: 700; text-align: center; opacity: .92; }
.fk-dice { display: flex; gap: 22px; padding-top: 20px; }
.fk-dice .wdie { --die: 142px; }
.fk-dice .wdie.aside { opacity: .35; transform: scale(.82); box-shadow: none; }
.fk-dice .wdie.dead { opacity: .6; }
.fk-actions { display: flex; gap: 24px; width: 100%; }
.fk-btn { flex: 1 1 0; min-width: 0; height: 132px; border-radius: 38px !important; font-size: 44px !important; font-weight: 900;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 24px !important; box-shadow: 0 10px 0 #0005; }
.fk-btn:active { transform: translateY(5px); box-shadow: 0 5px 0 #0005; }
.fk-btn:disabled { filter: grayscale(.7); opacity: .45; transform: none; box-shadow: 0 10px 0 #0003; }
.fk-roll { background: linear-gradient(#ffd451, #e9a210) !important; color: #3a2400 !important; }
.fk-bank { background: linear-gradient(#5ad06a, #2c9a3e) !important; color: #fff !important; }
.fk-alt { background: #ffffff2a !important; color: #fff !important; }
.fk-over { display: none; margin-top: auto; flex-direction: column; align-items: center; gap: 18px; flex: none; }
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
.fk-standings li b { font-size: 46px; }
.fk-standings.two { grid-template-columns: 1fr 1fr; }
.fk-standings.two li { padding: 0 20px; gap: 10px; font-size: 34px; }
.fk-standings.two li b { font-size: 40px; }
.fk-link { font-size: 34px !important; font-weight: 800; text-decoration: underline; opacity: .8; padding: 8px 20px !important; }
.fk-banner { position: absolute; left: 0; right: 0; top: 38%; text-align: center; pointer-events: none; opacity: 0; font-weight: 900;
  color: #ffd451; -webkit-text-stroke: 16px #5a2a00; paint-order: stroke fill; text-shadow: 0 10px 20px #0008; font-size: 120px; }
.fk-banner.farkle { font-size: 150px; color: #ff8a7a; -webkit-text-stroke: 16px #5a0a10; }
.fk-banner.bank { font-size: 110px; color: #b8f070; -webkit-text-stroke: 12px #1a4a10; }
.fk-banner.show { animation: fk-banner 1.5s forwards; }
@keyframes fk-banner { 0% { opacity: 0; transform: scale(.4); } 15% { opacity: 1; transform: scale(1.06); } 25%, 80% { opacity: 1; transform: none; } 100% { opacity: 0; } }
.reduced-motion .fk-banner.show { animation: fk-banner-rm 1.5s forwards; }
@keyframes fk-banner-rm { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
.reduced-motion .fk-dice .wdie.aside { transform: none; }

/* Wide screens: dice and buttons on the left, the scoring table on the right. */
.fk-stage.wide { display: grid; grid-template-columns: 1000px 1fr; grid-template-rows: auto auto 1fr; column-gap: 40px; row-gap: 18px; }
.fk-stage.wide .fk-top { grid-area: 1 / 1; }
.fk-stage.wide .fk-strip { grid-area: 2 / 1; }
.fk-stage.wide .fk-card { grid-area: 1 / 2 / 4 / 3; align-self: center; padding: 14px 24px 12px; }
.fk-stage.wide .fk-row { grid-template-columns: 290px 1fr auto; height: 64px; gap: 14px; }
.fk-stage.wide .fk-what { font-size: 28px; white-space: normal; line-height: 1.1; }
.fk-stage.wide .fk-row b { font-size: 30px; }
.fk-stage.wide .fk-mini { width: 42px; height: 42px; padding: 5px; }
.fk-stage.wide .fk-tray, .fk-stage.wide .fk-over { grid-area: 3 / 1; align-self: end; }
.fk-stage.wide .fk-dice .wdie { --die: 136px; }
.fk-stage.wide .fk-banner { left: 0; right: auto; width: 1040px; }
`;
