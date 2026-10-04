// The Grimwood rules engine. Pure, serialisable, deterministic (seeded RNG).
// Used identically by offline play, the online host and the AI.
//
// State is a plain JSON object. `apply(state, action)` mutates it in place and
// throws an Error with a user-facing message if the action is illegal.
// Multi-step effects (powers, amulet reactions, hand limit) run through a task
// queue; when a task needs a decision it sets `state.pending` and waits for a
// {type:'choose', value} action from `pending.player`.

import {
  CARDS, HAND_LIMIT, MAX_SUPER_COMBO, buildDeck, cardName, classifyTriple,
  comboPoints, hasPower, isSuper,
} from './cards.js';

// ---------- small utilities ----------

function rand(s) { // mulberry32
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(s, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function removeRandom(s, arr) { return arr.splice(Math.floor(rand(s) * arr.length), 1)[0]; }
function removeById(arr, id) {
  const i = arr.findIndex(c => c.id === id);
  return i < 0 ? null : arr.splice(i, 1)[0];
}
const nm = (s, p) => s.players[p].name;
const cn = c => cardName(c.k);

// `ev` is a small structured description of a public event, used by the UI to animate it.
function log(s, msg, to, ev) {
  s.logN = (s.logN || 0) + 1;
  const e = { n: s.logN, msg };
  if (to) e.to = [...new Set(to)];
  if (ev) e.ev = ev;
  s.log.push(e);
  if (s.log.length > 150) s.log.splice(0, s.log.length - 150);
}

export function others(s, p) {
  const out = [];
  for (let i = 1; i < s.players.length; i++) out.push((p + i) % s.players.length);
  return out;
}

export function playerScore(pl) { return pl.combos.reduce((a, c) => a + comboPoints(c), 0); }

function findCombo(s, id) {
  for (let i = 0; i < s.players.length; i++) {
    const c = s.players[i].combos.find(c => c.id === id);
    if (c) return { combo: c, owner: i };
  }
  return null;
}
function detachCombo(s, owner, id) {
  const arr = s.players[owner].combos;
  return arr.splice(arr.findIndex(c => c.id === id), 1)[0];
}

export function eligibleSuperCombos(s, p) {
  return s.players[p].combos.filter(c => c.type === 'super' && !c.frozen && c.cards.length < MAX_SUPER_COMBO);
}

// Cards may only be stolen as a normal action from a hand of 2+ cards; powers need 1+.
export function stealTargets(s, p, minCards = 2) {
  return others(s, p).filter(j => s.players[j].hand.length >= minCards);
}

function takeFromDeck(s) {
  const c = s.deck.pop() || null;
  if (c && s.deck.length === 0 && s.endTrigger === null) {
    s.endTrigger = s.turn.player;
    log(s, 'The last card has been drawn! Every other player gets one final turn.');
  }
  return c;
}
function drawCard(s, p) {
  const c = takeFromDeck(s);
  if (!c) { log(s, `${nm(s, p)} tries to draw, but the deck is empty.`); return null; }
  s.players[p].hand.push(c);
  log(s, `${nm(s, p)} draws a card.`, null, { t: 'draw', p });
  log(s, `You drew ${cn(c)}.`, [p]);
  return c;
}

function placeSuper(s, p, card, comboRef) {
  const pl = s.players[p];
  let combo;
  if (comboRef === 'new' || comboRef == null) {
    combo = { id: 'k' + (s.nextCombo++), type: 'super', cards: [], frozen: false };
    pl.combos.push(combo);
  } else {
    combo = eligibleSuperCombos(s, p).find(c => c.id === comboRef);
    if (!combo) throw new Error('That combo cannot take more supernaturals.');
  }
  combo.cards.push(card);
  if (card.k === 'dragon') combo.frozen = true;
  return combo;
}

function superLocations(s, filter) {
  const out = [];
  s.players.forEach((pl, owner) => pl.combos.forEach(combo => {
    if (combo.type !== 'super' || combo.frozen) return;
    combo.cards.forEach(card => { if (filter(card, owner)) out.push({ card, combo, owner }); });
  }));
  return out;
}
function takeFromCombo(s, owner, comboId, cardId) {
  const pl = s.players[owner];
  const combo = pl.combos.find(c => c.id === comboId);
  const card = removeById(combo.cards, cardId);
  if (combo.cards.length === 0) pl.combos.splice(pl.combos.indexOf(combo), 1);
  return card;
}

// A rough value of a card in a hand, used as an AI hint for discards/gifts.
function handCardValue(hand, card) {
  const same = hand.filter(c => c.k === card.k).length;
  switch (CARDS[card.k].type) {
    case 'animal': return 2 + same * 2;
    case 'setting': return 1.5 + same;
    case 'super': return 5;
    case 'rune': return 4;
    case 'amulet': return 3.5;
  }
  return 1;
}
const threat = (s, j) => playerScore(s.players[j]) + s.players[j].hand.length * 0.6;
const playerOpt = (s, p, j, extra = '') => ({ v: j, label: s.players[j].name + extra, w: threat(s, j) });
const comboLabel = (s, owner, combo) =>
  `${s.players[owner].name}: ${combo.cards.map(cn).join(', ')} (${comboPoints(combo)} pts)`;

// ---------- tasks ----------
// Each task: prompt(s,t) -> null (no decision needed) | {title, options[], player?, empty?}
//            exec(s,t,choice)

const TASKS = {};

TASKS.steal = {
  prompt(s, t) {
    const tgt = s.players[t.target];
    if (tgt.hand.length && tgt.hand.some(c => c.k === 'amulet')) {
      return {
        player: t.target,
        title: `${nm(s, t.p)} is trying to steal from you. Use an Amulet?`,
        options: [{ v: 'block', label: 'Block with Amulet', w: 1 }, { v: 'allow', label: 'Let them steal', w: 0 }],
      };
    }
    return null;
  },
  exec(s, t, choice) {
    const tgt = s.players[t.target];
    if (choice === 'block') {
      s.discard.push(tgt.hand.splice(tgt.hand.findIndex(c => c.k === 'amulet'), 1)[0]);
      log(s, `${nm(s, t.target)} blocks ${nm(s, t.p)}'s steal with an Amulet!`, null, { t: 'block', p: t.target, by: t.p });
      if (t.mode === 'normal') {
        log(s, `${nm(s, t.p)} loses the rest of their turn.`);
        s.turn.extra = 0;
        s.queue.unshift({ t: 'handLimit', p: t.p }, { t: 'advance' });
      }
      return;
    }
    if (!tgt.hand.length) { log(s, `${nm(s, t.target)} has no cards to steal.`); return; }
    const card = removeRandom(s, tgt.hand);
    s.players[t.p].hand.push(card);
    log(s, `${nm(s, t.p)} steals a card from ${nm(s, t.target)}.`, null, { t: 'steal', p: t.p, from: t.target });
    log(s, `The stolen card was ${cn(card)}.`, [t.p, t.target]);
  },
};

TASKS.handLimit = {
  prompt(s, t) {
    const hand = s.players[t.p].hand;
    if (hand.length <= HAND_LIMIT) return null;
    return {
      title: `Hand limit is ${HAND_LIMIT}. Discard ${hand.length - HAND_LIMIT} more card(s).`,
      options: hand.map(c => ({ v: c.id, label: cn(c), card: c, w: -handCardValue(hand, c) })),
    };
  },
  exec(s, t, id) {
    if (id == null) return;
    const c = removeById(s.players[t.p].hand, id);
    s.discard.push(c);
    log(s, `${nm(s, t.p)} discards ${cn(c)} (hand limit).`, null, { t: 'discard', p: t.p, k: c.k });
    if (s.players[t.p].hand.length > HAND_LIMIT) s.queue.unshift({ t: 'handLimit', p: t.p });
  },
};

TASKS.advance = {
  exec(s) {
    const n = s.players.length;
    let next = s.turn.player;
    for (;;) {
      next = (next + 1) % n;
      if (s.endTrigger !== null && next === s.endTrigger) return gameOver(s);
      if (s.players[next].skip > 0) {
        s.players[next].skip--;
        log(s, `${nm(s, next)} loses this turn (Werewolf).`, null, { t: 'skipped', p: next });
        continue;
      }
      break;
    }
    startTurn(s, next);
  },
};

// Optionally (or mandatorily) play one of `cards` straight from hand, for free.
TASKS.freeplay = {
  prompt(s, t) {
    const hand = s.players[t.p].hand;
    const opts = [];
    for (const id of t.cards) {
      const card = hand.find(c => c.id === id);
      if (!card) continue;
      if (isSuper(card.k)) {
        opts.push({ v: { card: id, combo: 'new' }, label: `Play ${cn(card)} as a new combo`, card, w: 3 });
        for (const k of eligibleSuperCombos(s, t.p)) {
          opts.push({ v: { card: id, combo: k.id }, label: `Play ${cn(card)} onto ${k.cards.map(cn).join(', ')}`, card, w: 3 + k.cards.length });
        }
      } else if (card.k === 'rune') {
        opts.push({ v: { card: id, rune: true }, label: 'Play the Rune (+2 actions)', card, w: 4 });
      }
    }
    if (!opts.length) return null;
    if (t.optional) opts.push({ v: 'keep', label: 'Keep in hand', w: 0 });
    return { title: t.optional ? 'You may play this card now (free).' : 'Play this card now.', options: opts };
  },
  exec(s, t, choice) {
    if (!choice || choice === 'keep') return;
    const card = removeById(s.players[t.p].hand, choice.card);
    if (choice.rune) {
      s.discard.push(card);
      s.turn.extra += 2;
      log(s, `${nm(s, t.p)} plays a Rune and gains 2 extra actions.`, null, { t: 'rune', p: t.p });
      return;
    }
    placeSuper(s, t.p, card, choice.combo);
    log(s, `${nm(s, t.p)} plays ${cn(card)}.`, null, { t: 'play', p: t.p, k: card.k });
    if (hasPower(card.k)) s.queue.unshift({ t: 'power', p: t.p, key: card.k, card: card.id });
  },
};

TASKS.power = {
  exec(s, t) {
    // House rule: each card's power resolves at most once per turn (stops Elf/Nymph loops).
    if (t.card) {
      if (s.turn.used.includes(t.card)) { log(s, `${cardName(t.key)}'s power was already used this turn.`); return; }
      s.turn.used.push(t.card);
    }
    const nmK = cardName(t.key);
    log(s, `${CARDS[t.key].icon} ${nmK}${nmK.endsWith('s') ? "'" : "'s"} power activates for ${nm(s, t.p)}.`, null, { t: 'power', p: t.p, k: t.key });
    const start = POWERS[t.key];
    if (start) start(s, t);
  },
};

TASKS.reveal = {
  prompt(s, t) {
    return { title: t.title, reveal: t.hands, options: [{ v: 'ok', label: 'OK', w: 1 }] };
  },
  exec() {},
};

function revealTask(s, p, title, players) {
  const hands = players.map(j => ({ name: nm(s, j), cards: s.players[j].hand.map(c => ({ ...c })) }));
  for (const h of hands) log(s, `${h.name}'s hand: ${h.cards.map(cn).join(', ') || '(empty)'}`, [p]);
  return { t: 'reveal', p, title, hands };
}

// --- individual powers ---
const POWERS = {};
const simple = (key, task) => { POWERS[key] = (s, t) => s.queue.unshift({ ...task, t: key, p: t.p, card: t.card }); };

TASKS.amazon = {
  prompt(s, t) {
    const hand = s.players[t.p].hand;
    const visible = new Set();
    s.players.forEach(pl => pl.combos.forEach(c => c.cards.forEach(x => visible.add(x.k))));
    s.discard.forEach(x => visible.add(x.k));
    const keys = Object.keys(CARDS).filter(k => !(isSuper(k) && visible.has(k)));
    return {
      title: 'Amazon: name a card. Every other player who has one must give it to you.',
      options: keys.map(k => {
        const mine = hand.filter(c => c.k === k).length;
        const w = isSuper(k) ? 1 : CARDS[k].type === 'animal' ? 1 + mine * 1.5 : CARDS[k].type === 'setting' ? 0.5 + mine : 1.5;
        return { v: k, label: `${CARDS[k].icon} ${cardName(k)}`, w };
      }),
    };
  },
  exec(s, t, key) {
    log(s, `${nm(s, t.p)} asks everyone for ${cardName(key)}.`, null, { t: 'ask', p: t.p, k: key });
    let got = 0;
    for (const j of others(s, t.p)) {
      const i = s.players[j].hand.findIndex(c => c.k === key);
      if (i < 0) continue;
      s.players[t.p].hand.push(s.players[j].hand.splice(i, 1)[0]);
      log(s, `${nm(s, j)} hands over a ${cardName(key)}.`, null, { t: 'give', p: j, to: t.p, k: key });
      got++;
    }
    if (!got) log(s, 'Nobody had one. The Amazon missed her shot.');
  },
};
simple('amazon', {});

TASKS.boogeyman = {
  prompt(s, t) {
    const mine = s.players[t.p].hand.length;
    return {
      title: 'Boogeyman: exchange hands with which player?',
      options: others(s, t.p).map(j => ({ ...playerOpt(s, t.p, j, ` (${s.players[j].hand.length} cards)`), w: s.players[j].hand.length - mine })),
    };
  },
  exec(s, t, j) {
    const a = s.players[t.p], b = s.players[j];
    [a.hand, b.hand] = [b.hand, a.hand];
    log(s, `${nm(s, t.p)} exchanges hands with ${nm(s, j)}.`, null, { t: 'swapHands', p: t.p, with: j });
  },
};
simple('boogeyman', {});

TASKS.bride = {
  prompt(s, t) {
    const locs = superLocations(s, c => CARDS[c.k].male);
    return {
      title: 'Bride: take a male supernatural from the table.',
      empty: 'There is no male supernatural to take.',
      options: locs.map(({ card, combo, owner }) => ({
        v: { owner, combo: combo.id, card: card.id }, card,
        label: `${cn(card)} from ${owner === t.p ? 'your' : nm(s, owner) + "'s"} combo`,
        w: owner === t.p ? -5 : comboPoints(combo) + 2,
      })),
    };
  },
  exec(s, t, v) {
    const card = takeFromCombo(s, v.owner, v.combo, v.card);
    s.players[t.p].hand.push(card);
    log(s, `${nm(s, t.p)} takes ${cn(card)} from ${nm(s, v.owner)}.`, null, { t: 'take', p: t.p, from: v.owner, k: card.k });
    s.queue.unshift({ t: 'freeplay', p: t.p, cards: [card.id], optional: true });
  },
};
simple('bride', {});

POWERS.centaur = (s, t) => {
  const card = s.discard.pop();
  if (!card) { log(s, 'The discard pile is empty.'); return; }
  s.players[t.p].hand.push(card);
  log(s, `${nm(s, t.p)} takes ${cn(card)} from the discard pile.`, null, { t: 'take', p: t.p, from: 'discard', k: card.k });
  s.queue.unshift({ t: 'freeplay', p: t.p, cards: [card.id], optional: true });
};

POWERS.darkunicorn = (s, t) => {
  for (const j of others(s, t.p)) {
    const h = s.players[j].hand;
    if (!h.length) continue;
    const c = removeRandom(s, h);
    s.discard.push(c);
    log(s, `${nm(s, j)} discards ${cn(c)}.`, null, { t: 'discard', p: j, k: c.k });
  }
};

TASKS.demon = {
  prompt(s, t) {
    const opts = [];
    s.players.forEach((pl, owner) => pl.combos.forEach(combo => {
      if (combo.frozen) return;
      opts.push({ v: combo.id, label: comboLabel(s, owner, combo), w: owner === t.p ? -comboPoints(combo) : comboPoints(combo) + threat(s, owner) * 0.1 });
    }));
    return { title: 'Demon: send which combo to the discard pile?', empty: 'There is no combo the Demon can destroy.', options: opts };
  },
  exec(s, t, id) {
    const f = findCombo(s, id);
    const combo = detachCombo(s, f.owner, id);
    s.discard.push(...combo.cards);
    log(s, `${nm(s, t.p)} destroys ${nm(s, f.owner)}'s combo (${combo.cards.map(cn).join(', ')}).`, null, { t: 'destroy', p: t.p, owner: f.owner });
  },
};
simple('demon', {});

const stealPrompt = (title, n) => ({
  prompt(s, t) {
    return {
      title, empty: 'Nobody has cards to steal.',
      options: stealTargets(s, t.p, 1).map(j => playerOpt(s, t.p, j, ` (${s.players[j].hand.length} cards)`)),
    };
  },
  exec(s, t, j) {
    const tasks = [];
    for (let i = 0; i < n; i++) tasks.push({ t: 'steal', p: t.p, target: j, mode: 'power' });
    s.queue.unshift(...tasks);
  },
});
TASKS.dracula = stealPrompt('Dracula: steal 2 cards from which player?', 2);
simple('dracula', {});
TASKS.troll = {
  prompt(s, t) {
    return {
      title: 'Troll: which player must discard a random card?', empty: 'Nobody has cards to discard.',
      options: stealTargets(s, t.p, 1).map(j => playerOpt(s, t.p, j)),
    };
  },
  exec(s, t, j) {
    const c = removeRandom(s, s.players[j].hand);
    s.discard.push(c);
    log(s, `${nm(s, j)} discards ${cn(c)} (Troll).`, null, { t: 'discard', p: j, k: c.k });
  },
};
simple('troll', {});
TASKS.werewolf = {
  prompt(s, t) {
    return { title: 'Werewolf: which player loses their next turn?', options: others(s, t.p).map(j => playerOpt(s, t.p, j)) };
  },
  exec(s, t, j) {
    s.players[j].skip++;
    log(s, `${nm(s, j)} will lose their next turn.`, null, { t: 'curse', p: t.p, target: j });
  },
};
simple('werewolf', {});

TASKS.dwarf = {
  prompt(s, t) {
    const opts = [];
    const d = s.discard[s.discard.length - 1], k = s.deck[s.deck.length - 1];
    if (d) opts.push({ v: 'discard', label: `Keep ${cn(d)} (discard pile)`, card: d, w: handCardValue(s.players[t.p].hand, d) });
    if (k) opts.push({ v: 'deck', label: `Keep ${cn(k)} (deck)`, card: k, w: handCardValue(s.players[t.p].hand, k) });
    return { title: 'Dwarf: keep one card, the other goes to the discard pile.', empty: 'Both the deck and discard pile are empty.', options: opts };
  },
  exec(s, t, v) {
    const hand = s.players[t.p].hand;
    if (v === 'deck') {
      const c = takeFromDeck(s);
      hand.push(c);
      log(s, `${nm(s, t.p)} keeps the top card of the deck.`, null, { t: 'draw', p: t.p });
      log(s, `You kept ${cn(c)}.`, [t.p]);
    } else {
      const c = s.discard.pop();
      hand.push(c);
      const k = takeFromDeck(s);
      if (k) s.discard.push(k);
      log(s, `${nm(s, t.p)} keeps ${cn(c)} from the discard pile${k ? ` and discards ${cn(k)} from the deck` : ''}.`, null, { t: 'take', p: t.p, from: 'discard', k: c.k });
    }
  },
};
simple('dwarf', {});

TASKS.elf = {
  prompt(s, t) {
    const opts = [];
    for (const combo of s.players[t.p].combos) {
      if (combo.type !== 'super') continue;
      for (const c of combo.cards) {
        if (c.k === 'elf' || !hasPower(c.k) || s.turn.used.includes(c.id)) continue;
        opts.push({ v: c.id, label: `Reactivate ${cn(c)}`, card: c, w: POWER_WEIGHT[c.k] || 1 });
      }
    }
    return { title: 'Elf: reactivate which of your supernaturals?', empty: 'You have no other supernatural to reactivate.', options: opts };
  },
  exec(s, t, id) {
    const card = s.players[t.p].combos.flatMap(c => c.cards).find(c => c.id === id);
    s.queue.unshift({ t: 'power', p: t.p, key: card.k, card: id });
  },
};
simple('elf', {});

TASKS.faeries = {
  prompt(s, t) {
    return {
      title: `Faeries: take a card from the discard pile (${t.taken.length + 1} of 2).`,
      empty: 'The discard pile is empty.',
      options: s.discard.map(c => ({ v: c.id, label: cn(c), card: c, w: handCardValue(s.players[t.p].hand, c) })),
    };
  },
  exec(s, t, id) {
    const c = removeById(s.discard, id);
    s.players[t.p].hand.push(c);
    log(s, `${nm(s, t.p)} takes ${cn(c)} from the discard pile.`, null, { t: 'take', p: t.p, from: 'discard', k: c.k });
    const taken = [...t.taken, id];
    if (taken.length < 2 && s.discard.length) s.queue.unshift({ ...t, taken });
    else s.queue.unshift({ t: 'freeplay', p: t.p, cards: taken, optional: true });
  },
};
POWERS.faeries = (s, t) => {
  if (!s.discard.length) { log(s, 'The discard pile is empty.'); return; }
  s.queue.unshift({ t: 'faeries', p: t.p, taken: [] });
};

TASKS.ghouls = {
  prompt(s, t) {
    const opts = [];
    if (s.deck.length) opts.push({ v: 'draw', label: 'Draw from the deck', w: 2 });
    for (const j of stealTargets(s, t.p, 1)) opts.push({ v: { steal: j }, label: `Steal from ${nm(s, j)}`, w: 1 + s.players[j].hand.length * 0.15 });
    return { title: 'Ghouls: draw a card or steal one.', empty: 'There is nothing to draw or steal.', options: opts };
  },
  exec(s, t, v) {
    if (v === 'draw') drawCard(s, t.p);
    else s.queue.unshift({ t: 'steal', p: t.p, target: v.steal, mode: 'power' });
  },
};
simple('ghouls', {});

TASKS.giant = {
  prompt(s, t) {
    return {
      title: 'Giant: take any card from the discard pile.', empty: 'The discard pile is empty.',
      options: s.discard.map(c => ({ v: c.id, label: cn(c), card: c, w: handCardValue(s.players[t.p].hand, c) })),
    };
  },
  exec(s, t, id) {
    const c = removeById(s.discard, id);
    s.players[t.p].hand.push(c);
    log(s, `${nm(s, t.p)} takes ${cn(c)} from the discard pile.`, null, { t: 'take', p: t.p, from: 'discard', k: c.k });
    s.queue.unshift({ t: 'freeplay', p: t.p, cards: [c.id], optional: true });
  },
};
simple('giant', {});

TASKS.goblins = {
  prompt(s, t) {
    return {
      title: `Goblins: steal from which player? (${4 - t.n} of 3)`, empty: 'Nobody has cards left to steal.',
      options: stealTargets(s, t.p, 1).map(j => playerOpt(s, t.p, j, ` (${s.players[j].hand.length} cards)`)),
    };
  },
  exec(s, t, j) {
    const q = [{ t: 'steal', p: t.p, target: j, mode: 'power' }];
    if (t.n > 1) q.push({ ...t, n: t.n - 1 });
    s.queue.unshift(...q);
  },
};
simple('goblins', { n: 3 });

TASKS.highwayman = {
  prompt(s, t) {
    if (!s.players[t.p].combos.some(c => !c.frozen)) return { title: '', empty: 'You have no combo to swap.', options: [] };
    const opts = [];
    for (const j of others(s, t.p)) for (const combo of s.players[j].combos) {
      if (!combo.frozen) opts.push({ v: combo.id, label: comboLabel(s, j, combo), w: comboPoints(combo) });
    }
    return { title: 'Highwayman: which combo do you want to take?', empty: 'No other player has a combo you can take.', options: opts };
  },
  exec(s, t, id) { s.queue.unshift({ t: 'highwayman2', p: t.p, theirs: id }); },
};
TASKS.highwayman2 = {
  prompt(s, t) {
    return {
      title: 'Highwayman: which of your combos do you give in exchange?',
      options: s.players[t.p].combos.filter(c => !c.frozen).map(c => ({ v: c.id, label: comboLabel(s, t.p, c), w: -comboPoints(c) })),
    };
  },
  exec(s, t, mine) {
    const f = findCombo(s, t.theirs);
    const a = detachCombo(s, t.p, mine), b = detachCombo(s, f.owner, t.theirs);
    s.players[t.p].combos.push(b);
    s.players[f.owner].combos.push(a);
    log(s, `${nm(s, t.p)} swaps a combo with ${nm(s, f.owner)}: gives ${a.cards.map(cn).join(', ')}, takes ${b.cards.map(cn).join(', ')}.`, null, { t: 'swapCombo', p: t.p, with: f.owner });
  },
};
simple('highwayman', {});

TASKS.hydra = {
  prompt(s, t) {
    return { title: 'Hydra: look at which player\'s hand?', options: others(s, t.p).map(j => playerOpt(s, t.p, j)) };
  },
  exec(s, t, j) {
    log(s, `${nm(s, t.p)} looks at ${nm(s, j)}'s hand.`, null, { t: 'peek', p: t.p, target: j });
    s.queue.unshift(revealTask(s, t.p, `${nm(s, j)}'s hand`, [j]));
  },
};
simple('hydra', {});

POWERS.mage = (s, t) => { drawCard(s, t.p); drawCard(s, t.p); };

TASKS.nymph = {
  prompt(s, t) {
    const locs = superLocations(s, c => c.id !== t.card && c.k !== 'nymph' && !s.turn.used.includes(c.id));
    return {
      title: 'Nymph: take a supernatural from the table and play it immediately.',
      empty: 'There is no supernatural the Nymph can take.',
      options: locs.map(({ card, combo, owner }) => ({
        v: { owner, combo: combo.id, card: card.id }, card,
        label: `${cn(card)} from ${owner === t.p ? 'your' : nm(s, owner) + "'s"} combo`,
        w: (owner === t.p ? -3 : comboPoints(combo)) + (POWER_WEIGHT[card.k] || 0),
      })),
    };
  },
  exec(s, t, v) {
    const card = takeFromCombo(s, v.owner, v.combo, v.card);
    s.players[t.p].hand.push(card);
    log(s, `${nm(s, t.p)} takes ${cn(card)} from ${nm(s, v.owner)}.`, null, { t: 'take', p: t.p, from: v.owner, k: card.k });
    s.queue.unshift({ t: 'freeplay', p: t.p, cards: [card.id], optional: false });
  },
};
simple('nymph', {});

TASKS.sqsteal = stealPrompt('Shadow Queen: steal 1 card blind from which player?', 1);
POWERS.shadowqueen = (s, t) => {
  log(s, `${nm(s, t.p)} looks at every other player's hand.`, null, { t: 'peek', p: t.p, target: -1 });
  s.queue.unshift(revealTask(s, t.p, 'Shadow Queen: every hand', others(s, t.p)), { t: 'sqsteal', p: t.p });
};

TASKS.sorceress = {
  prompt(s, t) {
    const hand = s.players[t.p].hand;
    const can = ['owl', 'crow'].some(k => hand.filter(c => c.k === k).length >= 2);
    if (!can) return { title: '', empty: 'You need 2 Owls or 2 Crows in hand to use the Sorceress.', options: [] };
    const opts = [];
    for (const j of others(s, t.p)) for (const combo of s.players[j].combos) {
      if (!combo.frozen) opts.push({ v: combo.id, label: comboLabel(s, j, combo), w: comboPoints(combo) - 4 });
    }
    opts.push({ v: 'skip', label: "Don't sacrifice anything", w: 0 });
    return { title: 'Sorceress: take which combo?', empty: 'No other player has a combo you can take.', options: opts };
  },
  exec(s, t, id) { if (id !== 'skip') s.queue.unshift({ t: 'sorceress2', p: t.p, combo: id }); },
};
TASKS.sorceress2 = {
  prompt(s, t) {
    const hand = s.players[t.p].hand;
    return {
      title: 'Sorceress: sacrifice which pair?',
      options: ['owl', 'crow'].filter(k => hand.filter(c => c.k === k).length >= 2)
        .map(k => ({ v: k, label: `Discard 2 ${cardName(k)}s`, w: -hand.filter(c => c.k === k).length })),
    };
  },
  exec(s, t, k) {
    const hand = s.players[t.p].hand;
    for (let i = 0; i < 2; i++) s.discard.push(hand.splice(hand.findIndex(c => c.k === k), 1)[0]);
    const f = findCombo(s, t.combo);
    s.players[t.p].combos.push(detachCombo(s, f.owner, t.combo));
    log(s, `${nm(s, t.p)} sacrifices 2 ${cardName(k)}s and takes ${nm(s, f.owner)}'s combo!`, null, { t: 'seize', p: t.p, from: f.owner });
  },
};
simple('sorceress', {});

TASKS.eternals = {
  prompt(s, t) {
    const hand = s.players[t.p].hand;
    if (hand.length >= HAND_LIMIT) return null;
    const opts = [];
    if (s.deck.length) opts.push({ v: 'draw', label: 'Draw from the deck', w: 2 });
    for (const j of stealTargets(s, t.p, 1)) opts.push({ v: { steal: j }, label: `Steal from ${nm(s, j)}`, w: 1 + s.players[j].hand.length * 0.15 });
    if (!opts.length) return null;
    opts.push({ v: 'stop', label: 'Stop here', w: -1 });
    return { title: `The Eternals: fill your hand to ${HAND_LIMIT} (now ${hand.length}).`, options: opts };
  },
  exec(s, t, v) {
    if (v == null || v === 'stop') return;
    if (v === 'draw') { drawCard(s, t.p); s.queue.unshift(t); }
    else s.queue.unshift({ t: 'steal', p: t.p, target: v.steal, mode: 'power' }, t);
  },
};
simple('eternals', {});

TASKS.larakiKeep = {
  prompt(s, t) {
    return {
      title: 'The Laraki: keep one of these cards.',
      options: s.limbo.map(c => ({ v: c.id, label: cn(c), card: c, w: handCardValue(s.players[t.p].hand, c) })),
    };
  },
  exec(s, t, id) {
    const c = removeById(s.limbo, id);
    s.players[t.p].hand.push(c);
    log(s, `${nm(s, t.p)} keeps ${cn(c)}.`, null, { t: 'take', p: t.p, from: 'limbo', k: c.k });
    s.queue.unshift(...others(s, t.p).map(j => ({ t: 'larakiGive', p: t.p, to: j })), { t: 'limboFlush' });
  },
};
TASKS.larakiGive = {
  prompt(s, t) {
    if (!s.limbo.length) return null;
    return {
      title: `The Laraki: give a card face up to ${nm(s, t.to)}.`,
      options: s.limbo.map(c => ({ v: c.id, label: cn(c), card: c, w: -handCardValue([], c) })),
    };
  },
  exec(s, t, id) {
    if (id == null) return;
    const c = removeById(s.limbo, id);
    s.players[t.to].hand.push(c);
    log(s, `${nm(s, t.p)} gives ${cn(c)} to ${nm(s, t.to)}.`, null, { t: 'give', p: t.p, to: t.to, k: c.k, from: 'limbo' });
  },
};
TASKS.limboFlush = { exec(s) { s.discard.push(...s.limbo.splice(0)); } };
POWERS.laraki = (s, t) => {
  const n = Math.min(s.players.length, s.discard.length);
  if (!n) { log(s, 'The discard pile is empty.'); return; }
  s.limbo = s.discard.splice(s.discard.length - n, n).reverse();
  log(s, `${nm(s, t.p)} reveals ${s.limbo.map(cn).join(', ')} from the discard pile.`, null, { t: 'reveal', p: t.p });
  s.queue.unshift({ t: 'larakiKeep', p: t.p });
};

// How much the AI likes each power in general (also used for Elf / Nymph hints).
export const POWER_WEIGHT = {
  amazon: 3, boogeyman: 2, bride: 3, centaur: 2, darkunicorn: 2.5, demon: 5, dracula: 4, dwarf: 2,
  elf: 3, faeries: 3, ghouls: 2, giant: 3, goblins: 5, highwayman: 4, hydra: 0.5, mage: 4,
  nymph: 4, shadowqueen: 2.5, sorceress: 3, eternals: 5, laraki: 2, troll: 2, werewolf: 3,
};

// ---------- turn flow ----------

function startTurn(s, p) {
  s.turn = { player: p, play: 1, extra: 0, phase: 'main', used: [], no: (s.turn?.no || 0) + 1 };
  log(s, `— ${nm(s, p)}'s turn —`, null, { t: 'turn', p });
}

function gameOver(s) {
  s.over = true;
  s.queue = [];
  s.turn.phase = 'over';
  const scores = s.players.map(playerScore);
  const best = Math.max(...scores);
  s.winners = scores.map((v, i) => (v === best ? i : -1)).filter(i => i >= 0);
  log(s, `Game over! ${s.winners.map(i => nm(s, i)).join(' & ')} win${s.winners.length > 1 ? '' : 's'} with ${best} points.`, null, { t: 'over' });
}

function run(s) {
  s.pending = null;
  let guard = 0;
  while (s.queue.length && !s.over) {
    if (++guard > 5000) throw new Error('Engine loop guard tripped');
    const t = s.queue[0];
    const h = TASKS[t.t];
    const spec = h.prompt ? h.prompt(s, t) : null;
    if (spec) {
      if (!spec.options.length) {
        s.queue.shift();
        if (spec.empty) log(s, spec.empty, [t.p]);
        continue;
      }
      s.pending = { ...spec, player: spec.player ?? t.p, task: t.t };
      return;
    }
    s.queue.shift();
    h.exec(s, t, undefined);
  }
  // Once the turn is closed, end it automatically unless there is still
  // something worth placing (a full combo, or supernaturals on the final round).
  if (!s.over && !s.pending && s.turn.phase === 'wrap' && !wrapHasWork(s)) {
    s.turn.phase = 'ending';
    s.queue.push({ t: 'handLimit', p: s.turn.player }, { t: 'advance' });
    run(s);
  }
}

export function readyTriples(hand) {
  const by = k => hand.filter(c => c.k === k);
  const out = [];
  for (const k of ['owl', 'crow']) if (by(k).length >= 3) out.push(by(k).slice(0, 3));
  const [sw, pa, cl] = ['swamp', 'path', 'clearing'].map(by);
  if (sw.length && pa.length && cl.length) out.push([sw[0], pa[0], cl[0]]);
  for (const g of [sw, pa, cl]) if (g.length >= 3) out.push(g.slice(0, 3));
  return out;
}

function wrapHasWork(s) {
  const hand = s.players[s.turn.player].hand;
  if (readyTriples(hand).length) return true;
  return s.endTrigger !== null && hand.some(c => isSuper(c.k));
}

function useToken(s) {
  if (s.turn.play > 0) s.turn.play--;
  else if (s.turn.extra > 0) s.turn.extra--;
  else throw new Error('You have no actions left to play a card.');
}

export function newGame({ players, seed }) {
  const s = {
    v: 1,
    rng: (seed ?? Math.floor(Math.random() * 2 ** 31)) | 0,
    players: players.map(p => ({ id: p.id, name: p.name, ai: p.ai || null, hand: [], combos: [], skip: 0 })),
    deck: [], discard: [], limbo: [], queue: [], pending: null, log: [], logN: 0,
    nextCombo: 1, endTrigger: null, over: false, winners: [], turn: null,
  };
  if (s.players.length < 2 || s.players.length > 6) throw new Error('The Grimwood needs 2 to 6 players.');
  s.deck = shuffle(s, buildDeck(s.players.length));
  for (let r = 0; r < 3; r++) for (const pl of s.players) pl.hand.push(s.deck.pop());
  const first = Math.floor(rand(s) * s.players.length);
  log(s, `A new game in the Grimwood begins. ${nm(s, first)} goes first.`);
  startTurn(s, first);
  return s;
}

export function canPass(s, p) { return !s.deck.length && !stealTargets(s, p).length; }

export function apply(s, a) {
  if (s.over) throw new Error('The game is over.');
  const p = a.player;
  if (s.pending) {
    if (a.type !== 'choose') throw new Error('Waiting for a decision.');
    if (p !== s.pending.player) throw new Error('It is not your decision.');
    const key = JSON.stringify(a.value);
    if (!s.pending.options.some(o => JSON.stringify(o.v) === key)) throw new Error('Invalid choice.');
    const t = s.queue.shift();
    s.pending = null;
    TASKS[t.t].exec(s, t, a.value);
    run(s);
    return s;
  }
  if (p !== s.turn.player) throw new Error('It is not your turn.');
  const pl = s.players[p];
  const ph = s.turn.phase;
  const needMain = () => { if (ph !== 'main') throw new Error('You already closed your turn.'); };
  const fromHand = id => {
    const c = pl.hand.find(c => c.id === id);
    if (!c) throw new Error('That card is not in your hand.');
    return c;
  };

  switch (a.type) {
    case 'place_combo': {
      const cards = (a.cards || []).map(fromHand);
      if (new Set(a.cards).size !== 3) throw new Error('A combo needs 3 different cards.');
      const type = classifyTriple(cards);
      if (!type) throw new Error('Those cards do not form a combo.');
      for (const c of cards) removeById(pl.hand, c.id);
      const combo = { id: 'k' + (s.nextCombo++), type, cards, frozen: false };
      pl.combos.push(combo);
      log(s, `${nm(s, p)} places a combo: ${cards.map(cn).join(', ')} (${comboPoints(combo)} pts).`, null, { t: 'combo', p, pts: comboPoints(combo) });
      break;
    }
    case 'place_super': {
      const c = fromHand(a.card);
      if (!isSuper(c.k)) throw new Error('Only supernaturals can be placed this way.');
      placeSuper(s, p, c, a.combo);
      removeById(pl.hand, c.id);
      log(s, `${nm(s, p)} places ${cn(c)} without using its power.`, null, { t: 'place', p, k: c.k });
      break;
    }
    case 'play_super': {
      needMain();
      const c = fromHand(a.card);
      if (!hasPower(c.k)) throw new Error('That card has no power to play.');
      useToken(s);
      placeSuper(s, p, c, a.combo);
      removeById(pl.hand, c.id);
      log(s, `${nm(s, p)} plays ${cn(c)}.`, null, { t: 'play', p, k: c.k });
      s.queue.push({ t: 'power', p, key: c.k, card: c.id });
      break;
    }
    case 'play_rune': {
      needMain();
      const c = fromHand(a.card);
      if (c.k !== 'rune') throw new Error('That is not a Rune.');
      useToken(s);
      removeById(pl.hand, c.id);
      s.discard.push(c);
      s.turn.extra += 2;
      log(s, `${nm(s, p)} plays a Rune and gains 2 extra actions.`, null, { t: 'rune', p });
      break;
    }
    case 'draw': {
      needMain();
      if (!s.deck.length) throw new Error('The deck is empty.');
      if (s.turn.extra > 0) s.turn.extra--; else s.turn.phase = 'wrap';
      drawCard(s, p);
      break;
    }
    case 'steal': {
      needMain();
      if (!stealTargets(s, p).includes(a.target)) throw new Error('You can only steal from another player with 2 or more cards.');
      if (s.turn.extra > 0) s.turn.extra--; else s.turn.phase = 'wrap';
      s.queue.push({ t: 'steal', p, target: a.target, mode: 'normal' });
      break;
    }
    case 'pass': {
      needMain();
      if (!canPass(s, p)) throw new Error('You must draw or steal to close your turn.');
      s.turn.extra = 0;
      s.turn.phase = 'wrap';
      log(s, `${nm(s, p)} cannot draw or steal and passes.`, null, { t: 'pass', p });
      break;
    }
    case 'end_turn': {
      if (ph !== 'wrap') throw new Error('Close your turn first by drawing or stealing a card.');
      s.queue.push({ t: 'handLimit', p }, { t: 'advance' });
      break;
    }
    default:
      throw new Error('Unknown action: ' + a.type);
  }
  run(s);
  return s;
}

// What player `i` is allowed to see. i = -1 gives a spectator view.
export function viewFor(s, i) {
  const pend = s.pending;
  return {
    me: i,
    over: s.over,
    winners: s.winners,
    endTrigger: s.endTrigger,
    deckCount: s.deck.length,
    discard: s.discard,
    limbo: s.limbo,
    turn: s.turn,
    players: s.players.map(pl => ({
      id: pl.id, name: pl.name, ai: pl.ai, handCount: pl.hand.length,
      combos: pl.combos, skip: pl.skip, score: playerScore(pl),
    })),
    hand: i >= 0 ? s.players[i].hand : [],
    finalHands: s.over ? s.players.map(pl => pl.hand) : null,
    pending: pend ? (pend.player === i ? pend : { player: pend.player, task: pend.task, waiting: true }) : null,
    log: s.log.filter(e => !e.to || e.to.includes(i)).slice(-80),
  };
}
