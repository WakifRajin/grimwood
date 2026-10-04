// Online rooms on Firebase Realtime Database.
//
// Host-authoritative model (no Cloud Functions needed):
//   rooms/{code}/meta        {host, status: lobby|playing|ended|closed, created}
//   rooms/{code}/players/{uid} {name, joined, online}
//   rooms/{code}/bots/{id}   {name, level, added}           (host only)
//   rooms/{code}/secret      full engine state, JSON string (host only)
//   rooms/{code}/views/{uid} that player's redacted view, JSON string
//   rooms/{code}/intents/{id} {uid, a, t}  actions sent to the host
//   rooms/{code}/errors/{uid} {msg, t}     rejected-action feedback
//   activity/{code}          last-activity timestamp (an index used to find abandoned rooms)
// Players can only read their own view, so hands stay hidden from everyone but the host.
//
// Cleanup without a server: the host deletes the room when leaving, keeps `activity` fresh
// while present, and every client sweeps rooms idle for ROOM_TTL_MS when it creates/joins.
// database.rules.json only lets non-hosts delete rooms that are actually stale.
import { firebaseConfig } from './firebase-config.js';
import { newGame, viewFor } from './engine.js';
import { GameHost } from './host.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;   // keep in sync with database.rules.json (10800000)
const HEARTBEAT_MS = 4 * 60 * 1000;
let fb = null;
let initPromise = null;

export const onlineAvailable = () => !!(firebaseConfig && firebaseConfig.databaseURL);

// Test hook: inject a Firebase-compatible object ({db, uid, ref, get, set, ...}).
export function __useFirebase(obj) { fb = obj; initPromise = Promise.resolve(obj); }

function init() {
  // Memoised so concurrent clicks (Create + Join) don't initialise Firebase twice.
  initPromise ||= doInit().catch(e => { initPromise = null; throw e; });
  return initPromise;
}
async function doInit() {
  const [appMod, authMod, dbMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-database.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const user = await new Promise((resolve, reject) => {
    const off = authMod.onAuthStateChanged(auth, u => {
      if (u) { off(); resolve(u); } else authMod.signInAnonymously(auth).catch(reject);
    });
  });
  fb = { ...dbMod, db: dbMod.getDatabase(app), uid: user.uid };
  return fb;
}

// Delete rooms nobody has touched for ROOM_TTL_MS. Best-effort, runs in the background.
async function sweepStaleRooms() {
  if (!fb.query) return; // test double
  try {
    const q = fb.query(fb.ref(fb.db, 'activity'), fb.orderByValue(), fb.endAt(Date.now() - ROOM_TTL_MS), fb.limitToFirst(25));
    const snap = await fb.get(q);
    const codes = Object.keys(snap.val() || {});
    await Promise.all(codes.map(code =>
      fb.update(fb.ref(fb.db), { [`rooms/${code}`]: null, [`activity/${code}`]: null }).catch(() => {})));
  } catch { /* cleanup is opportunistic */ }
}

export class OnlineRoom {
  constructor(code) {
    this.code = code;
    this.unsubs = [];
    this.session = [];
    this.host = null;
    this.isHost = false;
    this.seat = -1;
  }

  ref(path = '') { return fb.ref(fb.db, `rooms/${this.code}${path ? '/' + path : ''}`); }
  get uid() { return fb.uid; }

  static async create(name) {
    await init();
    for (let i = 0; i < 8; i++) {
      const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      const room = new OnlineRoom(code);
      if ((await fb.get(room.ref('meta'))).exists()) continue;
      await fb.set(room.ref('meta'), { host: fb.uid, status: 'lobby', created: fb.serverTimestamp(), active: fb.serverTimestamp() });
      // Best-effort: older deployed rules may not know the activity index yet.
      fb.set(fb.ref(fb.db, `activity/${code}`), fb.serverTimestamp()).catch(() => {});
      await room.enter(name);
      sweepStaleRooms();
      return room;
    }
    throw new Error('Could not find a free room code. Try again.');
  }

  static async join(code, name) {
    await init();
    code = code.trim().toUpperCase();
    const room = new OnlineRoom(code);
    const meta = (await fb.get(room.ref('meta'))).val();
    if (!meta || meta.status === 'closed') throw new Error(`Room ${code} does not exist.`);
    const me = await fb.get(room.ref(`players/${fb.uid}`));
    if (!me.exists()) {
      if (meta.status !== 'lobby') throw new Error('That game has already started.');
      const [p, b] = await Promise.all([fb.get(room.ref('players')), fb.get(room.ref('bots'))]);
      if (Object.keys(p.val() || {}).length + Object.keys(b.val() || {}).length >= 6) throw new Error('That room is full (6 players).');
    }
    await room.enter(name, me.exists());
    sweepStaleRooms();
    return room;
  }

  async enter(name, existing = false) {
    const me = this.ref(`players/${fb.uid}`);
    if (existing) await fb.update(me, { online: true });
    else await fb.set(me, { name, joined: fb.serverTimestamp(), online: true });
    this.disconnect = fb.onDisconnect(this.ref(`players/${fb.uid}/online`));
    this.disconnect.set(false);
  }

  // cb({meta, players:[{id,name,online}], bots:[{id,name,level}]})
  watch(cb) {
    // Emit only once all three lists have arrived, so routing never sees a half-loaded room.
    const st = { meta: undefined, players: undefined, bots: undefined };
    const emit = () => { if (st.meta !== undefined && st.players && st.bots) cb(st); };
    const sorted = (obj, key) => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => (a[key] || 0) - (b[key] || 0));
    this.unsubs.push(
      fb.onValue(this.ref('meta'), s => {
        st.meta = s.val();
        this.isHost = st.meta?.host === fb.uid;
        if (this.isHost && !this.heartbeat) {
          this.touch();
          this.heartbeat = setInterval(() => this.touch(), HEARTBEAT_MS);
        }
        emit();
      }),
      fb.onValue(this.ref('players'), s => { st.players = sorted(s.val(), 'joined'); emit(); }),
      fb.onValue(this.ref('bots'), s => { st.bots = sorted(s.val(), 'added'); emit(); }),
      fb.onValue(fb.ref(fb.db, '.info/connected'), s => this.onConnection?.(s.val() === true)),
    );
  }

  // Host only: mark the room as alive so sweepers leave it alone.
  touch() {
    if (!this.isHost) return;
    this.lastTouch = Date.now();
    fb.update(fb.ref(fb.db), {
      [`rooms/${this.code}/meta/active`]: fb.serverTimestamp(),
      [`activity/${this.code}`]: fb.serverTimestamp(),
    }).catch(() => {});
  }

  addBot(name, level) { return fb.push(this.ref('bots'), { name, level, added: Date.now() }); }
  removeBot(id) { return fb.remove(this.ref(`bots/${id}`)); }

  async startGame(players, bots) {
    const seats = [...players.map(p => ({ id: p.id, name: p.name })), ...bots.map(b => ({ id: 'bot:' + b.id, name: b.name, ai: b.level }))];
    const state = newGame({ players: seats });
    // (views are cleared by backToLobby; nulling the parent here would conflict with the child writes)
    const upd = { secret: JSON.stringify(state), intents: null, errors: null, 'meta/status': 'playing' };
    state.players.forEach((p, i) => { if (!p.ai) upd[`views/${p.id}`] = JSON.stringify(viewFor(state, i)); });
    await fb.update(this.ref(), upd);
  }

  async backToLobby() {
    this.stopSession();
    await fb.update(this.ref(), { secret: null, views: null, intents: null, errors: null, 'meta/status': 'lobby' });
  }

  // Host: load the authoritative state and process everyone's intents.
  async startHosting(onView, onError) {
    this.stopSession();
    const raw = (await fb.get(this.ref('secret'))).val();
    if (!raw) throw new Error('Game state is missing.');
    const state = JSON.parse(raw);
    this.seat = state.players.findIndex(p => p.id === fb.uid);
    let lastStatus = null;
    this.host = new GameHost(state, {
      onChange: s => {
        const upd = { secret: JSON.stringify(s) };
        s.players.forEach((p, i) => { if (!p.ai) upd[`views/${p.id}`] = JSON.stringify(viewFor(s, i)); });
        const status = s.over ? 'ended' : 'playing';
        if (status !== lastStatus) { upd['meta/status'] = status; lastStatus = status; }
        fb.update(this.ref(), upd).catch(e => onError?.('Sync failed: ' + e.message));
        if (Date.now() - (this.lastTouch || 0) > 60000) this.touch();
        onView(viewFor(s, this.seat));
      },
    });
    this.session.push(fb.onChildAdded(this.ref('intents'), snap => {
      const { uid, a } = snap.val() || {};
      fb.remove(snap.ref);
      const seat = this.host.state.players.findIndex(p => p.id === uid);
      if (seat < 0) return;
      let action;
      try { action = JSON.parse(a); } catch { return; }
      const err = this.host.submit(seat, action);
      if (err) fb.set(this.ref(`errors/${uid}`), { msg: err, t: Date.now() });
    }));
    this.host.start();
  }

  // Non-host players: render our private view and report rejected actions.
  startClient(onView, onError) {
    this.stopSession();
    let firstError = true; // the first snapshot is whatever was left over from before
    this.session.push(
      fb.onValue(this.ref(`views/${fb.uid}`), s => {
        const raw = s.val();
        if (!raw) return;
        const v = JSON.parse(raw);
        this.seat = v.me;
        onView(v);
      }),
      fb.onValue(this.ref(`errors/${fb.uid}`), s => {
        const e = s.val();
        if (firstError) { firstError = false; return; }
        if (e) onError?.(e.msg);
      }),
    );
  }

  send(action) {
    if (this.host) return this.host.submit(this.seat, action);
    fb.push(this.ref('intents'), { uid: fb.uid, a: JSON.stringify(action), t: fb.serverTimestamp() });
    return null;
  }

  stopSession() {
    this.session.forEach(off => off());
    this.session = [];
    this.host?.stop();
    this.host = null;
  }

  async leave(status) {
    this.stopSession();
    this.unsubs.forEach(off => off());
    this.unsubs = [];
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    try {
      await this.disconnect?.cancel();
      // The host's browser runs the game, so the room goes with them.
      if (this.isHost) {
        await fb.update(fb.ref(fb.db), { [`rooms/${this.code}`]: null, [`activity/${this.code}`]: null })
          .catch(() => fb.update(this.ref('meta'), { status: 'closed' })); // rules without room deletion
      } else if (status === 'lobby') await fb.remove(this.ref(`players/${fb.uid}`));
      else await fb.update(this.ref(`players/${fb.uid}`), { online: false });
    } catch { /* leaving is best-effort */ }
  }
}
