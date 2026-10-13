// Small DOM helpers shared by the shelf and the games: el(), modal(), toast().

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

// A centred panel over a dim backdrop. actions: [{ label, primary?, onClick?(close) }].
// Returns close(). Tapping the backdrop closes it unless sticky.
export function modal({ title, body = [], actions = [], sticky = false, className = '' }) {
  const close = () => back.remove();
  const panel = el(
    'div',
    { class: `modal ${className}`, role: 'dialog', 'aria-label': title || 'Dialog' },
    title && el('h2', {}, title),
    el('div', { class: 'modal-body' }, body),
    actions.length > 0 &&
      el(
        'div',
        { class: 'modal-actions' },
        actions.map((a) =>
          el(
            'button',
            {
              class: `btn ${a.primary ? 'btn-primary' : ''}`,
              onclick: () => (a.onClick ? a.onClick(close) : close()),
            },
            a.label,
          ),
        ),
      ),
  );
  const back = el('div', { class: 'modal-back' }, panel);
  if (!sticky) back.addEventListener('click', (e) => e.target === back && close());
  document.body.append(back);
  return close;
}

export function toast(text, ms = 1600) {
  const t = el('div', { class: 'toast' }, text);
  document.body.append(t);
  setTimeout(() => t.classList.add('toast-out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// A labelled on/off switch row.
export function switchRow(label, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked: checked || null });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'row' }, el('span', {}, label), el('span', { class: 'switch' }, input, el('i')));
}

// A labelled segmented choice row. options: [[value, label], ...]
export function choiceRow(label, value, options, onChange) {
  const buttons = options.map(([v, l]) => el('button', { class: v === value ? 'on' : '' }, l));
  buttons.forEach((btn, i) =>
    btn.addEventListener('click', () => {
      buttons.forEach((x) => x.classList.remove('on'));
      btn.classList.add('on');
      onChange(options[i][0]);
    }),
  );
  return el('div', { class: 'row' }, el('span', {}, label), el('div', { class: 'seg' }, buttons));
}
