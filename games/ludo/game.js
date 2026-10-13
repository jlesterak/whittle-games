// Ludo: game module (docs/ludo-spec.md). Setup is plain responsive DOM like Yacht's; play sits in
// a fixed design space fitted by core/stage.js (portrait 1080 wide, or 1900x1000 with the board on
// the right). Rules in rules.js, bots in bot.js, board drawing in board.js; seats, the pass card,
// the die and bot pacing come from core/.

import { normRules, newGame, loadGame, finished, cornersFor, applyRoll, applyMove, legalMoves, distinctMoves, standings, YARD, HOME } from './rules.js';
import { botMove } from './bot.js';
import { layout, hopPath, boardSvg, tokenSvg, puSvg, puIcon, TRACK_XY } from './board.js';
import { KINDS, KIND_ORDER } from './powerups.js';
import { makeRng } from '../../core/rng.js';
import { rollDie, botDelay, BOT_SPEEDS } from '../../core/dice.js';
import { needsPassAt, SEAT_COLOURS } from '../../core/seats.js';
import { seatSetup, passScreen } from '../../core/seats-ui.js';
import { makeDie, tumble } from '../../core/dice-view.js';
import { fitStage } from '../../core/stage.js';
import { icons } from '../../core/icons.js';
import { makeSounds } from './sounds.js';

const ID = 'ludo';
const BG = '#1d3a4f';
const PORTRAIT = { W: 1080, H: 1660 };
const WIDE = { W: 1900, H: 1000 };
const WIDE_AT = 1.15; // aspect (w / h) above which the board goes on the right
const PACE = { power: 750, roll: 500, think: 400, look: 450, lift: 300, hop: 110, next: 350, none: 950, auto: 380, capture: 600, place: 2600 }; // ms at Normal (spec 3)
const ROLL_MS = 450;
const TAP_RADIUS = 1.25; // board squares: a tap this close to a movable token picks it
const ICONS = { back: icons.back(), gear: icons.gear(BG), bot: icons.bot(BG), crown: icons.crown() };

const onOff = [['on', 'On'], ['off', 'Off']];
const offOn = [['off', 'Off'], ['on', 'On']];
const SETTINGS = [
  { key: 'exit', label: 'Leave yard on', options: [['6', '6'], ['16', '1 or 6']], default: '6' },
  { key: 'safe', label: 'Safe squares', options: onOff, default: 'on' },
  { key: 'blockades', label: 'Blockades', options: offOn, default: 'off' },
  { key: 'exact', label: 'Finish', options: [['on', 'Exact'], ['off', 'Overshoot']], default: 'on' },
  { key: 'captureBonus', label: 'Roll again on capture', options: offOn, default: 'off' },
  { key: 'homeBonus', label: 'Roll again on home', options: offOn, default: 'off' },
  { key: 'powerups', label: 'Powerups', options: offOn, default: 'off' },
  { key: 'autoRoll', label: 'Auto-roll', options: onOff, default: 'on' },
  { key: 'autoMove', label: 'Auto-move single moves', options: onOff, default: 'on' },
  { key: 'botSpeed', label: 'Bot speed', options: BOT_SPEEDS, default: 'normal' },
];
const RULE_KEYS = ['exit', 'safe', 'blockades', 'exact', 'captureBonus', 'homeBonus', 'powerups'];
const colourAt = (i, n) => SEAT_COLOURS[cornersFor(Math.max(2, n))[i]];
const today = () => new Date().toISOString().slice(0, 10);
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][n] || 'th'}`;

export default {
  settings: SETTINGS,

  mount(root, ctx) {
    const { el, modal, toast } = ctx.ui;
    const S = ctx.settings;
    const sounds = makeSounds(ctx.audio, ctx.haptics);
    const save = {
      setup: {
        players: [
          { name: 'Player 1', kind: 'human', level: 'medium' },
          { name: 'Rusty', kind: 'bot', level: 'medium' },
          { name: 'Pip', kind: 'bot', level: 'medium' },
          { name: 'Dot', kind: 'bot', level: 'medium' },
        ],
      },
      game: null,
      ...(ctx.store.get() || {}),
    };
    const rng = makeRng((Date.now() ^ (Math.random() * 2 ** 32)) >>> 0);
    const params = new URLSearchParams(location.search);
    const autoplay = params.has('autoplay'); // humans are played by the Hard bot, fast (testing)
    const rm = () => !!S.get('reducedMotion');
    const speed = () => (autoplay ? 'fast' : S.get(`${ID}.botSpeed`, 'normal'));
    const pace = (k) => botDelay(speed(), PACE[k]);
    const setting = (k) => S.get(`${ID}.${k}`, SETTINGS.find((s) => s.key === k).default);
    const autoRoll = () => setting('autoRoll') === 'on';
    const rulesFromSettings = () => normRules(Object.fromEntries(RULE_KEYS.map((k) => [k, setting(k)])));

    // ---- state ----
    let g = null; // the saved game: rules state (rules.js) + { players, lastHuman, date }
    let moves = null; // legal moves while the player to move chooses
    let lifted = -1; // token a bot has picked (raised before it moves)
    let dieFace = 0; // 0 = blank die (not rolled this turn)
    let note = ''; // message line
    let extraNote = ''; // why the same player rolls again
    const shown = new Map(); // 'seat:token' -> position shown while animating
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
      shown.clear();
    };

    function persist() {
      save.game = g;
      ctx.store.set(save);
    }

    // ---- setup view ----
    const rulesLine = el('p', { class: 'setup-rules-line' });
    const setupNote = el('p', { class: 'setup-note' });
    const seatsUi = seatSetup(el, {
      players: save.setup.players,
      min: 2,
      colourAt,
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
        el('h1', {}, 'Ludo'),
        el('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => ctx.openSettings() }, '⚙'),
      ),
      el('h2', {}, 'Players'),
      seatsUi.node,
      setupNote,
      el('div', { class: 'setup-rules' }, rulesLine, el('button', { class: 'btn', onclick: () => ctx.openSettings() }, 'House rules')),
      el('div', { class: 'setup-actions' }, el('button', { class: 'btn btn-primary setup-start', onclick: () => startGame(seatsUi.players()) }, 'Start')),
    );

    function rulesText(r) {
      return [
        r.exit === '16' ? 'leave on 1 or 6' : 'leave on a 6',
        r.safe ? 'safe squares' : 'no safe squares',
        r.blockades ? 'blockades' : '',
        r.exact ? 'exact finish' : 'overshoot finish',
        r.captureBonus ? 'roll again on capture' : '',
        r.homeBonus ? 'roll again on home' : '',
        r.powerups ? 'powerups' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    function drawSetupNotes() {
      const r = rulesFromSettings();
      const classic = JSON.stringify(r) === JSON.stringify(normRules());
      rulesLine.textContent = `${classic ? 'Classic rules: ' : 'House rules: '}${rulesText(r)}`;
      const ps = seatsUi.players();
      setupNote.textContent = ps.every((p) => p.kind === 'bot') ? 'All bots: sit back and watch.' : ps.length === 2 ? 'Two players sit opposite: red and yellow.' : '';
    }

    // ---- play view ----
    const turnText = el('div', { class: 'ld-turn' });
    const legendBtn = el('button', { class: 'ld-icon ld-legend-btn', 'aria-label': 'What the powerups do', onclick: () => openLegend() }, '?');
    const strip = el('div', { class: 'ld-strip' });
    const board = el('div', { class: 'ld-board', onclick: (e) => tapBoard(e) });
    const tokenLayer = el('div', { class: 'ld-tokens' });
    const banner = el('div', { class: 'ld-banner', 'aria-live': 'polite' });
    const puLayer = el('div', { class: 'ld-pu' });
    const msg = el('div', { class: 'ld-msg', 'aria-live': 'polite' });
    const die = makeDie(el, { label: 'Die', onTap: () => humanRoll() });
    const dieBox = el('div', { class: 'ld-diebox' }, die.node);
    const tray = el('div', { class: 'ld-tray' }, msg, dieBox);
    const overPanel = el('div', { class: 'ld-over' });
    const stage = el(
      'div',
      { class: 'ld-stage' },
      el(
        'div',
        { class: 'ld-top' },
        el('button', { class: 'ld-icon', 'aria-label': 'Back to shelf', html: ICONS.back, onclick: ctx.exit }),
        turnText,
        legendBtn,
        el('button', { class: 'ld-icon', 'aria-label': 'Settings', html: ICONS.gear, onclick: () => openPlaySettings() }),
      ),
      strip,
      el('div', { class: 'ld-gap' }),
      board,
      tray,
      overPanel,
    );
    const playView = el('div', { class: 'ld-play' }, stage);
    root.append(setupView, playView, el('style', {}, CSS));
    let puDrawn = ''; // what the powerup layer shows now
    let holdPu = null; // the powerup list to keep showing while an effect plays out
    let tokNodes = []; // [seat][token] -> button

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
      const wide = w / h > WIDE_AT;
      const d = wide ? WIDE : PORTRAIT;
      const f = fitStage(w, h, d);
      stage.classList.toggle('wide', wide);
      stage.style.width = `${d.W}px`;
      stage.style.height = `${h / f.scale}px`;
      stage.style.transform = `translate(${f.offX}px, 0) scale(${f.scale})`;
    }

    // The board SVG and one button per token, rebuilt per game (rules decide the stars).
    function buildBoard() {
      const symbols = !!S.get('colourblind');
      board.innerHTML = boardSvg({ seated: g.corners, safe: g.rules.safe, symbols });
      tokNodes = g.players.map((p, s) =>
        [0, 1, 2, 3].map((t) => {
          const b = el('button', { class: 'ld-tok', type: 'button', html: tokenSvg(g.corners[s], symbols) });
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            pick(s, t);
          });
          return b;
        }),
      );
      tokenLayer.replaceChildren(...tokNodes.flat());
      board.append(puLayer, tokenLayer, banner);
      puDrawn = '';
      legendBtn.hidden = !g.rules.powerups;
    }

    // ---- game flow ----
    const player = () => g.players[g.turn];
    const humanTurn = () => g && g.phase !== 'over' && player().kind === 'human' && !autoplay;
    const canRoll = () => humanTurn() && g.phase === 'roll' && !anim && !passing;
    const choosing = () => humanTurn() && g.phase === 'move' && moves && !anim && !passing;

    function startGame(players, rules = rulesFromSettings()) {
      stopTimers();
      closePass();
      const n = players.length;
      const corners = cornersFor(n);
      const ps = players.map((p, i) => ({ name: p.name, kind: p.kind, level: p.level || 'medium', colour: SEAT_COLOURS[corners[i]].hex }));
      g = { ...newGame(n, rules, ps.map((p) => p.kind === 'human'), (rng.next() * 2 ** 31) >>> 0), players: ps, lastHuman: -1, date: today() };
      overPanel.replaceChildren();
      buildBoard();
      persist();
      showView('play');
      beginTurn();
    }

    function resumeGame() {
      try {
        g = loadGame(save.game);
        if (!Array.isArray(g.humans)) g.humans = g.players.map((p) => p.kind === 'human'); // v1 saves
        if (g.tokens.length !== g.players.length || g.corners.length !== g.players.length) throw new Error('bad save');
      } catch (e) {
        console.warn('ludo: could not resume', e);
        g = null;
        save.game = null;
        return showView('setup');
      }
      buildBoard();
      showView('play');
      if (g.phase === 'over') return showOver(false);
      beginTurn();
    }

    function beginTurn() {
      moves = null;
      lifted = -1;
      const p = player();
      dieFace = g.phase === 'move' ? g.die : 0;
      note = humanTurn() ? extraNote || (autoRoll() ? `${p.name} rolls…` : `${p.name}, tap the die`) : extraNote ? `${p.name} rolls again` : `${p.name}'s turn`;
      extraNote = '';
      if (g.skipped.length) {
        const names = g.skipped.map((q) => g.players[q].name).join(' and ');
        showBanner('Skipped!', 'pb');
        sounds.power(false, 'freeze');
        g.skipped = [];
        persist();
        note = `${names} ${g.players.length > 2 && names.includes(' and ') ? 'are' : 'is'} frozen: turn skipped`;
      }
      render();
      if (g.phase === 'move') {
        // resumed between a roll and its move
        moves = legalMoves(g);
        return humanTurn() ? offerMoves() : later(pace('look'), botChoose);
      }
      if (!humanTurn()) return later(pace('think'), doRoll);
      if (needsPassAt(g.players, g.turn, g.lastHuman)) {
        passing = true;
        sounds.pass();
        root.append(
          passScreen(el, {
            name: p.name,
            colour: p.colour,
            onGo: () => {
              passing = false;
              g.lastHuman = g.turn;
              persist();
              render();
              rollSoon();
            },
          }),
        );
        render();
        return;
      }
      g.lastHuman = g.turn;
      persist();
      rollSoon();
    }

    // Auto-roll: the human is only asked to act when a token has to be chosen.
    function rollSoon() {
      if (autoRoll()) later(botDelay('normal', PACE.roll), () => canRoll() && doRoll());
    }

    function humanRoll() {
      if (canRoll()) doRoll();
    }

    function doRoll() {
      if (!g || g.phase !== 'roll') return;
      const seat = g.turn;
      const value = rollDie(rng);
      const res = applyRoll(g, value);
      persist();
      anim = true;
      note = `${g.players[seat].name} rolls…`;
      sounds.roll();
      render(seat);
      cancelTumble = tumble([die], [value], {
        reduced: rm(),
        ms: ROLL_MS,
        onTick: () => sounds.rattle(),
        onDone: () => {
          anim = false;
          dieFace = value;
          sounds.land();
          afterRoll(seat, value, res);
        },
      });
    }

    function afterRoll(seat, value, res) {
      const p = g.players[seat];
      const human = p.kind === 'human' && !autoplay;
      if (res.kind === 'forfeit') {
        note = 'Three 6s in a row: turn lost';
        sounds.forfeit();
        showBanner('Three 6s!', 'bad');
        render(seat);
        later(pace('none') * 1.4, beginTurn);
        return;
      }
      if (res.kind === 'none') {
        const stuck = g.tokens[seat].every((r) => r === YARD || r === HOME);
        note = `${human ? 'No move' : `${p.name}: no move`}${stuck ? ` (a ${g.rules.exit === '16' ? '1 or 6' : '6'} leaves the yard)` : ''}`;
        if (res.extra) extraNote = 'Rolled a 6: roll again';
        sounds.none();
        render(seat);
        later(pace('none'), beginTurn);
        return;
      }
      moves = res.moves;
      if (human) offerMoves();
      else {
        note = `${p.name} rolled ${value}`;
        render();
        later(pace('look'), botChoose);
      }
    }

    function offerMoves() {
      const options = distinctMoves(moves);
      const auto = options.length === 1 && setting('autoMove') === 'on';
      note = auto ? 'Only one move' : `Tap a glowing token${g.die === 6 ? ', then roll again' : ''}`;
      render();
      if (auto) later(botDelay('normal', PACE.auto), () => choosing() && doMove(options[0]));
    }

    function botChoose() {
      if (!g || g.phase !== 'move') return;
      const p = player();
      const m = botMove(p.kind === 'bot' ? p.level : 'hard', g, rng, moves);
      lifted = m.token;
      render();
      later(pace('lift'), () => doMove(m));
    }

    // A human picks a token (its button, or a tap near it on the board).
    function pick(seat, token) {
      if (!choosing() || seat !== g.turn) return;
      const m = moves.find((x) => x.token === token);
      if (!m) return;
      sounds.tap();
      doMove(m);
    }

    function tapBoard(e) {
      if (!g) return;
      const r = board.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 15;
      const y = ((e.clientY - r.top) / r.height) * 15;
      if (!choosing()) return tip(x, y);
      const spots = layout(g.corners, g.tokens).filter((it) => it.seat === g.turn && moves.some((m) => m.token === it.token));
      let best = null;
      let bestD = TAP_RADIUS;
      for (const it of spots) {
        const d = Math.hypot(it.x - x, it.y - y);
        if (d < bestD) {
          bestD = d;
          best = it;
        }
      }
      if (best) pick(best.seat, best.token);
      else tip(x, y);
    }

    // Tapping a powerup square names it.
    function tip(x, y) {
      const p = g.pu.find(({ sq }) => Math.hypot(TRACK_XY[sq][0] - x, TRACK_XY[sq][1] - y) < 0.6);
      if (p) toast(`${KINDS[p.kind].name} ${KINDS[p.kind].text}`, 2200);
    }

    function openLegend() {
      modal({
        title: 'Powerups',
        body: [
          el('p', { class: 'ld-p' }, 'End a move on one to trigger it. A used square reappears elsewhere.'),
          ...KIND_ORDER.map((k) =>
            el('div', { class: 'ld-leg' }, el('i', { html: puIcon(k, undefined, 44) }), el('b', {}, KINDS[k].name.replace('!', '')), el('span', {}, KINDS[k].text)),
          ),
        ],
        actions: [{ label: 'Got it', primary: true }],
      });
    }

    function doMove(m) {
      if (!g || g.phase !== 'move') return;
      const seat = g.turn;
      const before = g.tokens.map((ts) => ts.slice());
      const res = applyMove(g, m);
      moves = null;
      lifted = -1;
      persist();
      anim = true;
      const key = `${seat}:${m.token}`;
      for (const [s, t] of res.captures) shown.set(`${s}:${t}`, before[s][t]);
      const path = rm() ? [m.to] : hopPath(m.from, m.to);
      note = `${g.players[seat].name} moves`;
      let i = 0;
      const step = () => {
        shown.set(key, path[i]);
        tokNodes[seat][m.token].classList.add('moving');
        if (m.from === YARD) sounds.exit();
        else sounds.hop(i);
        render(seat);
        i++;
        later(pace('hop'), i < path.length ? step : landed);
      };
      const pw = res.power;
      if (pw) {
        // hold the board as it was until the effect has been shown
        shown.set(`${seat}:${m.token}`, m.to);
        for (const [s, t] of pw.captures) shown.set(`${s}:${t}`, before[s][t]);
        if (pw.swapped) shown.set(`${pw.swapped[0]}:${pw.swapped[1]}`, before[pw.swapped[0]][pw.swapped[1]]);
        holdPu = g.pu.map((p) => (p.sq === pw.respawn.sq ? { sq: pw.sq, kind: pw.kind } : p));
      }
      const landed = () => {
        tokNodes[seat][m.token].classList.remove('moving');
        if (!pw) shown.delete(key);
        for (const [s, t] of res.captures) {
          shown.delete(`${s}:${t}`);
          tokNodes[s][t].classList.add('sent');
        }
        if (res.captures.length) {
          sounds.capture();
          showBanner(res.captures.length > 1 ? `Captured ${res.captures.length}!` : 'Captured!', 'cap');
        } else if (res.home) {
          sounds.home();
          if (!res.finished) showBanner('Home!', 'home');
        }
        render(seat);
        if (pw) later(res.captures.length ? pace('capture') : 0, powerStage);
        else finish();
      };
      // the effect: name it, then let the tokens move
      const powerStage = () => {
        const k = KINDS[pw.kind];
        sounds.power(k.good, pw.kind);
        showBanner(k.name, k.good ? 'pg' : 'pb');
        note = `${g.players[seat].name}: ${k.text.toLowerCase()}`;
        render(seat);
        later(pace('power'), () => {
          shown.delete(key);
          for (const [s, t] of pw.captures) {
            shown.delete(`${s}:${t}`);
            tokNodes[s][t].classList.add('sent');
          }
          tokNodes[seat][m.token].classList.add('warp');
          if (pw.swapped) {
            shown.delete(`${pw.swapped[0]}:${pw.swapped[1]}`);
            tokNodes[pw.swapped[0]][pw.swapped[1]].classList.add('warp');
          }
          holdPu = null;
          if (pw.captures.length) sounds.capture();
          render(seat);
          later(pw.captures.length ? pace('capture') : pace('next'), finish);
        });
      };
      const finish = () => {
        if (res.extra) {
          extraNote = g.die === 6 ? 'Rolled a 6: roll again' : res.captures.length && g.rules.captureBonus ? 'Capture bonus: roll again' : pw?.extra ? 'Powerup: roll again' : 'Home bonus: roll again';
        }
        if (res.finished) {
          // all four home: a place, a short celebration, then play goes on without them
          const name = g.players[seat].name;
          showBanner(res.place === 1 ? `${name} wins!` : `${name} is ${ordinal(res.place)}!`, 'win');
          note = `${name} finished ${ordinal(res.place)}`;
          if (!res.over) sounds.over(g.players[seat].kind === 'human' || !g.humans.some(Boolean));
        }
        render(seat);
        if (res.over) {
          later(pace('place'), () => {
            anim = false;
            showOver(true);
          });
          return;
        }
        later(res.finished ? pace('place') : res.captures.length && !pw ? pace('capture') : pace('next'), () => {
          anim = false;
          tokNodes.flat().forEach((n) => n.classList.remove('sent', 'warp'));
          beginTurn();
        });
      };
      step();
    }

    // ---- game over ----
    function showOver(fresh) {
      const order = standings(g); // the finishing order (all seats once the game is over; v1 saves: winner first)
      const w = g.players[g.winner];
      const home = (s) => g.tokens[s].filter((r) => r === HOME).length;
      const out = (s) => g.tokens[s].filter((r) => r !== HOME && r !== YARD).length;
      overPanel.replaceChildren(
        el(
          'div',
          { class: 'ld-over-card' },
          el('h2', {}, `${w.name} wins!`),
          el(
            'ol',
            { class: 'ld-standings' },
            order.map((s) => {
              const p = g.players[s];
              return el(
                'li',
                { style: `--seat:${p.colour}` },
                s === g.winner ? el('i', { class: 'ld-crown', html: ICONS.crown }) : el('i', { class: 'ld-place' }, ordinal(order.indexOf(s) + 1)),
                el('span', {}, p.name),
                el('small', {}, home(s) === 4 ? 'all home' : `${home(s)} home${out(s) ? ` · ${out(s)} out` : ''}`),
              );
            }),
          ),
          el(
            'div',
            { class: 'ld-actions' },
            el('button', { class: 'ld-btn ld-alt', onclick: () => confirmNew() }, 'New game'),
            el('button', { class: 'ld-btn ld-go', onclick: () => startGame(g.players, rulesFromSettings()) }, 'Play again'),
          ),
        ),
      );
      stage.classList.add('over');
      render();
      if (fresh) {
        const humans = g.players.filter((p) => p.kind === 'human');
        sounds.over(!humans.length || w.kind === 'human');
      }
    }

    function closePass() {
      document.querySelectorAll('.pass-screen').forEach((n) => n.remove());
      passing = false;
    }

    function confirmNew() {
      const go = () => {
        stopTimers();
        closePass();
        g = null;
        stage.classList.remove('over');
        persist();
        showView('setup');
      };
      if (!g || g.phase === 'over') return go();
      modal({
        title: 'New game?',
        body: [el('p', { class: 'ld-p' }, 'This game will be abandoned.')],
        actions: [{ label: 'Keep playing' }, { label: 'New game', primary: true, onClick: (close) => (close(), go()) }],
      });
    }

    function openPlaySettings() {
      ctx.openSettings([{ label: 'New game', onClick: (close) => (close(), confirmNew()) }]);
    }

    let bannerTimer = 0;
    function showBanner(text, cls) {
      banner.textContent = text;
      banner.className = `ld-banner ${cls}`;
      void banner.offsetWidth; // restart the animation
      banner.classList.add('show');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('show'), 1400);
    }

    // ---- render ----
    // `seat` is whose turn to show (during a roll or move, g.turn may already be the next player).
    function render(seat = g?.turn) {
      if (!g) return;
      const over = g.phase === 'over';
      if (!over) stage.classList.remove('over');
      const p = g.players[seat];
      turnText.textContent = over ? 'Game over' : `${p.name}'s turn`;
      turnText.style.color = over ? '' : p.colour;
      drawStrip(seat);
      drawPu();
      board.querySelectorAll('.ld-yard').forEach((y) => y.classList.toggle('cur', !over && +y.dataset.corner === g.corners[seat]));
      layoutTokens();
      if (!anim) die.set(dieFace || g.die || 6); // before this turn's roll: the last face, dimmed
      const ready = canRoll();
      dieBox.classList.toggle('ready', ready);
      dieBox.classList.toggle('stale', !dieFace && !anim);
      dieBox.style.setProperty('--seat', p.colour);
      die.node.disabled = !ready;
      die.node.setAttribute('aria-label', ready ? 'Roll the die' : dieFace ? `Die: ${dieFace}` : 'Die');
      msg.textContent = over ? '' : note;
    }

    function drawPu() {
      const html = g.rules.powerups ? puSvg(holdPu || g.pu) : '';
      if (html !== puDrawn) puLayer.innerHTML = puDrawn = html;
    }

    function drawStrip(seat) {
      const over = g.phase === 'over';
      strip.replaceChildren(
        ...g.players.map((p, s) => {
          const ts = g.tokens[s];
          const order = [...ts].sort((a, b) => (b === HOME) - (a === HOME) || (b !== YARD) - (a !== YARD));
          const place = finished(g, s) && !over ? g.places.indexOf(s) + 1 : 0;
          return el(
            'div',
            {
              class: `ld-chip${s === seat && !over ? ' cur' : ''}${place ? ' done' : ''}`,
              style: `--seat:${p.colour}`,
              'aria-label': `${p.name}${p.kind === 'bot' ? ` (${p.level} bot)` : ''}: ${ts.filter((r) => r === HOME).length} home`,
            },
            el('span', { class: 'ld-chip-name' }, p.kind === 'bot' ? el('i', { class: 'ld-bot', html: ICONS.bot }) : null, p.name),
            el('span', { class: 'ld-pips' }, order.map((r) => el('i', { class: r === HOME ? 'home' : r === YARD ? 'yard' : 'out' }))),
            p.kind === 'bot' ? el('small', {}, p.level[0]) : null,
            place ? el('em', {}, ordinal(place)) : null,
            g.frozen[s] && !place && !over ? el('i', { class: 'ld-frz', 'aria-label': 'frozen', html: puIcon('freeze', '#2f84d4', 30) }) : null,
          );
        }),
      );
    }

    function layoutTokens() {
      const rels = g.tokens.map((ts, s) => ts.map((r, t) => (shown.has(`${s}:${t}`) ? shown.get(`${s}:${t}`) : r)));
      const can = choosing() ? new Set(moves.map((m) => m.token)) : new Set();
      for (const it of layout(g.corners, rels)) {
        const n = tokNodes[it.seat][it.token];
        const live = it.seat === g.turn && can.has(it.token);
        n.style.left = `${(it.x / 15) * 100}%`;
        n.style.top = `${(it.y / 15) * 100}%`;
        n.style.setProperty('--s', it.scale);
        n.classList.toggle('can', live);
        n.classList.toggle('shielded', !!g.shield[it.seat][it.token]);
        n.classList.toggle('lift', it.seat === g.turn && it.token === lifted);
        n.tabIndex = live ? 0 : -1;
        n.setAttribute('aria-disabled', !live);
        const rel = rels[it.seat][it.token];
        const where = rel === YARD ? 'in the yard' : rel === HOME ? 'home' : `${rel + 1} steps along`;
        n.setAttribute('aria-label', `${SEAT_COLOURS[g.corners[it.seat]].name} token ${it.token + 1}, ${where}${live ? ', can move' : ''}`);
      }
    }

    // ---- settings changes ----
    const offSettings = S.onChange((key) => {
      if (key === 'colourblind' && g && !playView.hidden) {
        buildBoard();
        render();
      }
      if (!key.startsWith(`${ID}.`)) return;
      if (!setupView.hidden) drawSetupNotes();
      else if (g && g.phase !== 'over' && RULE_KEYS.includes(key.slice(ID.length + 1))) toast('Rule changes apply to the next game');
    });

    // ---- lifecycle ----
    const onVis = () => document.hidden && persist();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', persist);
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    document.body.style.background = BG;
    if (autoplay || params.has('debug')) window.__ludo = () => ({ save, g, moves, anim, passing });

    if (save.game) resumeGame();
    else showView('setup');

    return {
      unmount() {
        persist();
        stopTimers();
        clearTimeout(bannerTimer);
        ro.disconnect();
        offSettings();
        closePass();
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('pagehide', persist);
        document.body.style.background = '';
      },
    };
  },
};

const CSS = `
.ld-p { margin: 0; text-align: center; font-size: 17px; }
.ld-play { position: absolute; inset: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 35%, #2b5470, ${BG} 75%); }
.ld-play[hidden] { display: none; }
.ld-stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; display: flex; flex-direction: column; gap: 16px;
  padding: 22px 30px 30px; font-family: var(--font); color: #fff; }
.ld-stage button:not(.wdie) { font: inherit; color: inherit; border: 0; background: none; padding: 0; }
.ld-top { display: flex; align-items: center; justify-content: space-between; gap: 20px; height: 96px; flex: none; }
.ld-icon { flex: none; width: 96px; height: 96px; border-radius: 50%; background: #0003 !important; color: #f4d27a !important; padding: 20px !important; }
.ld-icon svg { width: 100%; height: 100%; display: block; }
.ld-turn { min-width: 0; font-size: 46px; font-weight: 900; text-shadow: 0 4px 0 #0006; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  -webkit-text-stroke: 2px #0004; paint-order: stroke fill; }
.ld-strip { display: flex; gap: 14px; flex: none; }
.ld-chip { flex: 1 1 0; min-width: 0; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  height: 108px; border-radius: 26px; background: #0003; border-bottom: 10px solid var(--seat); opacity: .75; }
.ld-chip.cur { opacity: 1; background: #ffffff26; box-shadow: 0 0 0 5px var(--seat); }
.ld-chip-name { display: flex; align-items: center; gap: 8px; max-width: 90%; font-size: 32px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ld-bot { width: 34px; height: 34px; flex: none; color: #f4d27a; }
.ld-bot svg { width: 100%; height: 100%; display: block; }
.ld-pips { display: flex; gap: 8px; }
.ld-pips i { width: 22px; height: 22px; border-radius: 50%; background: #fff2; }
.ld-pips i.out { background: #fff; box-shadow: inset 0 0 0 6px var(--seat); }
.ld-pips i.home { background: var(--seat); box-shadow: 0 0 0 3px #fff; }
.ld-chip small { position: absolute; right: 14px; top: 8px; font-size: 22px; font-weight: 800; opacity: .7; text-transform: uppercase; }
.ld-chip em { position: absolute; left: 12px; top: 6px; font-size: 24px; font-weight: 900; font-style: normal; color: #f4d27a; }
.ld-chip.done { opacity: .6; }
.ld-board { position: relative; isolation: isolate; flex: none; width: 1020px; height: 1020px; border-radius: 30px; background: #fbf7ea;
  box-shadow: 0 0 0 10px #f2e9cc, 0 14px 30px #0008; }
.ld-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; border-radius: inherit; }
.ld-yard-glow { stroke: #fff; stroke-width: .14; opacity: 0; }
.ld-yard.cur .ld-yard-glow { opacity: 1; animation: ld-glow 1.1s ease-in-out infinite alternate; }
.ld-tokens { position: absolute; inset: 0; }
.ld-tok { position: absolute; width: 6%; height: 6%; transform: translate(-50%, -50%) scale(var(--s, 1)); z-index: 1; pointer-events: none;
  transition: left .1s ease-out, top .1s ease-out, transform .15s; }
.ld-tok svg { width: 100%; height: 100%; display: block; overflow: visible; }
.ld-tok.can { pointer-events: auto; z-index: 3; cursor: pointer; }
.ld-tok.can::before { content: ''; position: absolute; inset: -18%; border-radius: 50%; border: 7px solid #1b2240;
  box-shadow: 0 0 0 5px #fff, 0 0 16px 8px #fffc; animation: ld-pulse .8s ease-in-out infinite alternate; }
.ld-tok.lift { transform: translate(-50%, -64%) scale(calc(var(--s, 1) * 1.15)); z-index: 4; }
.ld-tok.moving { z-index: 5; }
.ld-tok.shielded::after { content: ''; position: absolute; inset: -12%; border-radius: 50%; border: 6px solid #f4d27a; box-shadow: 0 0 14px 4px #f4d27a99; }
.ld-tok.warp { transition: left .45s cubic-bezier(.3, 1.4, .5, 1), top .45s cubic-bezier(.3, 1.4, .5, 1), transform .15s; z-index: 5; }
.ld-pu { position: absolute; inset: 0; pointer-events: none; }
.ld-pu .ld-svg { border-radius: 0; }
.ld-legend-btn { font-size: 58px !important; font-weight: 900 !important; padding: 0 !important; line-height: 96px; }
.ld-legend-btn[hidden] { display: none; }
.ld-frz { position: absolute; left: 12px; top: 8px; width: 30px; height: 30px; }
.ld-frz svg { display: block; }
.ld-leg { display: flex; align-items: center; gap: 12px; margin: 6px 0; text-align: left; }
.ld-leg i { flex: none; width: 44px; height: 44px; }
.ld-leg b { flex: none; min-width: 6.5em; }
.ld-leg span { font-size: .92em; opacity: .85; }
.ld-tok.sent { transition: left .5s ease-in, top .5s ease-in, transform .15s; z-index: 2; }
.ld-gap { flex: 1 1 0; margin-top: -16px; } /* tall phones: a third of the spare height above the board */
.ld-tray { flex: 2 0 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; min-height: 290px; }
.ld-msg { min-height: 50px; font-size: 38px; font-weight: 800; text-align: center; opacity: .95; }
.ld-diebox { padding: 22px; border-radius: 46px; background: #0003; box-shadow: 0 0 0 8px var(--seat, #fff4); transition: box-shadow .2s; }
.ld-diebox .wdie { --die: 168px; }
.ld-diebox.ready { animation: ld-ready .9s ease-in-out infinite alternate; }
.ld-diebox.ready .wdie { cursor: pointer; }
.ld-diebox.stale .wdie { opacity: .5; }
.ld-diebox.ready.stale .wdie { opacity: .8; }
.ld-over { display: none; position: absolute; inset: 0; z-index: 10; align-items: center; justify-content: center; background: #0007; padding: 40px; }
.ld-stage.over .ld-over { display: flex; }
.ld-stage.over .ld-tray { visibility: hidden; }
.ld-over-card { width: 100%; max-width: 900px; display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 40px 40px 44px;
  border-radius: 44px; background: ${BG}; box-shadow: 0 0 0 6px #f4d27a55, 0 20px 50px #000a; }
.ld-over h2 { margin: 0; font-size: 72px; font-weight: 900; text-shadow: 0 5px 0 #0006; text-align: center; }
.ld-standings { list-style: none; margin: 0; padding: 0; width: 100%; display: grid; gap: 12px; }
.ld-standings li { display: flex; align-items: center; gap: 16px; padding: 0 26px; height: 84px; border-radius: 24px; background: #0003;
  border-left: 14px solid var(--seat); font-size: 40px; font-weight: 800; }
.ld-standings li i { width: 54px; height: 54px; flex: none; }
.ld-standings li i svg { width: 100%; height: 100%; display: block; }
.ld-standings li i.ld-place { font-style: normal; font-size: 30px; text-align: center; line-height: 54px; color: #f4d27a; }
.ld-standings li span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-standings li small { font-size: 30px; opacity: .8; }
.ld-actions { display: flex; gap: 24px; width: 100%; }
.ld-btn { flex: 1 1 0; min-width: 0; height: 124px; border-radius: 38px !important; font-size: 44px !important; font-weight: 900 !important;
  box-shadow: 0 10px 0 #0005; white-space: nowrap; }
.ld-btn:active { transform: translateY(5px); box-shadow: 0 5px 0 #0005; }
.ld-go { background: linear-gradient(#ffd451, #e9a210) !important; color: #3a2400 !important; }
.ld-alt { background: #ffffff2a !important; color: #fff !important; }
.ld-banner { position: absolute; left: -10%; right: -10%; top: 44%; z-index: 8; text-align: center; pointer-events: none; opacity: 0; font-weight: 900;
  font-size: 120px; color: #ffd451; -webkit-text-stroke: 14px #5a2a00; paint-order: stroke fill; text-shadow: 0 10px 20px #0008; }
.ld-banner.cap { color: #ff9a7a; -webkit-text-stroke-color: #5a1400; }
.ld-banner.home { color: #b8f070; -webkit-text-stroke-color: #1a4a10; }
.ld-banner.bad { color: #e8e8f0; -webkit-text-stroke-color: #2a2a40; font-size: 100px; }
.ld-banner.pg { color: #b8f070; -webkit-text-stroke-color: #1a4a10; font-size: 110px; }
.ld-banner.pb { color: #ffb36b; -webkit-text-stroke-color: #4a1f00; font-size: 110px; }
.ld-banner.win { font-size: 110px; }
.ld-banner.show { animation: ld-banner 1.4s forwards; }
@keyframes ld-banner { 0% { opacity: 0; transform: scale(.4); } 15% { opacity: 1; transform: scale(1.06); } 25%, 80% { opacity: 1; transform: none; } 100% { opacity: 0; } }
@keyframes ld-pulse { from { transform: scale(.92); opacity: .65; } to { transform: scale(1.08); opacity: 1; } }
@keyframes ld-glow { from { opacity: .35; } to { opacity: 1; } }
@keyframes ld-ready { from { box-shadow: 0 0 0 8px var(--seat); } to { box-shadow: 0 0 0 16px var(--seat), 0 0 40px var(--seat); } }
.reduced-motion .ld-tok, .reduced-motion .ld-tok.sent, .reduced-motion .ld-tok.warp { transition: none; }
.reduced-motion .ld-tok.can::before, .reduced-motion .ld-yard.cur .ld-yard-glow, .reduced-motion .ld-diebox.ready { animation: none; }
.reduced-motion .ld-diebox.ready { box-shadow: 0 0 0 14px var(--seat); }
.reduced-motion .ld-banner.show { animation: ld-banner-rm 1.4s forwards; }
@keyframes ld-banner-rm { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }

/* Wide screens: controls on the left, the board on the right. */
.ld-stage.wide { display: grid; grid-template-columns: 1fr 940px; grid-template-rows: auto auto 1fr; column-gap: 40px; row-gap: 18px; }
.ld-stage.wide .ld-top { grid-area: 1 / 1; }
.ld-stage.wide .ld-gap { display: none; }
.ld-stage.wide .ld-strip { grid-area: 2 / 1; display: grid; grid-template-columns: 1fr 1fr; }
.ld-stage.wide .ld-board { grid-area: 1 / 2 / 4 / 3; align-self: center; width: 940px; height: 940px; }
.ld-stage.wide .ld-tray { grid-area: 3 / 1; min-height: 0; }
`;
