// Card catalogue for The Grimwood (2016 / 2017 rules).
// Power texts are paraphrased summaries of the official rule sheet.

export const SUPERNATURALS = [
  { key: 'amazon',      name: 'Amazon',       icon: '🛡️', text: 'Name a card (e.g. Owl, Rune, or a supernatural by name). Every other player must give you one if they have it.' },
  { key: 'boogeyman',   name: 'Boogeyman',    icon: '👤', male: true, text: 'Exchange hands with another player.' },
  { key: 'bride',       name: 'Bride',        icon: '👰', text: 'Take any male supernatural already on the table into your hand. You may play it immediately.' },
  { key: 'centaur',     name: 'Centaur',      icon: '🏹', text: 'Take the top card of the discard pile. You may play it immediately.' },
  { key: 'darkunicorn', name: 'Dark Unicorn', icon: '🦄', text: 'Every other player discards a random card from their hand.' },
  { key: 'demon',       name: 'Demon',        icon: '😈', male: true, text: 'Send any combo on the table to the discard pile.' },
  { key: 'dracula',     name: 'Dracula',      icon: '🧛', male: true, text: 'Steal 2 cards from one player\'s hand.' },
  { key: 'dragon',      name: 'Dragon',       icon: '🐉', text: 'Passive. Its combo becomes immune to special powers and is frozen: no more cards may be added.' },
  { key: 'dwarf',       name: 'Dwarf',        icon: '⛏️', male: true, text: 'Look at the top card of the discard pile and of the deck. Keep one, discard the other.' },
  { key: 'elf',         name: 'Elf',          icon: '🧝', text: 'Reactivate the power of another supernatural in your combos.' },
  { key: 'faeries',     name: 'Faeries',      icon: '🧚', text: 'Take any 2 cards from the discard pile. You may play one immediately.' },
  { key: 'ghouls',      name: 'Ghouls',       icon: '🧟', text: 'Draw a card from the deck or steal a card from a player\'s hand.' },
  { key: 'giant',       name: 'Giant',        icon: '🗿', male: true, text: 'Take any card from the discard pile. You may play it immediately.' },
  { key: 'goblins',     name: 'Goblins',      icon: '👺', text: 'Steal 3 cards from one or more players\' hands.' },
  { key: 'highwayman',  name: 'Highwayman',   icon: '🗡️', text: 'Swap one of your combos with one of another player\'s combos.' },
  { key: 'hydra',       name: 'Hydra',        icon: '🐍', text: 'Look at one player\'s hand.' },
  { key: 'mage',        name: 'Mage',         icon: '🧙', male: true, text: 'Draw 2 cards from the deck.' },
  { key: 'nymph',       name: 'Nymph',        icon: '🌊', text: 'Take any supernatural already on the table and play it (and its power) immediately.' },
  { key: 'shadowqueen', name: 'Shadow Queen', icon: '👑', text: 'Look at every player\'s hand, then steal 1 card blind from one player.' },
  { key: 'sorceress',   name: 'Sorceress',    icon: '🔮', text: 'Discard 2 Owls or 2 Crows from your hand to take any other player\'s combo as your own.' },
  { key: 'eternals',    name: 'The Eternals', icon: '⏳', text: 'Fill your hand up to 7 by drawing from the deck and/or stealing from players.' },
  { key: 'laraki',      name: 'The Laraki',   icon: '🦇', text: 'Take as many cards from the top of the discard pile as there are players. Keep 1, give 1 face up to each other player.' },
  { key: 'troll',       name: 'Troll',        icon: '👹', male: true, text: 'Force a player to discard a random card from their hand.' },
  { key: 'werewolf',    name: 'Werewolf',     icon: '🐺', male: true, text: 'Choose a player to lose their next turn.' },
];

export const BASICS = [
  { key: 'owl',      name: 'Owl',      icon: '🦉', type: 'animal',  count: 9, text: '3 Owls = 10 pts.' },
  { key: 'crow',     name: 'Crow',     icon: '🐦‍⬛', type: 'animal',  count: 9, text: '3 Crows = 10 pts.' },
  { key: 'swamp',    name: 'Swamp',    icon: '🌫️', type: 'setting', count: 6, text: 'Swamp + Path + Clearing = 5 pts. 3 Swamps = 3 pts.' },
  { key: 'path',     name: 'Path',     icon: '🛤️', type: 'setting', count: 6, text: 'Swamp + Path + Clearing = 5 pts. 3 Paths = 3 pts.' },
  { key: 'clearing', name: 'Clearing', icon: '🌲', type: 'setting', count: 6, text: 'Swamp + Path + Clearing = 5 pts. 3 Clearings = 3 pts.' },
  { key: 'amulet',   name: 'Amulet',   icon: '🧿', type: 'amulet',  count: 4, text: 'Block one steal from your hand. A blocked normal steal ends the thief\'s turn.' },
  { key: 'rune',     name: 'Rune',     icon: 'ᚱ',  type: 'rune',    count: 4, text: 'Gain 2 extra actions this turn (draw, steal, or play a power).' },
];

export const CARDS = {};
for (const s of SUPERNATURALS) CARDS[s.key] = { ...s, type: 'super' };
for (const b of BASICS) CARDS[b.key] = b;

export const SUPER_POINTS = [0, 1, 2, 5, 10, 15];
export const MAX_SUPER_COMBO = 5;
export const HAND_LIMIT = 7;

export function cardName(key) { return CARDS[key]?.name ?? key; }
export function isSuper(key) { return CARDS[key]?.type === 'super'; }
export function hasPower(key) { return isSuper(key) && key !== 'dragon'; }

export function buildDeck(numPlayers) {
  const keys = [];
  for (const s of SUPERNATURALS) keys.push(s.key);
  for (const b of BASICS) {
    let n = b.count;
    if (numPlayers === 2 && (b.key === 'rune' || b.key === 'amulet')) n -= 2;
    for (let i = 0; i < n; i++) keys.push(b.key);
  }
  return keys.map((k, i) => ({ id: 'c' + i, k }));
}

// Score of a single combo on the table.
export function comboPoints(combo) {
  if (combo.type === 'super') return SUPER_POINTS[Math.min(combo.cards.length, MAX_SUPER_COMBO)];
  if (combo.type === 'animal') return 10;
  if (combo.type === 'settings') {
    const ks = new Set(combo.cards.map(c => c.k));
    return ks.size === 3 ? 5 : 3;
  }
  return 0;
}

// Returns the combo type if the 3 given cards form a valid animal/settings combo, else null.
export function classifyTriple(cards) {
  if (cards.length !== 3) return null;
  const ks = cards.map(c => c.k);
  if (ks.every(k => k === 'owl') || ks.every(k => k === 'crow')) return 'animal';
  if (ks.every(k => CARDS[k].type === 'setting')) {
    const set = new Set(ks);
    if (set.size === 1 || set.size === 3) return 'settings';
  }
  return null;
}
