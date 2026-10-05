// Targeted checks for Amulet blocking (normal steals, power steals, bots).
import assert from 'node:assert/strict';
import { apply, newGame, viewFor } from '../public/js/engine.js';
import { aiDecide } from '../public/js/ai.js';

function setup({ thiefHand = [], victimHand = [], thiefAi = null, victimAi = null }) {
  const s = newGame({
    players: [{ id: 'a', name: 'Thief', ai: thiefAi }, { id: 'b', name: 'Victim', ai: victimAi }, { id: 'c', name: 'Other', ai: 'normal' }],
    seed: 1,
  });
  const pool = [...s.deck, ...s.players.flatMap(p => p.hand)];
  const take = k => pool.splice(pool.findIndex(c => c.k === k), 1)[0];
  s.players[0].hand = thiefHand.map(take);
  s.players[1].hand = victimHand.map(take);
  s.players[2].hand = ['owl', 'owl'].map(take);
  s.deck = pool;
  s.turn = { player: 0, play: 1, extra: 0, phase: 'main', used: [], no: 1 };
  return s;
}
const count = (s, p, k) => s.players[p].hand.filter(c => c.k === k).length;
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓', name); };

test('normal steal from an Amulet holder asks the victim', () => {
  const s = setup({ victimHand: ['amulet', 'owl', 'crow'] });
  apply(s, { type: 'steal', player: 0, target: 1 });
  assert.equal(s.pending?.player, 1, 'victim must be asked');
  assert.deepEqual(s.pending.options.map(o => o.v), ['block', 'allow']);
  assert.equal(s.players[1].hand.length, 3, 'nothing taken before the victim decides');
});

test('blocking a normal steal: no card moves, Amulet is spent, thief loses the turn', () => {
  const s = setup({ victimHand: ['amulet', 'owl', 'crow'] });
  apply(s, { type: 'steal', player: 0, target: 1 });
  apply(s, { type: 'choose', player: 1, value: 'block' });
  assert.equal(s.players[0].hand.length, 0, 'thief got nothing');
  assert.equal(s.players[1].hand.length, 2);
  assert.equal(count(s, 1, 'amulet'), 0, 'amulet discarded');
  assert.equal(s.discard.at(-1).k, 'amulet');
  assert.notEqual(s.turn.player, 0, "thief's turn is over");
});

test('allowing the steal moves exactly one card', () => {
  const s = setup({ victimHand: ['amulet', 'owl', 'crow'] });
  apply(s, { type: 'steal', player: 0, target: 1 });
  apply(s, { type: 'choose', player: 1, value: 'allow' });
  assert.equal(s.players[0].hand.length, 1);
  assert.equal(s.players[1].hand.length, 2);
});

test('only the victim can answer the Amulet prompt', () => {
  const s = setup({ victimHand: ['amulet', 'owl', 'crow'] });
  apply(s, { type: 'steal', player: 0, target: 1 });
  assert.throws(() => apply(s, { type: 'choose', player: 0, value: 'allow' }), /not your decision/);
});

test('power steals (Dracula) ask once per card; a block stops one steal, the turn goes on', () => {
  const s = setup({ thiefHand: ['dracula'], victimHand: ['amulet', 'amulet', 'owl', 'crow'] });
  apply(s, { type: 'play_super', player: 0, card: s.players[0].hand[0].id, combo: 'new' });
  apply(s, { type: 'choose', player: 0, value: 1 }); // target the victim
  assert.equal(s.pending?.player, 1);
  apply(s, { type: 'choose', player: 1, value: 'block' });
  assert.equal(s.pending?.player, 1, 'second steal asks again (one Amulet left)');
  apply(s, { type: 'choose', player: 1, value: 'block' });
  assert.equal(s.players[0].hand.length, 0, 'both steals blocked');
  assert.equal(count(s, 1, 'amulet'), 0);
  assert.equal(s.turn.player, 0, 'power steals do not end the turn');
  assert.equal(s.turn.phase, 'main');
});

test('a Normal bot always blocks with an Amulet', () => {
  for (let i = 0; i < 200; i++) {
    const s = setup({ victimHand: ['amulet', 'owl', 'crow'], victimAi: 'normal' });
    apply(s, { type: 'steal', player: 0, target: 1 });
    assert.equal(aiDecide(viewFor(s, 1), 'normal').value, 'block');
  }
});

test('an Easy bot always blocks with an Amulet', () => {
  for (let i = 0; i < 200; i++) {
    const s = setup({ victimHand: ['amulet', 'owl', 'crow'], victimAi: 'easy' });
    apply(s, { type: 'steal', player: 0, target: 1 });
    assert.equal(aiDecide(viewFor(s, 1), 'easy').value, 'block', 'easy bot let a steal through');
  }
});

console.log(`OK: ${n} amulet checks passed`);
