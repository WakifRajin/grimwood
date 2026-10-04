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

// ---------- deck sets ----------
// A deck set only changes how cards look (name, rule text, art); the rules stay the same,
// so players in one online room can each use a different deck.
// গহীন (Goheen) is the Bangla edition, with supernaturals from Bengali folklore.
const GOHEEN = {
  amazon:      ['বনবিবি', 'একটি কার্ডের নাম বলুন (যেমন পেঁচা, মন্ত্র, বা কোনো অতিপ্রাকৃতিক)। বাকি প্রত্যেক প্লেয়ারের হাতে সেটি থাকলে একটি আপনাকে দিতে বাধ্য।'],
  boogeyman:   ['বেতাল', 'যেকোনো একজন প্লেয়ারের সাথে হাত বদল করুন।'],
  bride:       ['শাঁকচুন্নি', 'টেবিলে খেলা হয়ে গেছে এমন যেকোনো একটি পুরুষ অতিপ্রাকৃতিক কার্ড নিজের হাতে নিন। চাইলে সাথে সাথেই খেলতে পারবেন।'],
  centaur:     ['বেহুলা', 'ডিসকার্ড পাইলের উপরের কার্ডটি হাতে নিন। চাইলে সাথে সাথেই খেলতে পারবেন।'],
  darkunicorn: ['বগা', 'বাকি সব প্লেয়ারের হাত থেকে randomly একটি করে কার্ড ডিসকার্ড হবে।'],
  demon:       ['ইবলিশ', 'টেবিলের যেকোনো একটি সেট ডিসকার্ড পাইলে ফেলে দিন।'],
  dracula:     ['স্কন্ধকাটা', 'একজন প্লেয়ারের হাত থেকে randomly দুটি কার্ড চুরি করুন।'],
  dragon:      ['যক্ষ', 'Passive। এই কার্ড যে সেটের অংশ, সেই সেট সব অতিপ্রাকৃতিক power থেকে মুক্ত। কিন্তু সেই সেটে আর কোনো কার্ড যোগ করা যাবে না।'],
  dwarf:       ['গাত্রবঙ্গা', 'ডিসকার্ড পাইল ও ডেকের উপরের কার্ড দুটি দেখুন। একটি হাতে রাখুন, অন্যটি ডিসকার্ড করুন।'],
  elf:         ['চাঁদের বুড়ি', 'আপনার খেলা অন্য যেকোনো একটি অতিপ্রাকৃতিক কার্ডের power পুনরায় খেলুন।'],
  faeries:     ['ব্যাঙ্গমা-ব্যাঙ্গমী', 'ডিসকার্ড পাইল থেকে যেকোনো দুটি কার্ড হাতে নিন। একটি সাথে সাথেই খেলতে পারবেন।'],
  ghouls:      ['খোক্কশ', 'ডেক থেকে একটি কার্ড draw করুন অথবা অন্য একজন প্লেয়ারের হাত থেকে একটি কার্ড চুরি করুন।'],
  giant:       ['দৈত্য', 'ডিসকার্ড পাইল থেকে যেকোনো একটি কার্ড হাতে নিন। চাইলে সাথে সাথেই খেলতে পারবেন।'],
  goblins:     ['পিশাচ', 'একজন বা তার বেশি প্লেয়ারের হাত থেকে মোট ৩টি কার্ড randomly চুরি করুন।'],
  highwayman:  ['জ্বীন', 'আপনার একটি সেট অন্য একজন প্লেয়ারকে দিয়ে, তার একটি সেট নিজের সামনে নিয়ে নিন।'],
  hydra:       ['সর্পরাজ', 'যেকোনো একজন প্লেয়ারের হাতের কার্ড দেখুন।'],
  mage:        ['তান্ত্রিক', 'ডেক থেকে দুটি কার্ড draw করুন।'],
  nymph:       ['নিশি', 'টেবিলে খেলা হয়ে গেছে এমন যেকোনো একটি অতিপ্রাকৃতিক কার্ড নিয়ে সাথে সাথে খেলুন, তার power সহ।'],
  shadowqueen: ['শিকল', 'প্রত্যেক প্লেয়ারের হাতের কার্ড দেখে নিন, এরপর একজন প্লেয়ারের হাত থেকে না দেখে ১টি কার্ড চুরি করুন।'],
  sorceress:   ['ডাইনী', 'হাত থেকে ২টি পেঁচা বা ২টি কাক ডিসকার্ড করে অন্য একজন প্লেয়ারের যেকোনো একটি সেট নিজের করে নিন।'],
  eternals:    ['দায়োরি', 'ডেক থেকে draw করে এবং/অথবা অন্য প্লেয়ারদের হাত থেকে চুরি করে আপনার হাত ৭টি কার্ড পর্যন্ত পূরণ করুন।'],
  laraki:      ['ব্রহ্মদৈত্য', 'ডিসকার্ড পাইলের উপর থেকে যতজন প্লেয়ার ততগুলো কার্ড তুলুন। ১টি নিজের হাতে রাখুন, বাকিগুলো অন্য প্লেয়ারদের face-up করে একটি করে দিন।'],
  troll:       ['রাক্ষস', 'একজন প্লেয়ারের হাত থেকে randomly একটি কার্ড ডিসকার্ড করান।'],
  werewolf:    ['বোবা', 'যেকোনো একজন প্লেয়ারকে বেছে নিন। সে তার পরের turn খেলতে পারবে না।'],
  owl:         ['পেঁচা', '৩টি পেঁচা = ১০ পয়েন্ট।'],
  crow:        ['কাক', '৩টি কাক = ১০ পয়েন্ট।'],
  swamp:       ['ডোবা', 'ডোবা + বাঁশঝাড় + কাশবন = ৫ পয়েন্ট। ৩টি ডোবা = ৩ পয়েন্ট।'],
  path:        ['বাঁশঝাড়', 'ডোবা + বাঁশঝাড় + কাশবন = ৫ পয়েন্ট। ৩টি বাঁশঝাড় = ৩ পয়েন্ট।'],
  clearing:    ['কাশবন', 'ডোবা + বাঁশঝাড় + কাশবন = ৫ পয়েন্ট। ৩টি কাশবন = ৩ পয়েন্ট।'],
  amulet:      ['মাদুলি', 'আপনার হাত থেকে একটি চুরি আটকান। সাধারণ চুরি আটকালে চোরের turn শেষ হয়ে যায়।'],
  rune:        ['মন্ত্র', 'এই turn-এ ২টি অতিরিক্ত action পান (draw, চুরি, বা একটি power খেলা)।'],
};

export const DECKS = {
  grimwood: { name: 'The Grimwood', lang: 'en' },
  goheen:   { name: 'গহীন', lang: 'bn', cards: GOHEEN, art: '../img/goheen/' },
};
export let deckId = 'grimwood';

const BASE = {};
for (const k in CARDS) BASE[k] = { name: CARDS[k].name, text: CARDS[k].text };

// Inline style that puts the deck's card art behind an element (empty for icon-only decks).
export const artStyle = d => (d.img ? `style="--art:url('${d.img}')"` : '');

// Switches every card's name, text and art in place, so all views pick it up.
export function setDeck(id) {
  if (!DECKS[id]) id = 'grimwood';
  deckId = id;
  const deck = DECKS[id];
  for (const k in CARDS) {
    const [name, text] = deck.cards?.[k] ?? [BASE[k].name, BASE[k].text];
    const img = deck.art ? new URL(`${deck.art}${k}.svg`, import.meta.url).href : null;
    for (const o of [CARDS[k], SUPERNATURALS.find(s => s.key === k)]) if (o) Object.assign(o, { name, text, img });
  }
  return deck;
}
