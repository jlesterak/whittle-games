// The shelf's game list. Each entry is metadata plus a lazy loader; the module's default
// export is the game: { settings?: [...], mount(root, ctx) -> { unmount() } }.
// See README.md "Adding a game".

const beadsIcon = `<svg viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="16" fill="#a0a8e1"/>
<rect x="14" y="8" width="36" height="34" rx="16" fill="none" stroke="#4d4d69" stroke-width="12"/>
<g stroke="#0004" stroke-width="1">
<circle cx="14" cy="18" r="4.5" fill="#de3840"/><circle cx="14" cy="27" r="4.5" fill="#de3840"/><circle cx="16" cy="36" r="4.5" fill="#3f7fe2"/>
<circle cx="26" cy="41" r="4.5" fill="#3f7fe2"/><circle cx="38" cy="41" r="4.5" fill="#29c411"/><circle cx="48" cy="36" r="4.5" fill="#29c411"/>
<circle cx="50" cy="27" r="4.5" fill="#ddd42c"/><circle cx="50" cy="18" r="4.5" fill="#ddd42c"/><circle cx="32" cy="8" r="4.5" fill="#e25fdf"/>
<circle cx="22" cy="9" r="4.5" fill="#e25fdf"/><circle cx="42" cy="9" r="4.5" fill="#4abee1"/></g>
<rect x="15" y="47" width="15" height="13" rx="4" fill="#de3840"/><rect x="34" y="47" width="15" height="13" rx="4" fill="#29c411"/></svg>`;

const purlIcon = `<svg viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="16" fill="#9f4e45"/>
<rect x="12" y="4" width="40" height="30" fill="#c98b61"/><rect x="16" y="4" width="32" height="26" fill="#6e504f"/>
<rect x="16" y="4" width="8" height="13" fill="#d8b345"/><rect x="24" y="4" width="8" height="13" fill="#1d67c8"/><rect x="32" y="4" width="8" height="13" fill="#cd464f"/><rect x="40" y="4" width="8" height="13" fill="#28955c"/>
<rect x="16" y="17" width="8" height="13" fill="#cd464f"/><rect x="24" y="17" width="8" height="13" fill="#9758da"/><rect x="32" y="17" width="8" height="13" fill="#28b1cf"/><rect x="40" y="17" width="8" height="13" fill="#d8b345"/>
<path d="M28 30q4 10 14 16" stroke="#9758da" stroke-width="2.5" fill="none"/>
<g stroke="#1b1416" stroke-width="2"><ellipse cx="42" cy="55" rx="9" ry="3.5" fill="#7a4fb0"/><rect x="36" y="44" width="12" height="11" fill="#9758da"/><ellipse cx="42" cy="44" rx="9" ry="3.5" fill="#b287da"/></g>
<rect x="8" y="46" width="22" height="12" rx="4" fill="#e2e0de"/></svg>`;

const pointIcon = `<svg viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="16" fill="#151823"/>
<g fill="none" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
<path d="M12 50V30h12V14" stroke="#ca4e53"/><path d="M30 52h16V36" stroke="#3475dc"/><path d="M32 30h14V14h6" stroke="#e2ad12"/>
<path d="M12 12h6" stroke="#d37013"/></g>
<g><path d="M24 7l-5 8h10z" fill="#ca4e53"/><path d="M46 29l-5 8h10z" fill="#3475dc"/><path d="M58 14l-8-5v10z" fill="#e2ad12"/></g></svg>`;

const yachtIcon = `<svg viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="16" fill="#23603f"/>
<g transform="rotate(-12 22 36)"><rect x="6" y="20" width="30" height="30" rx="7" fill="#fff"/><rect x="6" y="20" width="30" height="27" rx="7" fill="#fbf7ea"/>
<g fill="#1a1d28"><circle cx="14" cy="28" r="3"/><circle cx="28" cy="28" r="3"/><circle cx="21" cy="35" r="3"/><circle cx="14" cy="42" r="3"/><circle cx="28" cy="42" r="3"/></g></g>
<g transform="rotate(14 44 26)"><rect x="30" y="10" width="28" height="28" rx="7" fill="#fff"/><rect x="30" y="10" width="28" height="25" rx="7" fill="#fbf7ea"/>
<g fill="#1a1d28"><circle cx="37" cy="17" r="2.8"/><circle cx="51" cy="17" r="2.8"/><circle cx="37" cy="24" r="2.8"/><circle cx="51" cy="24" r="2.8"/><circle cx="37" cy="31" r="2.8"/><circle cx="51" cy="31" r="2.8"/></g></g>
<rect x="36" y="44" width="22" height="12" rx="4" fill="#f4b828"/></svg>`;

const ludoIcon = `<svg viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="16" fill="#2b5470"/>
<rect x="8" y="8" width="48" height="48" rx="6" fill="#fbf7ea"/>
<rect x="8" y="8" width="19" height="19" rx="5" fill="#e0473f"/><rect x="37" y="8" width="19" height="19" rx="5" fill="#35a352"/>
<rect x="37" y="37" width="19" height="19" rx="5" fill="#efb22a"/><rect x="8" y="37" width="19" height="19" rx="5" fill="#3a7bd5"/>
<path d="M27 27L32 32L27 37Z" fill="#e0473f"/><path d="M27 27L32 32L37 27Z" fill="#35a352"/><path d="M37 27L32 32L37 37Z" fill="#efb22a"/><path d="M27 37L32 32L37 37Z" fill="#3a7bd5"/>
<g stroke="#fff" stroke-width="2"><circle cx="17.5" cy="17.5" r="4.5" fill="#e0473f"/><circle cx="46.5" cy="46.5" r="4.5" fill="#efb22a"/><circle cx="32" cy="13" r="4" fill="#35a352"/></g></svg>`;

// summary(blob): a short progress label for the shelf card, from the game's save blob, without loading the game.
// Pure and defensive: a missing or broken blob gives null (no label), never an error.
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const levelLabel = (b) => (plain(b) && Number.isInteger(b.level) && b.level > 1 ? `Level ${b.level}` : null);
const inProgress = (b) => plain(b) && plain(b.game) && !b.game.over && b.game.phase !== 'over'; // Yacht: over, Ludo: phase
function yachtLabel(b) {
  if (inProgress(b)) return 'Game in progress';
  if (!plain(b) || !plain(b.high)) return null;
  const best = (list) => Math.max(...(Array.isArray(list) ? list : []).map((e) => (plain(e) && Number.isFinite(e.score) ? e.score : -Infinity)));
  // Triple scores run on a bigger scale, so Classic's best is shown when there is one
  const classic = best(b.high.classic);
  if (classic > -Infinity) return `Best ${classic}`;
  const triple = best(b.high.triple);
  return triple > -Infinity ? `Best ${triple} (Triple)` : null;
}

export const games = [
  {
    id: 'beadloom',
    title: 'Beadloom',
    blurb: 'Pour the bead ring into the right crates before the slots clog.',
    icon: beadsIcon,
    load: () => import('./beadloom/game.js'),
    summary: levelLabel,
  },
  {
    id: 'purl',
    title: 'Purl',
    blurb: 'Unravel the knitted picture onto the right bobbins before the slots clog.',
    icon: purlIcon,
    load: () => import('./purl/game.js'),
    summary: levelLabel,
  },
  {
    id: 'dotwork',
    title: 'Dotwork',
    blurb: 'Tap each arrow out of the maze, but only when its way to the edge is clear.',
    icon: pointIcon,
    load: () => import('./dotwork/game.js'),
    summary: levelLabel,
  },
  {
    id: 'yacht',
    title: 'Yacht',
    blurb: 'Five dice, three rolls, thirteen boxes. Solo high scores, bots or pass-and-play.',
    icon: yachtIcon,
    load: () => import('./yacht/game.js'),
    summary: yachtLabel,
  },
  {
    id: 'ludo',
    title: 'Ludo',
    blurb: 'Race four tokens home, a 6 to come out. House rules, bots or pass-and-play.',
    icon: ludoIcon,
    load: () => import('./ludo/game.js'),
    summary: (b) => (inProgress(b) ? 'Game in progress' : null),
  },
];
