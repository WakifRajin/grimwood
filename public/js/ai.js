// AI players. They only ever see their own view (viewFor), never the full state.
import { CARDS, MAX_SUPER_COMBO, classifyTriple, hasPower, isSuper } from './cards.js';
import { POWER_WEIGHT } from './engine.js';

let R = Math.random;
const rnd = arr => arr[Math.floor(R() * arr.length)];

function bestTriple(hand) {
  const by = k => hand.filter(c => c.k === k);
  for (const k of ['owl', 'crow']) if (by(k).length >= 3) return by(k).slice(0, 3);
  const [s, p, c] = ['swamp', 'path', 'clearing'].map(by);
  if (s.length && p.length && c.length) return [s[0], p[0], c[0]];
  for (const g of [s, p, c]) if (g.length >= 3) return g.slice(0, 3);
  return null;
}

function myCombos(v) { return v.players[v.me].combos; }
function superTargets(v) {
  return myCombos(v)
    .filter(c => c.type === 'super' && !c.frozen && c.cards.length < MAX_SUPER_COMBO)
    .sort((a, b) => b.cards.length - a.cards.length);
}
function placement(v, key) {
  const t = superTargets(v);
  if (key === 'dragon') return t[0]?.id ?? 'new';
  // Don't stuff a near-full combo with a dragon-less risk; just grow the biggest one.
  return t[0]?.id ?? 'new';
}

function usefulness(v, key) {
  const me = v.me, hand = v.hand;
  const opp = v.players.filter((_, i) => i !== me);
  const oppCombos = opp.flatMap(p => p.combos.filter(c => !c.frozen));
  const comboPts = c => c.type === 'super' ? [0, 1, 2, 5, 10, 15][Math.min(5, c.cards.length)]
    : c.type === 'animal' ? 10 : new Set(c.cards.map(x => x.k)).size === 3 ? 5 : 3;
  const oppCards = opp.some(p => p.handCount > 0);
  const tableSupers = v.players.flatMap((p, i) => p.combos.filter(c => c.type === 'super' && !c.frozen)
    .flatMap(c => c.cards.map(x => ({ x, mine: i === me }))));
  const ok = (() => {
    switch (key) {
      case 'demon': return oppCombos.some(c => comboPts(c) >= 3);
      case 'highwayman': {
        const mine = myCombos(v).filter(c => !c.frozen).map(comboPts);
        const give = mine.length ? Math.min(...mine) : 1;
        return oppCombos.some(c => comboPts(c) > give + 2);
      }
      case 'sorceress': return ['owl', 'crow'].some(k => hand.filter(c => c.k === k).length >= 2)
        && oppCombos.some(c => comboPts(c) >= 10);
      case 'bride': return tableSupers.some(t => !t.mine && CARDS[t.x.k].male);
      case 'nymph': return tableSupers.some(t => !t.mine && t.x.k !== 'nymph');
      case 'centaur': case 'giant': case 'faeries': return v.discard.length > 0;
      case 'laraki': return v.discard.length >= 2;
      case 'dracula': case 'goblins': case 'troll': case 'shadowqueen': case 'darkunicorn': case 'ghouls':
        return oppCards;
      case 'boogeyman': return opp.some(p => p.handCount > hand.length + 1);
      case 'elf': return myCombos(v).some(c => c.type === 'super' && c.cards.some(x => hasPower(x.k) && x.k !== 'elf'));
      case 'mage': case 'eternals': case 'dwarf': return v.deckCount > 0 || key === 'eternals';
      default: return true;
    }
  })();
  return ok ? POWER_WEIGHT[key] || 1 : 0;
}

function choose(v, level) {
  const opts = v.pending.options;
  if (level === 'easy') {
    // Easy still blocks steals and discards sensibly half the time.
    if (R() < 0.5) return rnd(opts).v;
  }
  let best = opts[0], bw = -Infinity;
  for (const o of opts) {
    const w = (o.w ?? 0) + R() * 0.4;
    if (w > bw) { bw = w; best = o; }
  }
  return best.v;
}

export function aiDecide(v, level = 'normal', rng = Math.random) {
  R = rng;
  const me = v.me;
  if (v.over) return null;
  if (v.pending) {
    if (v.pending.player !== me || v.pending.waiting) return null;
    return { type: 'choose', value: choose(v, level) };
  }
  if (v.turn.player !== me) return null;
  const hand = v.hand;
  const turn = v.turn;
  const finalTurn = v.endTrigger !== null;
  const nearEnd = finalTurn || v.deckCount <= v.players.length * 2;

  // 1. Lay down any complete animal / settings combo.
  const tri = bestTriple(hand);
  if (tri && classifyTriple(tri)) return { type: 'place_combo', cards: tri.map(c => c.id) };

  // Dragon: lock in a decent combo.
  const dragon = hand.find(c => c.k === 'dragon');
  if (dragon && (superTargets(v)[0]?.cards.length >= 2 || nearEnd)) {
    return { type: 'place_super', card: dragon.id, combo: placement(v, 'dragon') };
  }

  if (turn.phase === 'main') {
    const tokens = turn.play + turn.extra;
    const supers = hand.filter(c => hasPower(c.k));
    const rune = hand.find(c => c.k === 'rune');

    if (rune && turn.play > 0 && (supers.length || v.deckCount > 2) && (level !== 'easy' || R() < 0.5)) {
      return { type: 'play_rune', card: rune.id };
    }
    if (tokens > 0 && supers.length) {
      let best = null, bw = 0;
      for (const c of supers) {
        const w = level === 'easy' ? R() * 3 : usefulness(v, c.k) + R() * 0.5;
        if (w > bw) { bw = w; best = c; }
      }
      if (best && bw >= 1) return { type: 'play_super', card: best.id, combo: placement(v, best.k) };
    }
    // Spend extra actions on drawing.
    if (turn.extra > 0 && v.deckCount > 0) return { type: 'draw' };

    // Bank supernaturals for points near the end or when the hand is full.
    const sup = hand.filter(c => isSuper(c.k));
    if (sup.length && (nearEnd || hand.length >= 7)) {
      return { type: 'place_super', card: sup[0].id, combo: placement(v, sup[0].k) };
    }

    // Close the turn.
    const targets = v.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== me && p.handCount >= 2)
      .sort((a, b) => b.p.handCount - a.p.handCount);
    const stealBias = level === 'easy' ? 0.2 : (targets[0]?.p.handCount >= 5 ? 0.4 : 0.15);
    if (targets.length && (v.deckCount === 0 || R() < stealBias)) return { type: 'steal', target: targets[0].i };
    if (v.deckCount > 0) return { type: 'draw' };
    return { type: 'pass' };
  }

  // Wrap-up phase.
  if (finalTurn) {
    const sup = hand.find(c => isSuper(c.k));
    if (sup && superTargets(v).length + 1 > 0) return { type: 'place_super', card: sup.id, combo: placement(v, sup.k) };
  }
  return { type: 'end_turn' };
}
