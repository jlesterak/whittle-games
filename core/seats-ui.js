// Seat picking and the pass-and-play hand-over card, shared by the seated games (Yacht, Ludo).
// Plain responsive DOM in CSS px (styles in core/style.css .seat-*, .pass-*).
import { SEAT_COLOURS, BOT_LEVELS, defaultName } from './seats.js';

export { defaultName };

// Rows of seats: colour, name, Human / Bot, the bot's level, remove; plus add buttons.
// players: [{ name, kind, level }]. onChange(players) fires on every edit. Returns { node, players() }.
// colourAt(i, n) picks seat i's colour when n seats are set (Ludo seats two players opposite).
export function seatSetup(el, { players, min = 1, max = 4, onChange = () => {}, colourAt = (i) => SEAT_COLOURS[i] }) {
  let list = players.map((p) => ({ ...p }));
  const rows = el('div', { class: 'seat-rows' });
  const addHuman = el('button', { class: 'btn', type: 'button', onclick: () => add('human') }, '+ Player');
  const addBot = el('button', { class: 'btn', type: 'button', onclick: () => add('bot') }, '+ Bot');
  const node = el('div', { class: 'seat-setup' }, rows, el('div', { class: 'seat-add' }, addHuman, addBot));

  const changed = () => {
    draw();
    onChange(list.map((p) => ({ ...p })));
  };
  function add(kind) {
    if (list.length >= max) return;
    list.push({ name: defaultName(kind, list.length), kind, level: 'medium' });
    changed();
  }
  const seg = (options, value, pick) =>
    el(
      'div',
      { class: 'seg' },
      options.map(([v, l]) => el('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => pick(v) }, l)),
    );

  function draw() {
    rows.replaceChildren(
      ...list.map((p, i) => {
        const name = el('input', { class: 'seat-name', value: p.name, maxlength: 12, 'aria-label': `Seat ${i + 1} name`, enterkeyhint: 'done' });
        name.addEventListener('change', () => {
          p.name = name.value.trim() || defaultName(p.kind, i);
          changed();
        });
        name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());
        return el(
          'div',
          { class: 'seat-row', style: `--seat:${colourAt(i, list.length).hex}` },
          el('i', { class: 'seat-dot' }),
          name,
          seg([['human', 'Human'], ['bot', 'Bot']], p.kind, (k) => {
            if (k === p.kind) return;
            if (p.name === defaultName(p.kind, i)) p.name = defaultName(k, i);
            p.kind = k;
            changed();
          }),
          el('button', { class: 'seat-x', type: 'button', 'aria-label': `Remove ${p.name}`, disabled: list.length <= min, onclick: () => (list.splice(i, 1), changed()) }, '×'),
          p.kind === 'bot' ? el('div', { class: 'seat-level' }, el('span', {}, 'Level'), seg(BOT_LEVELS, p.level, (l) => ((p.level = l), changed()))) : null,
        );
      }),
    );
    addHuman.disabled = addBot.disabled = list.length >= max;
  }
  draw();
  return { node, players: () => list.map((p) => ({ ...p })) };
}

// Full-screen "Pass to <name>" card in the seat's colour; a tap anywhere hands over.
// Returns the node (append it where it should cover); it removes itself on tap.
export function passScreen(el, { name, colour, note = 'Tap when you have the phone', onGo }) {
  const node = el(
    'div',
    { class: 'pass-screen', style: `--seat:${colour};--len:${Math.max(4, name.length)}`, role: 'button', tabindex: 0, 'aria-label': `Pass to ${name}. ${note}` },
    el('div', { class: 'pass-card' }, el('p', {}, 'Pass to'), el('h1', {}, name), el('small', {}, note)),
  );
  const go = () => {
    node.remove();
    onGo?.();
  };
  node.addEventListener('click', go);
  node.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && go());
  setTimeout(() => node.focus?.(), 0);
  return node;
}
