// Yacht: game module (docs/games/yacht.md). Setup is plain responsive DOM like the shelf; play
// sits in a fixed design space fitted by core/stage.js (portrait 1080 wide, or a two-pane 1900x1000
// layout on wide screens). Rules in rules.js, bots in bot.js; dice, seats, the pass card and bot
// pacing come from core/.

import { CATS, LABELS, normRules, newCard, legalBoxes, boxScore, applyScore, totals, cardFull, turnsPerGame, multipliers, upperSum, isYacht, jokerIn, isUpper, boxesFilled, UPPER_NEED, UPPER_BONUS, YACHT_BONUS } from './rules.js';
import { botHold, botBox } from './bot.js';
import { makeRng } from '../../core/rng.js';
import { reroll, botDelay, BOT_SPEEDS } from '../../core/dice.js';
import { createSeats, restoreSeats, needsPass, cleanPlayers, SEAT_COLOURS } from '../../core/seats.js';
import { isPlain } from '../../core/save.js';
import { seatSetup, passScreen } from '../../core/seats-ui.js';
import { makeDie, tumble } from '../../core/dice-view.js';
import { fitStage } from '../../core/stage.js';
import { icons } from '../../core/icons.js';
import { makeSounds } from './sounds.js';

const ID = 'yacht';
const PORTRAIT = { W: 1080, H: 1820 };
const WIDE = { W: 1900, H: 1000 };
const WIDE_AT = 1.15; // aspect (w / h) above which the two-pane layout is used
const PACE = { think: 600, roll: 450, look: 700, hold: 550, pick: 850, next: 450 }; // ms at Slow; Normal x0.45, Fast x0.2 (core/dice.js botDelay)
const HIGH_N = 10;
const NO_HOLD = [false, false, false, false, false];
// Score card rows: the 13 boxes plus the upper bonus, Yacht bonus and total lines.
const ROWS = [0, 1, 2, 3, 4, 5, 'upper', 6, 7, 8, 9, 10, 11, 12, 'ybonus', 'total'];

const SETTINGS = [
  { key: 'joker', label: 'Joker rule', options: [['forced', 'Forced'], ['free', 'Free']], default: 'forced' },
  { key: 'bonus', label: 'Yacht bonus', options: [['on', '+100'], ['off', 'Off']], default: 'on' },
  { key: 'variant', label: 'Score card', options: [['classic', 'Classic'], ['triple', 'Triple']], default: 'classic' },
  { key: 'botSpeed', label: 'Bot speed', options: BOT_SPEEDS, default: 'normal' },
];

const DEFAULT_PLAYERS = [
  { name: 'Player 1', kind: 'human', level: 'medium' },
  { name: 'Rusty', kind: 'bot', level: 'medium' },
];

const BG = '#17402b';
const ICONS = { back: icons.back(), gear: icons.gear(BG), bot: icons.bot(BG), crown: icons.crown() };

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default {
  settings: SETTINGS,

  mount(root, ctx) {
    const { el, modal, toast } = ctx.ui;
    const S = ctx.settings;
    const sounds = makeSounds(ctx.audio, ctx.haptics);
    const stored = ctx.store.get() || {};
    const high = isPlain(stored.high) ? stored.high : {};
    const scores = (list) => (Array.isArray(list) ? list.filter((e) => isPlain(e) && Number.isFinite(e.score) && typeof e.date === 'string') : []);
    const save = {
      ...stored,
      setup: { players: cleanPlayers(stored.setup?.players, { min: 1, max: 4, fallback: DEFAULT_PLAYERS }) },
      game: isPlain(stored.game) ? stored.game : null,
      high: { ...high, classic: scores(high.classic), triple: scores(high.triple) },
    };
    const rng = makeRng((Date.now() ^ (Math.random() * 2 ** 32)) >>> 0);
    const params = new URLSearchParams(location.search);
    const autoplay = params.has('autoplay'); // humans are played by the Hard bot, fast (testing)
    const rm = () => !!S.get('reducedMotion');
    const speed = () => (autoplay ? 'fast' : S.get(`${ID}.botSpeed`, 'normal'));
    const pace = (k) => botDelay(speed(), PACE[k]);
    const rulesFromSettings = () =>
      normRules({ joker: S.get(`${ID}.joker`, 'forced'), bonus: S.get(`${ID}.bonus`, 'on'), variant: S.get(`${ID}.variant`, 'classic') });

    // ---- state ----
    let g = null; // the saved game: { v, rules, seats, cards, dice, held, rollsLeft, lastHuman, over, recorded, date }
    let seats = null;
    let sel = null; // { col, cat } picked but not yet scored
    let viewSeat = 0; // whose card the Triple table shows
    let flash = null; // { seat, col, cat } just scored
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
        el('h1', {}, 'Yacht'),
        el('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => ctx.openSettings() }, '⚙'),
      ),
      el('h2', {}, 'Players'),
      seatsUi.node,
      soloLine,
      el('div', { class: 'setup-rules' }, rulesLine, el('button', { class: 'btn', onclick: () => ctx.openSettings() }, 'House rules')),
      el(
        'div',
        { class: 'setup-actions' },
        el('button', { class: 'btn', onclick: () => showHigh() }, 'High scores'),
        el('button', { class: 'btn btn-primary setup-start', onclick: () => startGame(seatsUi.players()) }, 'Start'),
      ),
    );

    function rulesText(r) {
      return [r.variant === 'triple' ? 'Triple card' : 'Classic card', r.joker === 'free' ? 'free Joker' : 'forced Joker', r.bonus ? 'Yacht bonus +100' : 'no Yacht bonus'].join(' · ');
    }
    function drawSetupNotes() {
      rulesLine.textContent = rulesText(rulesFromSettings());
      const ps = seatsUi.players();
      soloLine.textContent = ps.length === 1 && ps[0].kind === 'human' ? 'Solo: chase your high score.' : ps.every((p) => p.kind === 'bot') ? 'All bots: sit back and watch.' : '';
    }

    // ---- play view ----
    const roundText = el('div', { class: 'yz-round' });
    const strip = el('div', { class: 'yz-strip' });
    const table = el('table', { class: 'yz-table' });
    const msg = el('div', { class: 'yz-msg', 'aria-live': 'polite' });
    const dice = [0, 1, 2, 3, 4].map((i) => makeDie(el, { label: `Die ${i + 1}`, onTap: () => tapDie(i) }));
    const pips = [0, 1, 2].map(() => el('i'));
    const rollBtn = el('button', { class: 'yz-btn yz-roll', onclick: () => humanRoll() });
    const scoreBtn = el('button', { class: 'yz-btn yz-score', onclick: () => sel && canAct() && scoreBox(sel) });
    const tray = el(
      'div',
      { class: 'yz-tray' },
      msg,
      el('div', { class: 'yz-dice' }, dice.map((d) => d.node)),
      el('div', { class: 'yz-pips', 'aria-hidden': 'true' }, pips),
      el('div', { class: 'yz-actions' }, rollBtn, scoreBtn),
    );
    const overPanel = el('div', { class: 'yz-over' });
    const banner = el('div', { class: 'yz-banner', 'aria-live': 'polite' });
    const stage = el(
      'div',
      { class: 'yz-stage' },
      el(
        'div',
        { class: 'yz-top' },
        el('button', { class: 'yz-icon', 'aria-label': 'Back to shelf', html: ICONS.back, onclick: ctx.exit }),
        roundText,
        el('button', { class: 'yz-icon', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openPlaySettings() }),
      ),
      strip,
      el('div', { class: 'yz-card' }, table),
      tray,
      overPanel,
      banner,
    );
    const playView = el('div', { class: 'yz-play' }, stage);
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
    const rolled = () => g && g.rollsLeft < 3;
    const humanTurn = () => g && !g.over && seats.player.kind === 'human' && !autoplay;
    const canAct = () => humanTurn() && !anim && !passing;
    const mult = (col) => multipliers(g.rules)[col];

    function startGame(players, rules = rulesFromSettings()) {
      stopTimers();
      sel = flash = null;
      const ps = players.map((p, i) => ({ name: p.name, kind: p.kind, level: p.level || 'medium', colour: SEAT_COLOURS[i].hex }));
      seats = createSeats(ps);
      g = { v: 1, rules, seats: null, cards: ps.map(() => newCard(rules)), dice: [0, 0, 0, 0, 0], held: NO_HOLD.slice(), rollsLeft: 3, lastHuman: -1, over: false, recorded: false, date: today() };
      overPanel.replaceChildren();
      persist();
      showView('play');
      beginTurn();
    }

    // A saved game that can't be played (a bug, or a hand-edited import) is kept as brokenGame and the setup
    // screen comes back, rather than a crash.
    function resumeGame() {
      try {
        g = save.game;
        g.rules = normRules(g.rules);
        seats = restoreSeats(g.seats);
        const ps = seats.players;
        const ok = ps.length >= 1 && ps.length <= 4 && cleanPlayers(ps, { min: 1, fallback: [] }).length === ps.length;
        if (!ok || !Array.isArray(g.cards) || g.cards.length !== ps.length || !Array.isArray(g.dice)) throw new Error('bad save');
        showView('play');
        if (g.over) return showOver(false);
        beginTurn();
      } catch (e) {
        console.warn('yacht: could not resume', e);
        save.brokenGame = save.game;
        g = null;
        save.game = null;
        persist();
        toast('Could not resume the last game');
        showView('setup');
      }
    }

    function beginTurn() {
      viewSeat = seats.current;
      render();
      const p = seats.player;
      if (p.kind === 'human' && !autoplay) {
        if (g.rollsLeft === 3 && needsPass(seats, g.lastHuman)) {
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
      } else {
        later(pace('think'), botStep);
      }
    }

    function doRoll(after) {
      const first = g.rollsLeft === 3;
      if (first) g.held = NO_HOLD.slice();
      g.dice = reroll(rng, g.dice, g.held);
      g.rollsLeft--;
      sel = null;
      persist();
      const moving = [0, 1, 2, 3, 4].filter((i) => !g.held[i]);
      anim = true;
      sounds.roll();
      render();
      cancelTumble = tumble(
        moving.map((i) => dice[i]),
        moving.map((i) => g.dice[i]),
        {
          reduced: rm(),
          ms: PACE.roll,
          onTick: () => sounds.rattle(),
          onDone: () => {
            anim = false;
            sounds.land();
            if (isYacht(g.dice)) {
              sounds.yacht();
              showBanner('YACHT!', 'big');
            }
            render();
            after?.();
          },
        },
      );
    }

    function humanRoll() {
      if (!canAct() || g.rollsLeft === 0 || (rolled() && g.held.every(Boolean))) return;
      doRoll();
    }

    function tapDie(i) {
      if (!canAct() || !rolled() || g.rollsLeft === 0) return;
      g.held[i] = !g.held[i];
      sounds.hold(g.held[i]);
      persist();
      render();
    }

    function tapCell(col, cat) {
      if (!canAct() || !rolled()) return;
      const legal = legalBoxes(g.cards[seats.current], g.dice, g.rules).some((b) => b.col === col && b.cat === cat);
      if (!legal) return;
      if (sel && sel.col === col && sel.cat === cat) return scoreBox(sel);
      sel = { col, cat };
      sounds.select();
      render();
    }

    function scoreBox(box) {
      const seat = seats.current;
      const r = applyScore(g.cards[seat], box.col, box.cat, g.dice, g.rules);
      sounds.score(r.score * mult(box.col));
      if (r.bonus) {
        later(150, () => sounds.bonus());
        showBanner(`+${YACHT_BONUS} Yacht bonus`, 'bonus');
      }
      sel = null;
      flash = { seat, col: box.col, cat: box.cat };
      g.dice = [0, 0, 0, 0, 0];
      g.held = NO_HOLD.slice();
      g.rollsLeft = 3;
      if (g.cards.every(cardFull)) {
        g.over = true;
        persist();
        render();
        later(pace('next'), () => showOver(true));
        return;
      }
      seats.next();
      persist();
      later(pace('next'), beginTurn);
      render();
    }

    // A bot (or an autoplayed human) works from the saved state, so it resumes mid-turn too.
    function botStep() {
      if (!g || g.over) return;
      const p = seats.player;
      const level = p.kind === 'bot' ? p.level : 'hard';
      const card = g.cards[seats.current];
      const next = () => later(pace('look'), botStep);
      if (g.rollsLeft === 3) return doRoll(next);
      const held = g.rollsLeft > 0 ? botHold(level, g.dice, g.rollsLeft, card, g.rules, rng) : null;
      if (held && !held.every(Boolean)) {
        const changed = held.some((h, i) => h !== g.held[i]);
        g.held = held;
        persist();
        if (changed) sounds.hold(true);
        render();
        later(changed ? pace('hold') : pace('hold') / 2, () => doRoll(next));
        return;
      }
      sel = botBox(level, g.dice, card, g.rules, rng);
      sounds.select();
      render();
      later(pace('pick'), () => scoreBox(sel));
    }

    // ---- game over and high scores ----
    function standings() {
      return seats.players.map((p, i) => ({ p, total: totals(g.cards[i], g.rules).total })).sort((a, b) => b.total - a.total);
    }

    function ruleTag(r) {
      return [r.joker === 'free' ? 'free Joker' : '', r.bonus ? '' : 'no bonus'].filter(Boolean).join(', ');
    }

    function showOver(fresh) {
      const st = standings();
      const top = st[0].total;
      const winners = st.filter((s) => s.total === top);
      const solo = seats.players.length === 1 && seats.players[0].kind === 'human';
      let rank = 0;
      let entry = null;
      if (solo && !g.recorded) {
        entry = { score: top, date: g.date || today(), tag: ruleTag(g.rules) };
        const list = save.high[g.rules.variant];
        list.push(entry);
        list.sort((a, b) => b.score - a.score);
        list.length = Math.min(list.length, HIGH_N);
        rank = list.indexOf(entry) + 1;
        g.recorded = true;
        g.rank = rank;
        persist();
      } else if (solo) rank = g.rank || 0;
      let title;
      let note = '';
      if (solo) {
        title = `Final score ${top}`;
        note = rank === 1 ? 'New high score!' : rank ? `#${rank} on your top ${HIGH_N}` : `Not in your top ${HIGH_N} this time`;
      } else if (winners.length > 1) title = `Tie: ${winners.map((w) => w.p.name).join(' & ')}`;
      else title = `${winners[0].p.name} wins!`;
      const parts = [
        el('h2', {}, title),
        note ? el('p', { class: `yz-note${rank === 1 ? ' best' : ''}` }, note) : null,
        solo
          ? null
          : el(
              'ol',
              { class: `yz-standings${st.length > 2 ? ' two' : ''}` },
              st.map((s) =>
                el(
                  'li',
                  { style: `--seat:${s.p.colour}` },
                  s.total === top ? el('i', { class: 'yz-crown', html: ICONS.crown }) : el('i'),
                  el('span', {}, s.p.name),
                  el('b', {}, String(s.total)),
                ),
              ),
            ),
        el(
          'div',
          { class: 'yz-actions' },
          el('button', { class: 'yz-btn yz-alt', onclick: () => (solo ? showHigh(entry || g.rank) : confirmNew()) }, solo ? 'High scores' : 'New game'),
          el('button', { class: 'yz-btn yz-roll', onclick: () => startGame(seats.players, rulesFromSettings()) }, 'Play again'),
        ),
        solo ? el('button', { class: 'yz-link', onclick: () => confirmNew() }, 'Change players') : null,
      ];
      overPanel.replaceChildren(...parts.filter(Boolean));
      render();
      if (fresh) {
        const humanWon = winners.some((w) => w.p.kind === 'human');
        sounds.over(solo ? rank > 0 : humanWon);
        if (solo && rank === 1) showBanner('New high score!', 'big');
      }
    }

    function showHigh(mark) {
      let tab = g?.rules.variant || rulesFromSettings().variant;
      const list = el('ol', { class: 'yz-high' });
      const draw = () => {
        const rows = save.high[tab];
        list.replaceChildren(
          ...(rows.length
            ? rows.map((e, i) =>
                el(
                  'li',
                  { class: e === mark || (typeof mark === 'number' && tab === g?.rules.variant && i + 1 === mark && g?.recorded) ? 'me' : '' },
                  el('b', {}, String(e.score)),
                  el('span', {}, fmtDate(e.date) + (e.tag ? ` · ${e.tag}` : '')),
                ),
              )
            : [el('li', { class: 'empty' }, 'No solo games yet. Play with one human seat to set one.')]),
        );
        segBtns.forEach((b) => b.classList.toggle('on', b.dataset.v === tab));
      };
      const segBtns = [
        ['classic', 'Classic'],
        ['triple', 'Triple'],
      ].map(([v, l]) => {
        const b = el('button', { 'data-v': v, onclick: () => ((tab = v), draw()) }, l);
        return b;
      });
      draw();
      modal({ title: 'High scores', body: [el('div', { class: 'seg yz-tabs' }, segBtns), list], actions: [{ label: 'Done', primary: true }] });
    }

    function confirmNew() {
      const finished = !g || g.over;
      const go = () => {
        stopTimers();
        document.querySelectorAll('.pass-screen').forEach((n) => n.remove());
        passing = false;
        g = null;
        persist();
        showView('setup');
      };
      if (finished) return go();
      modal({
        title: 'New game?',
        body: [el('p', { class: 'yz-p' }, 'This game will be abandoned.')],
        actions: [{ label: 'Keep playing' }, { label: 'New game', primary: true, onClick: (close) => (close(), go()) }],
      });
    }

    function openPlaySettings() {
      ctx.openSettings([{ label: 'New game', onClick: (close) => (close(), confirmNew()) }]);
    }

    let bannerTimer = 0;
    function showBanner(text, cls) {
      banner.textContent = text;
      banner.className = `yz-banner ${cls}`;
      void banner.offsetWidth; // restart the animation
      banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('show'), 1500);
    }

    // ---- render ----
    function render() {
      if (!g) return;
      const turns = turnsPerGame(g.rules);
      const filled = g.cards.reduce((a, c) => a + boxesFilled(c), 0);
      const round = Math.min(turns, Math.floor(filled / g.cards.length) + 1);
      roundText.textContent = g.over ? 'Game over' : `Round ${round} / ${turns}`;
      stage.classList.toggle('over', g.over);
      drawStrip();
      drawTable();
      drawTray();
    }

    function drawStrip() {
      const triple = g.rules.variant === 'triple';
      strip.replaceChildren(
        ...seats.players.map((p, i) =>
          el(
            'button',
            {
              class: `yz-chip${i === seats.current && !g.over ? ' cur' : ''}${triple && i === viewSeat ? ' view' : ''}`,
              style: `--seat:${p.colour}`,
              'aria-label': `${p.name}${p.kind === 'bot' ? ` (${p.level} bot)` : ''}: ${totals(g.cards[i], g.rules).total}`,
              onclick: () => {
                if (!triple) return;
                viewSeat = i;
                render();
              },
            },
            el('span', { class: 'yz-chip-name' }, p.kind === 'bot' ? el('i', { class: 'yz-bot', html: ICONS.bot }) : null, p.name),
            el('b', {}, String(totals(g.cards[i], g.rules).total)),
            p.kind === 'bot' ? el('small', {}, seats.players.length > 3 ? p.level[0] : p.level) : null,
          ),
        ),
      );
    }

    function drawTable() {
      const triple = g.rules.variant === 'triple';
      const cols = triple ? [0, 1, 2].map((c) => ({ seat: viewSeat, col: c })) : seats.players.map((_, i) => ({ seat: i, col: 0 }));
      const cur = seats.current;
      const live = !g.over && rolled() && !anim;
      const legal = live ? legalBoxes(g.cards[cur], g.dice, g.rules) : [];
      const isLegal = (col, cat) => legal.some((b) => b.col === col && b.cat === cat);
      const head = el(
        'tr',
        {},
        el('th', { class: 'yz-corner' }, triple ? seats.players[viewSeat].name : ''),
        cols.map((c) => {
          const p = seats.players[c.seat];
          return el('th', { class: c.seat === cur && !g.over ? 'cur' : '', style: `--seat:${p.colour}` }, triple ? `×${c.col + 1}` : p.name);
        }),
      );
      const rows = ROWS.map((row) => {
        if (row === 'upper') {
          return el(
            'tr',
            { class: 'yz-sub' },
            el('th', {}, `Bonus (${UPPER_NEED}+)`),
            cols.map((c) => {
              const boxes = g.cards[c.seat].cols[c.col];
              const u = upperSum(boxes);
              const full = boxes.slice(0, 6).every((v) => v !== null);
              const text = u >= UPPER_NEED ? `+${UPPER_BONUS}` : full ? '0' : `${u}/${UPPER_NEED}`;
              return el('td', { class: u >= UPPER_NEED ? 'good' : '' }, text);
            }),
          );
        }
        if (row === 'ybonus') {
          const cell = (seat) => {
            const k = g.cards[seat].ybonus;
            return k ? `+${k * YACHT_BONUS}` : g.rules.bonus ? '' : 'off';
          };
          return el(
            'tr',
            { class: 'yz-sub' },
            el('th', {}, 'Yacht bonus'),
            triple ? el('td', { colspan: 3 }, cell(viewSeat)) : cols.map((c) => el('td', { class: g.cards[c.seat].ybonus ? 'good' : '' }, cell(c.seat))),
          );
        }
        if (row === 'total') {
          return el(
            'tr',
            { class: 'yz-total' },
            el('th', {}, 'Total'),
            cols.map((c) => {
              const t = totals(g.cards[c.seat], g.rules);
              return el('td', {}, String(triple ? t.cols[c.col].total : t.total));
            }),
          );
        }
        const cat = row;
        return el(
          'tr',
          { class: cat === 6 ? 'yz-lower1' : '' },
          el('th', {}, LABELS[cat]),
          cols.map((c) => {
            const v = g.cards[c.seat].cols[c.col][cat];
            const mine = c.seat === cur && !g.over;
            const isSel = mine && sel && sel.col === c.col && sel.cat === cat;
            const fl = flash && flash.seat === c.seat && flash.col === c.col && flash.cat === cat;
            if (v !== null) return el('td', { class: `done${fl ? ' flash' : ''}` }, String(v));
            if (!mine || !live) return el('td', { class: mine ? 'cur' : '' });
            if (!isLegal(c.col, cat)) return el('td', { class: 'cur off' });
            const s = boxScore(g.cards[cur], c.col, cat, g.dice);
            return el(
              'td',
              {
                class: `cur can${s === 0 ? ' zero' : ''}${isSel ? ' sel' : ''}`,
                role: 'button',
                'aria-label': `${LABELS[cat]}${triple ? ` times ${c.col + 1}` : ''}: ${s}`,
                onclick: () => tapCell(c.col, cat),
              },
              String(s),
            );
          }),
        );
      });
      table.className = `yz-table${triple ? ' triple' : ''} n${cols.length}`;
      table.replaceChildren(el('thead', {}, head), el('tbody', {}, rows));
      flash = null;
    }

    function jokerNote() {
      if (!rolled() || !isYacht(g.dice)) return '';
      const card = g.cards[seats.current];
      const cols = card.cols.map((_, c) => c).filter((c) => jokerIn(card, c, g.dice));
      if (!cols.length) return '';
      const where = g.rules.variant === 'triple' ? ' (columns with YACHT filled)' : '';
      if (g.rules.joker === 'free') return `Joker: any box. Full house and straights score in full${where}`;
      const c = cols[0];
      const face = g.dice[0] - 1;
      if (card.cols[c][face] === null) return `Joker: score it in ${LABELS[face]}${where}`;
      if (card.cols[c].some((v, k) => v === null && !isUpper(k))) return `Joker: any lower box scores in full${where}`;
      return `Joker: take a 0 in an upper box${where}`;
    }

    function drawTray() {
      const p = seats.player;
      const human = humanTurn();
      dice.forEach((d, i) => {
        if (!anim || g.held[i]) d.set(g.dice[i]);
        d.hold(rolled() && g.held[i]);
        d.node.disabled = !human || !rolled() || g.rollsLeft === 0;
      });
      pips.forEach((pip, i) => pip.classList.toggle('on', i < g.rollsLeft));
      let text;
      if (g.over) text = '';
      else if (!human) text = sel ? `${p.name} scores ${LABELS[sel.cat]}` : `${p.name} is playing`;
      else if (!rolled()) text = seats.players.length > 1 ? `${p.name}, roll the dice` : 'Roll the dice';
      else text = jokerNote() || (g.rollsLeft > 0 ? 'Tap dice to hold, roll again, or pick a box' : 'Pick a box to score');
      msg.textContent = text;
      const allHeld = rolled() && g.held.every(Boolean);
      rollBtn.textContent = !rolled() ? 'Roll' : g.rollsLeft === 0 ? 'No rolls left' : allHeld ? 'All held' : `Roll again (${g.rollsLeft})`;
      rollBtn.disabled = !human || anim || passing || g.rollsLeft === 0 || allHeld;
      if (sel && rolled()) {
        const card = g.cards[seats.current];
        const s = boxScore(card, sel.col, sel.cat, g.dice);
        const label = `${LABELS[sel.cat]}${g.rules.variant === 'triple' ? ` ×${sel.col + 1}` : ''}`;
        scoreBtn.textContent = s === 0 ? `Score 0 in ${label}` : `Score ${s} · ${label}`;
        scoreBtn.classList.toggle('zero', s === 0);
      } else {
        scoreBtn.textContent = rolled() ? 'Pick a box' : 'Score';
        scoreBtn.classList.remove('zero');
      }
      scoreBtn.disabled = !human || !sel || anim;
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
    if (autoplay || params.has('debug')) window.__yz = () => ({ save, g, seats, sel });

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
.yz-p { margin: 0; text-align: center; font-size: 17px; }
.yz-tabs { justify-content: center; margin: 0 auto 4px; }
.yz-high { margin: 0; padding: 0; list-style: none; counter-reset: r; display: grid; gap: 6px; }
.yz-high li { counter-increment: r; display: flex; align-items: baseline; gap: 12px; padding: 8px 12px; border-radius: 12px; background: #fff; }
.yz-high li::before { content: counter(r) '.'; width: 28px; font-weight: 800; color: #8a90a8; }
.yz-high li b { font-size: 20px; min-width: 52px; }
.yz-high li span { font-size: 14px; color: #5a6078; }
.yz-high li.me { background: #fff1c2; box-shadow: inset 0 0 0 2px #e0a020; }
.yz-high li.empty::before { content: none; }
.yz-high li.empty { color: #5a6078; font-size: 15px; }

.yz-play { position: absolute; inset: 0; overflow: hidden;
  background: radial-gradient(ellipse at 50% 30%, #23603f, #17402b 75%); }
.yz-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; display: flex; flex-direction: column; gap: 18px;
  padding: 22px 30px 30px; font-family: var(--font); color: #fff; }
.yz-stage button:not(.wdie) { font: inherit; color: inherit; border: 0; background: none; padding: 0; }
.yz-top { display: flex; align-items: center; justify-content: space-between; height: 96px; flex: none; }
.yz-icon { width: 96px; height: 96px; border-radius: 50%; background: #0003 !important; color: #f4d27a !important; padding: 20px !important; }
.yz-icon svg { width: 100%; height: 100%; display: block; }
.yz-round { font-size: 46px; font-weight: 900; text-shadow: 0 4px 0 #0005; }
.yz-strip { display: flex; gap: 14px; flex: none; }
.yz-chip { flex: 1 1 0; min-width: 0; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 118px; border-radius: 28px; background: #0003 !important; border-bottom: 10px solid var(--seat) !important; opacity: .8; }
.yz-chip.cur { opacity: 1; background: #ffffff26 !important; box-shadow: 0 0 0 5px var(--seat); }
.yz-chip.view { outline: 4px dashed #fff8; outline-offset: -10px; }
.yz-chip-name { display: flex; align-items: center; gap: 8px; max-width: 92%; font-size: 32px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.yz-bot { width: 34px; height: 34px; flex: none; color: #f4d27a; }
.yz-bot svg { width: 100%; height: 100%; display: block; }
.yz-chip b { font-size: 46px; font-weight: 900; line-height: 1.05; }
.yz-chip small { position: absolute; right: 14px; bottom: 6px; font-size: 22px; font-weight: 800; opacity: .7; text-transform: uppercase; }
.yz-card { flex: none; background: #fbf7ea; border-radius: 34px; padding: 8px 14px 12px; color: #23304a; box-shadow: 0 10px 24px #0006, inset 0 -6px 0 #0001; }
.yz-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 38px; }
.yz-table th, .yz-table td { height: 60px; padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.yz-table th { text-align: left; font-weight: 800; font-size: 34px; }
.yz-table thead th:first-child { width: 33%; }
.yz-table.n4 th { font-size: 31px; }
.yz-table thead th { height: 64px; text-align: center; font-size: 30px; color: #fff; background: var(--seat, #6a7a6a); border-left: 4px solid #fbf7ea;
  border-radius: 18px 18px 0 0; opacity: .75; }
.yz-table thead th.cur { opacity: 1; }
.yz-table.triple thead th { background: #4b6b58; }
.yz-table.triple thead th.cur { background: #2f6a46; }
.yz-table thead th.yz-corner { background: none; color: #23304a; text-align: left; opacity: 1; font-size: 32px; }
.yz-table td { text-align: center; font-weight: 800; border-left: 3px solid #e6dec4; border-top: 2px solid #ece5cf; }
.yz-table tbody th { border-top: 2px solid #ece5cf; }
.yz-table td.cur { background: #fff3cf; }
.yz-table td.can { color: #8d95a8; font-style: italic; cursor: pointer; }
.yz-table td.can.zero { color: #c9a2a2; }
.yz-table td.off { background: repeating-linear-gradient(135deg, #f1ead4 0 10px, #e9e1c7 10px 20px); }
.yz-table td.sel { background: #ffd968; color: #23304a; font-style: normal; box-shadow: inset 0 0 0 6px #d99a10; }
.yz-table td.sel.zero { background: #ffb4a8; box-shadow: inset 0 0 0 6px #c04a3a; }
.yz-table td.flash { animation: yz-flash .8s ease-out; }
.yz-table tr.yz-sub th, .yz-table tr.yz-sub td { height: 50px; font-size: 28px; color: #6a7088; background: #f2ebd5; }
.yz-table tr.yz-sub td.good { color: #2a8a3a; }
.yz-table tr.yz-lower1 th, .yz-table tr.yz-lower1 td { border-top: 4px solid #d8cfb2; }
.yz-table tr.yz-total th, .yz-table tr.yz-total td { height: 66px; font-size: 40px; font-weight: 900; border-top: 4px solid #23304a; }
.yz-tray { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 22px; flex: none; }
.yz-msg { min-height: 50px; font-size: 36px; font-weight: 700; text-align: center; opacity: .92; }
.yz-dice { display: flex; gap: 30px; padding-top: 20px; }
.yz-dice .wdie { --die: 168px; }
.yz-pips { display: flex; gap: 16px; }
.yz-pips i { width: 24px; height: 24px; border-radius: 50%; background: #0004; box-shadow: inset 0 0 0 3px #f4b82866; }
.yz-pips i.on { background: #f4b828; box-shadow: none; }
.yz-actions { display: flex; gap: 24px; width: 100%; }
.yz-btn { flex: 1 1 0; min-width: 0; height: 132px; border-radius: 38px !important; font-size: 44px !important; font-weight: 900;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 24px !important; box-shadow: 0 10px 0 #0005; }
.yz-btn:active { transform: translateY(5px); box-shadow: 0 5px 0 #0005; }
.yz-btn:disabled { filter: grayscale(.7); opacity: .45; transform: none; box-shadow: 0 10px 0 #0003; }
.yz-roll { background: linear-gradient(#ffd451, #e9a210) !important; color: #3a2400 !important; }
.yz-score { background: linear-gradient(#5ad06a, #2c9a3e) !important; color: #fff !important; }
.yz-score.zero { background: linear-gradient(#ff8a7a, #d0443a) !important; }
.yz-alt { background: #ffffff2a !important; color: #fff !important; }
.yz-over { display: none; margin-top: auto; flex-direction: column; align-items: center; gap: 18px; flex: none; }
.yz-stage.over .yz-tray { display: none; }
.yz-stage.over .yz-over { display: flex; }
.yz-over h2 { margin: 0; font-size: 64px; font-weight: 900; text-shadow: 0 5px 0 #0005; text-align: center; }
.yz-note { margin: 0; font-size: 40px; font-weight: 800; opacity: .9; }
.yz-note.best { color: #ffd451; }
.yz-standings { list-style: none; margin: 0; padding: 0; width: 100%; display: grid; gap: 10px; }
.yz-standings li { display: flex; align-items: center; gap: 16px; padding: 0 28px; height: 74px; border-radius: 24px; background: #0003;
  border-left: 12px solid var(--seat); font-size: 40px; font-weight: 800; }
.yz-standings li i { width: 52px; height: 52px; flex: none; }
.yz-standings li i svg { width: 100%; height: 100%; display: block; }
.yz-standings li span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.yz-standings li b { font-size: 48px; }
.yz-standings.two { grid-template-columns: 1fr 1fr; }
.yz-standings.two li { padding: 0 20px; gap: 10px; font-size: 36px; }
.yz-standings.two li b { font-size: 42px; }
.yz-link { font-size: 34px !important; font-weight: 800; text-decoration: underline; opacity: .8; padding: 8px 20px !important; }
.yz-banner { position: absolute; left: 0; right: 0; top: 38%; text-align: center; pointer-events: none; opacity: 0; font-weight: 900;
  color: #ffd451; -webkit-text-stroke: 16px #5a2a00; paint-order: stroke fill; text-shadow: 0 10px 20px #0008; }
.yz-banner.big { font-size: 150px; }
.yz-banner.bonus { font-size: 84px; color: #b8f070; -webkit-text-stroke: 12px #1a4a10; }
.yz-banner.show { animation: yz-banner 1.5s forwards; }
@keyframes yz-banner { 0% { opacity: 0; transform: scale(.4); } 15% { opacity: 1; transform: scale(1.06); } 25%, 80% { opacity: 1; transform: none; } 100% { opacity: 0; } }
@keyframes yz-flash { from { background: #ffd968; } }
.reduced-motion .yz-banner.show { animation: yz-banner-rm 1.5s forwards; }
@keyframes yz-banner-rm { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }
.reduced-motion .yz-table td.flash { animation: none; }

/* Wide screens: dice and buttons on the left, the card on the right. */
.yz-stage.wide { display: grid; grid-template-columns: 820px 1fr; grid-template-rows: auto auto 1fr; column-gap: 40px; row-gap: 18px; }
.yz-stage.wide .yz-top { grid-area: 1 / 1; }
.yz-stage.wide .yz-strip { grid-area: 2 / 1; }
.yz-stage.wide .yz-card { grid-area: 1 / 2 / 4 / 3; align-self: center; }
.yz-stage.wide .yz-tray, .yz-stage.wide .yz-over { grid-area: 3 / 1; align-self: end; }
.yz-stage.wide .yz-table th, .yz-stage.wide .yz-table td { height: 52px; }
.yz-stage.wide .yz-table tr.yz-sub th, .yz-stage.wide .yz-table tr.yz-sub td { height: 44px; }
.yz-stage.wide .yz-dice { gap: 22px; }
.yz-stage.wide .yz-dice .wdie { --die: 140px; }
.yz-stage.wide .yz-banner { left: 0; right: auto; width: 860px; }
`;
