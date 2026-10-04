import { newGame, viewFor } from './engine.js';
import { GameHost } from './host.js';
import { TableUI, closeInfo, esc, openInfo, rulesHTML, showToast } from './ui.js';
import { OnlineRoom, onlineAvailable } from './online.js';

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem('grimwood.' + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem('grimwood.' + k) : localStorage.setItem('grimwood.' + k, v); } catch { /* storage unavailable */ } },
};
const BOT_NAMES = ['Morgana', 'Grimble', 'Hollow Jack', 'Vesper', 'Old Thorn', 'Nettle', 'Corvina', 'Brackwater'];

let mode = null;       // 'local' | 'online'
let local = null;      // { host, config }
let room = null;       // OnlineRoom
let roomStatus = null;
let lobbyState = null;

const table = new TableUI({
  send: action => {
    const err = mode === 'local' ? local?.host.submit(0, action) : room?.send(action);
    if (err) showToast(err);
  },
  gameOverChoices: () => {
    if (mode === 'local') return [
      { label: 'Play again', primary: true, fn: () => startLocal(local.config) },
      { label: 'Main menu', fn: goHome },
    ];
    const out = [{ label: 'Main menu', fn: goHome }];
    if (room?.isHost) out.unshift({ label: 'New game (back to lobby)', primary: true, fn: () => room.backToLobby() });
    return out;
  },
});

function show(screen) {
  for (const s of ['home', 'lobby', 'game']) $('screen-' + s).hidden = s !== screen;
  $('btn-leave').hidden = screen === 'home';
}
const playerName = () => ($('in-name').value.trim() || 'Wanderer').slice(0, 16);

// ---------- home ----------
$('in-name').value = store.get('name') || '';
$('in-name').addEventListener('change', () => store.set('name', playerName()));
$('btn-rules').addEventListener('click', () => openInfo('How to play', rulesHTML()));
const params = new URLSearchParams(location.search);
if (params.get('room')) $('in-code').value = params.get('room').toUpperCase();

function refreshHome() {
  $('btn-resume').hidden = !store.get('local');
  const last = store.get('room');
  $('btn-rejoin').hidden = !last || !onlineAvailable();
  $('btn-rejoin').textContent = `Rejoin room ${last}`;
  if (!onlineAvailable()) {
    $('online-status').textContent = 'Online play needs a Firebase config. See README.md.';
    $('btn-create').disabled = $('btn-join').disabled = true;
  }
}

function goHome() {
  if (mode === 'local') local?.host.stop();
  if (mode === 'online' && room) { room.leave(roomStatus); store.set('room', null); }
  mode = null; local = null; room = null; roomStatus = null;
  table.reset();
  $('topbar-info').textContent = '';
  history.replaceState(null, '', location.pathname);
  refreshHome();
  show('home');
}
$('btn-leave').addEventListener('click', goHome);

// ---------- offline vs AI ----------
function startLocal(config, saved) {
  local?.host.stop();
  table.reset();
  mode = 'local';
  let state = saved;
  if (!state) {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const players = [{ id: 'you', name: config.name }];
    for (let i = 0; i < config.bots; i++) players.push({ id: 'bot' + i, name: names[i], ai: config.level });
    state = newGame({ players });
  }
  const host = new GameHost(state, {
    aiDelay: params.has('fast') ? 40 : undefined, // ?fast speeds up bots for testing
    onChange: s => {
      store.set('local', s.over ? null : JSON.stringify({ config, state: s }));
      table.render(viewFor(s, 0));
    },
  });
  local = { host, config };
  $('topbar-info').textContent = `Offline · ${config.bots} AI opponent${config.bots > 1 ? 's' : ''} (${config.level})`;
  show('game');
  host.start();
}

$('btn-local').addEventListener('click', () => {
  store.set('name', playerName());
  startLocal({ name: playerName(), bots: Number($('in-bots').value), level: $('in-level').value });
});
$('btn-resume').addEventListener('click', () => {
  try {
    const { config, state } = JSON.parse(store.get('local'));
    startLocal(config, state);
  } catch {
    store.set('local', null);
    showToast('That saved game could not be loaded.');
    refreshHome();
  }
});

// ---------- online ----------
async function withBusy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { console.error(e); showToast(e.message || String(e)); } finally { btn.disabled = false; }
}
$('btn-create').addEventListener('click', e => withBusy(e.currentTarget, async () => {
  store.set('name', playerName());
  enterRoom(await OnlineRoom.create(playerName()));
}));
$('btn-join').addEventListener('click', e => withBusy(e.currentTarget, async () => {
  const code = $('in-code').value.trim();
  if (code.length !== 5) throw new Error('Enter the 5-letter room code.');
  store.set('name', playerName());
  enterRoom(await OnlineRoom.join(code, playerName()));
}));
$('in-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
$('btn-rejoin').addEventListener('click', e => withBusy(e.currentTarget, async () => {
  enterRoom(await OnlineRoom.join(store.get('room'), playerName()));
}));

function enterRoom(r) {
  if (mode === 'local') local?.host.stop();
  mode = 'online';
  room = r;
  roomStatus = null;
  store.set('room', r.code);
  history.replaceState(null, '', `?room=${r.code}`);
  $('topbar-info').textContent = `Online · room ${r.code}`;
  r.watch(st => onRoomUpdate(r, st));
}

async function onRoomUpdate(r, st) {
  if (r !== room) return;
  lobbyState = st;
  const { meta } = st;
  if (!meta || meta.status === 'closed') {
    showToast('The host closed this room.');
    store.set('room', null);
    return goHome();
  }
  table.presence = Object.fromEntries(st.players.map(p => [p.id, p.online !== false]));
  const prev = roomStatus;
  roomStatus = meta.status;

  if (meta.status === 'lobby') {
    if (prev && prev !== 'lobby') { r.stopSession(); table.reset(); }
    renderLobby(r, st);
    show('lobby');
    return;
  }
  // playing / ended
  if (!prev || prev === 'lobby') {
    if (!st.players.some(p => p.id === r.uid)) { showToast('You are not part of this game.'); return goHome(); }
    table.reset();
    show('game');
    const onErr = msg => showToast(msg);
    try {
      if (r.isHost) await r.startHosting(v => table.render(v), onErr);
      else r.startClient(v => table.render(v), onErr);
    } catch (e) { showToast(e.message); }
  } else if (table.view) {
    table.render(table.view); // presence changed
  }
}

function renderLobby(r, st) {
  $('lobby-code').textContent = r.code;
  const link = `${location.origin}${location.pathname}?room=${r.code}`;
  $('btn-copy').textContent = link;
  $('btn-copy').onclick = () => navigator.clipboard?.writeText(link).then(() => showToast('Link copied.'), () => {});
  const host = st.meta.host;
  $('lobby-players').innerHTML = [
    ...st.players.map(p => `<li><span class="dot ${p.online === false ? 'off' : ''}"></span><span class="grow">${esc(p.name)}${p.id === r.uid ? ' (you)' : ''}</span>${p.id === host ? '<span class="tag">host</span>' : ''}</li>`),
    ...st.bots.map(b => `<li><span class="dot"></span><span class="grow">${esc(b.name)}</span><span class="tag">AI · ${b.level}</span>
      ${r.isHost ? `<button class="btn ghost" type="button" data-bot="${b.id}" aria-label="Remove ${esc(b.name)}">✕</button>` : ''}</li>`),
  ].join('');
  const total = st.players.length + st.bots.length;
  $('lobby-host-controls').hidden = !r.isHost;
  $('lobby-wait').hidden = r.isHost;
  $('btn-addbot').disabled = total >= 6;
  $('btn-start').disabled = total < 2;
  $('btn-start').textContent = total < 2 ? 'Need 2+ players' : `Start game (${total} players)`;
}
$('lobby-players').addEventListener('click', e => {
  const b = e.target.closest('[data-bot]');
  if (b && room?.isHost) room.removeBot(b.dataset.bot);
});
$('btn-addbot').addEventListener('click', () => {
  if (!room || !lobbyState) return;
  const used = new Set(lobbyState.bots.map(b => b.name));
  const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot';
  room.addBot(name, $('in-botlevel').value);
});
$('btn-start').addEventListener('click', e => withBusy(e.currentTarget, async () => {
  if (!room || !lobbyState) return;
  closeInfo();
  await room.startGame(lobbyState.players, lobbyState.bots);
}));

refreshHome();
show('home');
