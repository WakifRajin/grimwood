// Plays many all-AI games through the engine and checks invariants.
import { newGame, apply, viewFor } from '../public/js/engine.js';
import { buildDeck } from '../public/js/cards.js';
import { aiDecide } from '../public/js/ai.js';

let seed = 1; const R = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const GAMES = Number(process.argv[2] || 2000);
let turns = 0, actions = 0;
const wins = { easy: 0, normal: 0 };

function countCards(s) {
  let n = s.deck.length + s.discard.length + s.limbo.length;
  for (const p of s.players) n += p.hand.length + p.combos.reduce((a, c) => a + c.cards.length, 0);
  return n;
}
function ids(s) {
  const all = [...s.deck, ...s.discard, ...s.limbo];
  for (const p of s.players) { all.push(...p.hand); for (const c of p.combos) all.push(...c.cards); }
  return all.map(c => c.id);
}

for (let g = 0; g < GAMES; g++) {
  const n = 2 + (g % 5);
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, ai: i % 2 ? 'easy' : 'normal' }));
  const s = newGame({ players, seed: g * 7919 + 1 });
  const total = buildDeck(n).length;
  let steps = 0; seed = g;
  while (!s.over) {
    if (++steps > 20000) throw new Error(`game ${g} did not finish`);
    const actor = s.pending ? s.pending.player : s.turn.player;
    const a = aiDecide(viewFor(s, actor), s.players[actor].ai, R);
    if (!a) throw new Error(`game ${g}: AI ${actor} returned no action (pending=${s.pending?.task}, phase=${s.turn.phase})`);
    a.player = actor;
    try { apply(s, a); } catch (e) {
      throw new Error(`game ${g}: illegal AI action ${JSON.stringify(a)}: ${e.message}`);
    }
    actions++;
    const c = countCards(s);
    if (c !== total) throw new Error(`game ${g}: card count ${c} != ${total} after ${JSON.stringify(a)}`);
    const id = ids(s);
    if (new Set(id).size !== id.length) throw new Error(`game ${g}: duplicate card ids after ${JSON.stringify(a)}`);
    for (const p of s.players) for (const k of p.combos) {
      if (!k.cards.length) throw new Error(`game ${g}: empty combo`);
      if (k.type === 'super' && k.cards.length > 5) throw new Error(`game ${g}: oversized combo`);
    }
  }
  turns += s.turn.no;
  for (const w of s.winners) wins[s.players[w].ai]++;
  JSON.parse(JSON.stringify(s)); // must stay serialisable
}
console.log(`OK: ${GAMES} games, avg ${(turns / GAMES).toFixed(1)} turns, ${actions} actions. Wins:`, wins);
