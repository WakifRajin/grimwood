// Exercises the online room flow (lobby → host-authoritative game → end) against an
// in-memory fake of the Firebase RTDB API. Each player loads its own copy of online.js.
import { viewFor } from '../public/js/engine.js';
import { aiDecide } from '../public/js/ai.js';

// ---------- fake RTDB ----------
const root = {};
const listeners = new Set();
const segs = p => p.split('/').filter(Boolean);
function getAt(path) {
  let n = root;
  for (const s of segs(path)) { if (n == null || typeof n !== 'object') return null; n = n[s]; }
  return n === undefined ? null : n;
}
function setAt(path, v) {
  const ss = segs(path);
  let n = root;
  for (const s of ss.slice(0, -1)) { if (typeof n[s] !== 'object' || n[s] === null) n[s] = {}; n = n[s]; }
  const last = ss[ss.length - 1];
  if (v === null || v === undefined) delete n[last]; else n[last] = JSON.parse(JSON.stringify(v));
}
let flushing = false;
function changed() {
  if (flushing) return;
  flushing = true;
  queueMicrotask(() => { flushing = false; for (const l of [...listeners]) l(); });
}
const snap = (path) => {
  const v = getAt(path);
  return { exists: () => v !== null, val: () => (v === null ? null : JSON.parse(JSON.stringify(v))), ref: { path } };
};
let pushN = 0;
function makeFb(uid) {
  return {
    db: {}, uid,
    ref: (_db, path) => ({ path }),
    get: async r => snap(r.path),
    set: async (r, v) => { setAt(r.path, v); changed(); },
    update: async (r, obj) => { for (const [k, v] of Object.entries(obj)) setAt(r.path + '/' + k, v); changed(); },
    push: async (r, v) => { const key = 'k' + String(++pushN).padStart(6, '0'); setAt(r.path + '/' + key, v); changed(); return { path: r.path + '/' + key }; },
    remove: async r => { setAt(r.path, null); changed(); },
    serverTimestamp: () => Date.now(),
    onDisconnect: () => ({ set: () => {}, cancel: async () => {} }),
    onValue: (r, cb) => {
      let last;
      const l = () => { const s = JSON.stringify(getAt(r.path)); if (s !== last) { last = s; cb(snap(r.path)); } };
      listeners.add(l); l();
      return () => listeners.delete(l);
    },
    onChildAdded: (r, cb) => {
      const seen = new Set();
      const l = () => {
        for (const k of Object.keys(getAt(r.path) || {}).sort()) {
          if (seen.has(k)) continue;
          seen.add(k);
          cb(snap(r.path + '/' + k));
        }
      };
      listeners.add(l); l();
      return () => listeners.delete(l);
    },
  };
}

// ---------- players ----------
const A = await import('../public/js/online.js?host');
const B = await import('../public/js/online.js?guest');
A.__useFirebase(makeFb('uid-host'));
B.__useFirebase(makeFb('uid-guest'));
const tick = () => new Promise(r => setTimeout(r, 0));

const hostRoom = await A.OnlineRoom.create('Hosty');
let lobby;
hostRoom.watch(st => { lobby = st; });
await tick();
const guestRoom = await B.OnlineRoom.join(hostRoom.code.toLowerCase(), 'Guesty');
await hostRoom.addBot('Morgana', 'normal');
await tick();
if (lobby.players.length !== 2 || lobby.bots.length !== 1) throw new Error('lobby not populated: ' + JSON.stringify(lobby));

let errors = [];
let hostView = null, guestView = null;
await hostRoom.startGame(lobby.players, lobby.bots);
await hostRoom.startHosting(v => { hostView = v; }, e => errors.push('host: ' + e));
guestRoom.startClient(v => { guestView = v; }, e => errors.push('guest: ' + e));
await tick(); await tick();

// Guest must never be able to see the full state or other hands.
const secretVisibleToGuest = JSON.stringify(guestView).includes('"deck"');
if (secretVisibleToGuest) throw new Error('guest view leaks the deck');

// Drive both humans with the AI until the game ends.
for (let i = 0; i < 20000 && !hostRoom.host.state.over; i++) {
  const s = hostRoom.host.state;
  const actor = s.pending ? s.pending.player : s.turn.player;
  const pl = s.players[actor];
  if (pl.ai) { await new Promise(r => setTimeout(r, 1)); hostRoom.host.aiDelay = 0; continue; }
  await tick(); await tick();
  const isHost = pl.id === 'uid-host';
  const v = isHost ? hostView : guestView;
  // The guest's view must be in sync with the authoritative state before acting.
  const expect = viewFor(s, actor);
  if (JSON.stringify(v.turn) !== JSON.stringify(expect.turn) || v.hand.length !== expect.hand.length) continue;
  const a = aiDecide(v, 'normal');
  if (!a) continue;
  if (isHost) { const e = hostRoom.send(a); if (e) throw new Error('host action rejected: ' + e); }
  else guestRoom.send(a);
}
await tick(); await tick();
const s = hostRoom.host.state;
if (!s.over) throw new Error('online game did not finish');
if (getAt(`rooms/${hostRoom.code}/meta/status`) !== 'ended') throw new Error('status not ended');
if (!guestView.over) throw new Error('guest did not see game over');
if (Object.keys(getAt(`rooms/${hostRoom.code}/intents`) || {}).length) throw new Error('intents not consumed');

// Rejoining mid/after game: the first room update must already include the player list.
const rejoin = await B.OnlineRoom.join(hostRoom.code, 'Guesty');
let firstUpdate = null;
rejoin.watch(st => { firstUpdate ||= JSON.parse(JSON.stringify(st)); });
await tick(); await tick();
if (!firstUpdate?.players?.some(p => p.id === 'uid-guest')) throw new Error('rejoin saw an incomplete room: ' + JSON.stringify(firstUpdate));

await hostRoom.backToLobby();
await tick();
if (getAt(`rooms/${hostRoom.code}/secret`) !== null) throw new Error('secret not cleared');
console.log(`OK: online game finished in ${s.turn.no} turns; rejected guest actions: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5));
process.exit(0);
