import { deckId, setDeck } from './cards.js';
import { newGame, viewFor } from './engine.js';
import { GameHost } from './host.js';
import { TableUI, closeInfo, esc, ic, openInfo, rulesHTML, setSfx, showToast } from './ui.js';
import { OnlineRoom, onlineAvailable } from './online.js';
import { GameAudio } from './audio.js';
import { initSettingsUI, settings } from './settings.js';

export const VERSION = '1.0.0';

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem('grimwood.' + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem('grimwood.' + k) : localStorage.setItem('grimwood.' + k, v); } catch { /* storage unavailable */ } },
};
// How long a bot waits before each move (ms). Applies to offline games and to bots in rooms you host.
// Bots also wait for the table's animations to finish; FX_SPEED scales those animations.
const SPEEDS = { slow: 1400, normal: 700, fast: 300, turbo: 60 };
const FX_SPEED = { slow: 1.25, normal: 1, fast: 0.65, turbo: 0.35 };
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
      { label: 'Play again', icon: 'refresh', primary: true, fn: () => startLocal(local.config) },
      { label: 'Main menu', icon: 'home', fn: goHome },
    ];
    const out = [{ label: 'Main menu', icon: 'home', fn: goHome }];
    if (room?.isHost) out.unshift({ label: 'New game', icon: 'refresh', primary: true, fn: () => room.backToLobby() });
    return out;
  },
});

function show(screen) {
  for (const s of ['home', 'lobby', 'game']) $('screen-' + s).hidden = s !== screen;
  $('btn-leave').hidden = screen === 'home';
  $('btn-log').hidden = screen !== 'game';
}
const playerName = () => ($('in-name').value.trim() || 'Wanderer').slice(0, 16);

// ---------- home ----------
$('in-name').value = store.get('name') || '';
$('in-name').addEventListener('change', () => store.set('name', playerName()));
// The deck only changes how cards look, so each player picks their own.
function applyDeck(id) {
  const deck = setDeck(id);
  $('in-deck').value = deckId;
  document.documentElement.lang = deck.lang;
}
applyDeck(store.get('deck') || 'grimwood');
$('in-deck').addEventListener('change', () => { store.set('deck', $('in-deck').value); applyDeck($('in-deck').value); });
$('btn-rules').addEventListener('click', () => openInfo('How to play', rulesHTML()));

// ---------- settings, sound & music ----------
const audio = new GameAudio(settings);
setSfx(name => audio.sfx(name));
function botDelay() { return SPEEDS[settings.speed] ?? SPEEDS.normal; }
table.fxSpeed = FX_SPEED[settings.speed] ?? 1;
initSettingsUI(key => {
  if (key === 'speed') {
    table.fxSpeed = FX_SPEED[settings.speed] ?? 1;
    const host = mode === 'local' ? local?.host : room?.host;
    if (host) { host.aiDelay = botDelay(); host.scheduleAI(); }
  }
  if (key === 'music' || key === 'sfx' || key === 'muted') {
    audio.applyVolumes();
    if (audio.wantMusic && !audio.musicOn) audio.startMusic();
    if (!audio.wantMusic && audio.musicOn) audio.stopMusic();
  }
  if (key === 'sfx-preview') audio.sfx('draw');
});
$('app-version').textContent = `Version ${VERSION}`;
// ---------- resilience ----------
// Unexpected errors: keep playing, tell the player once, log the details.
let lastCrashToast = 0;
function reportError(err) {
  console.error(err);
  if (Date.now() - lastCrashToast < 10000) return;
  lastCrashToast = Date.now();
  showToast('Something went wrong. Your game is saved; reload if the table looks stuck.');
}
window.addEventListener('error', e => { if (e.error) reportError(e.error); });
window.addEventListener('unhandledrejection', e => reportError(e.reason));
// Installable / offline play.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Browsers only allow sound after a user gesture.
const unlockAudio = () => audio.unlock();
document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('keydown', unlockAudio, { capture: true });
// A soft click for buttons (game events have their own sounds).
document.addEventListener('click', e => {
  if (e.target.closest('.topbar .ibtn, .panel .btn, .panel .ibtn, dialog .btn, .seg button, .pop-actions .btn')) audio.sfx('click');
}, { capture: true });
// Pause music in background tabs and clear the "your turn" title when the player comes back.
document.addEventListener('visibilitychange', () => {
  audio.setPaused(document.hidden);
  if (!document.hidden) document.title = 'The Grimwood';
});
const params = new URLSearchParams(location.search);
if (params.get('room')) $('in-code').value = params.get('room').toUpperCase();

function refreshHome() {
  $('btn-resume').hidden = !store.get('local');
  const last = store.get('room');
  $('btn-rejoin').hidden = !last || !onlineAvailable();
  $('rejoin-label').textContent = `Rejoin room ${last}`;
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
$('btn-leave').addEventListener('click', () => {
  // The host's browser runs an online game: leaving ends it for everyone.
  if (mode === 'online' && room?.isHost && roomStatus === 'playing') {
    openInfo('Leave this game?', '<p class="muted">You are the host. The game runs in your browser, so leaving ends it for everyone.</p>', [
      { label: 'End game', icon: 'leave', primary: true, fn: goHome },
      { label: 'Stay', fn: () => {} },
    ]);
    return;
  }
  goHome();
});
$('btn-log').addEventListener('click', () => table.openLog());

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
    aiDelay: botDelay(),
    waitFor: () => table.idle(),
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
  let everConnected = false, lost = false;
  r.onConnection = ok => {
    if (r !== room) return;
    if (ok) {
      if (lost) showToast('Reconnected.', 'info');
      everConnected = true;
      lost = false;
    } else if (everConnected && !lost) {
      lost = true;
      showToast('Connection lost. Reconnecting…', 'info');
    }
  };
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
  const hostPlayer = st.players.find(p => p.id === meta.host);
  table.hostOffline = !r.isHost && meta.status === 'playing' && hostPlayer?.online === false;
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
      if (r.isHost) {
        await r.startHosting(v => table.render(v), onErr);
        if (r.host) { r.host.aiDelay = botDelay(); r.host.waitFor = () => table.idle(); r.host.scheduleAI(); }
      }
      else r.startClient(v => table.render(v), onErr);
    } catch (e) { showToast(e.message); }
  } else if (table.view) {
    table.render(table.view); // presence changed
  }
}

function renderLobby(r, st) {
  $('lobby-code').textContent = r.code;
  const link = `${location.origin}${location.pathname}?room=${r.code}`;
  $('btn-copy').onclick = () => navigator.clipboard?.writeText(link)
    .then(() => showToast('Invite link copied.', 'info'), () => showToast(link, 'info'));
  const host = st.meta.host;
  $('lobby-players').innerHTML = [
    ...st.players.map(p => `<li><span class="dot ${p.online === false ? 'off' : ''}"></span><span class="grow">${esc(p.name || 'Player')}${p.id === r.uid ? ' (you)' : ''}</span>${p.id === host ? '<span class="tag">host</span>' : ''}</li>`),
    ...st.bots.map(b => `<li><span class="dot"></span><span class="grow">${esc(b.name)}</span><span class="tag">AI · ${b.level}</span>
      ${r.isHost ? `<button class="ibtn" type="button" data-bot="${b.id}" aria-label="Remove ${esc(b.name)}" title="Remove ${esc(b.name)}">${ic('x')}</button>` : ''}</li>`),
  ].join('');
  const total = st.players.length + st.bots.length;
  $('lobby-host-controls').hidden = !r.isHost;
  $('lobby-wait').hidden = r.isHost;
  $('btn-addbot').disabled = total >= 6;
  $('btn-start').disabled = total < 2;
  $('start-label').textContent = total < 2 ? 'Need 2+' : `Start · ${total}`;
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
