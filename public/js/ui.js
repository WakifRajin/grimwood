// Renders a player's view of the table and turns clicks into engine actions.
//
// Interaction model:
//  - Click a card in your hand → a small menu opens on the card with what you can do with it.
//  - Ready combos appear as one-click buttons above your hand.
//  - Draw from the deck pile; steal with the button on an opponent's seat.
//  - When the game needs your decision, a dock appears at the bottom and the
//    valid targets (players, combos, cards) light up on the table.
import {
  BASICS, CARDS, HAND_LIMIT, MAX_SUPER_COMBO, SUPERNATURALS, SUPER_POINTS, comboPoints, hasPower, isSuper,
} from './cards.js';
import { readyTriples } from './engine.js';

const $ = id => document.getElementById(id);
export const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const TYPE_LABEL = { super: 'Supernatural', animal: 'Animal', setting: 'Setting', amulet: 'Amulet', rune: 'Rune' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const SEAT_HUES = [32, 200, 285, 140, 340, 60];
const icons = cards => cards.map(c => CARDS[c.k].icon).join('');
export const ic = name => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;
// Icon-only button; the label becomes the tooltip and accessible name.
const ib = (icon, label, attrs = '', cls = '') =>
  `<button type="button" class="ibtn ${cls}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${ic(icon)}</button>`;
const names = cards => cards.map(c => CARDS[c.k].name).join(', ');

// Only touch the DOM when the markup actually changed (keeps hover, focus and animations stable).
function put(el, html) {
  if (el._html === html) return false;
  el.innerHTML = html;
  el._html = html;
  return true;
}

export function cardHTML(c, { cls = '', tag = 'div', attrs = '' } = {}) {
  const d = CARDS[c.k];
  return `<${tag} class="card t-${d.type} ${cls}" title="${esc(d.name)}: ${esc(d.text)}" ${attrs}>`
    + `<span class="card-type">${TYPE_LABEL[d.type]}</span>`
    + `<span class="card-icon" aria-hidden="true">${d.icon}</span><span class="card-name">${esc(d.name)}</span></${tag}>`;
}

function tripleValue(cards) {
  if (cards[0].k === 'owl' || cards[0].k === 'crow') return 10;
  return new Set(cards.map(c => c.k)).size === 3 ? 5 : 3;
}

// Toasts live in the top layer (popover) so they also show above open dialogs.
export function showToast(msg, kind = 'error') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  const dock = $('decision');
  t.style.setProperty('--toast-bottom', dock.hidden ? '24px' : `${dock.offsetHeight + 28}px`);
  if (t.showPopover) { try { t.hidePopover(); } catch { /* not open */ } t.showPopover(); }
  t.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    t.classList.remove('show');
    try { t.hidePopover?.(); } catch { /* already closed */ }
  }, kind === 'error' ? 3200 : 3000);
}

// ---- generic info dialog (rules, discard pile, log, results) ----
const info = $('dlg-info');
if (!('closedBy' in HTMLDialogElement.prototype)) {
  info.addEventListener('click', e => {
    if (e.target !== info) return;
    const r = info.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) info.close();
  });
}
export function openInfo(title, html, choices) {
  $('info-title').textContent = title;
  const body = $('info-body');
  body.innerHTML = html;
  if (choices?.length) {
    const wrap = document.createElement('div');
    wrap.className = 'row';
    for (const ch of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (ch.primary ? 'primary' : '');
      b.innerHTML = (ch.icon ? ic(ch.icon) : '') + esc(ch.label);
      b.addEventListener('click', () => { info.close(); ch.fn(); });
      wrap.append(b);
    }
    body.append(wrap);
  }
  if (!info.open) info.showModal();
}
export function closeInfo() { if (info.open) info.close(); }

export function rulesHTML() {
  return `<div class="rules">
  <p>Collect the highest-scoring combos. Whoever has the most points on the table when the deck runs out wins.</p>
  <h3>A turn, step by step</h3>
  <ol>
    <li><b>Play a card (optional).</b> Click a Supernatural and choose <i>Use power</i>, or play a Rune for 2 bonus actions.</li>
    <li><b>Draw or steal.</b> Click the deck, or press <i>Steal</i> on a player with 2+ cards. Your turn then ends by itself.</li>
  </ol>
  <p>Any time on your turn you can lay down a ready combo (it appears as a button above your hand) or place a Supernatural for points without using its power.
  Hand limit is ${HAND_LIMIT}.</p>
  <p><b>Amulet:</b> when someone steals from you, you can block it. A blocked normal steal ends the thief's turn.</p>
  <h3>Scoring</h3>
  <dl>
    <dt>Supernaturals</dt><dd>1 / 2 / 5 / 10 / 15 pts for 1–5 in one combo. Bigger combos score more but are juicier targets.</dd>
    <dt>3 Owls or 3 Crows</dt><dd>10 pts</dd>
    <dt>Swamp + Path + Clearing</dt><dd>5 pts</dd>
    <dt>3 of one setting</dt><dd>3 pts</dd>
  </dl>
  <h3>End of the game</h3>
  <p>When the last card is drawn, every other player takes one final turn.</p>
  <h3>House rules</h3>
  <ul>
    <li>Each supernatural's power works at most once per turn (stops Elf ↔ Nymph loops).</li>
    <li>Sorceress: discard 2 Owls or 2 Crows from your hand to take another player's combo.</li>
    <li>Highwayman swaps one of your combos for one of theirs. Dragon-protected combos (🔒) are immune to all powers.</li>
  </ul>
  <h3>Supernaturals</h3>
  <dl>${SUPERNATURALS.map(s => `<dt>${s.icon} ${esc(s.name)}</dt><dd>${esc(s.text)}</dd>`).join('')}</dl>
  <h3>Deck</h3>
  <p>24 supernaturals, ${BASICS.map(b => `${b.count} ${b.name}s`).join(', ')}. With 2 players, 2 Runes and 2 Amulets are removed.</p>
  </div>`;
}

// Verb shown on a highlighted player or combo during a decision.
const PICK_VERB = {
  boogeyman: 'Swap hands', troll: 'Force discard', werewolf: 'Skip their turn', hydra: 'Look at hand',
  dracula: 'Steal 2 cards', goblins: 'Steal', sqsteal: 'Steal', ghouls: 'Steal', eternals: 'Steal',
  demon: 'Destroy', highwayman: 'Take', highwayman2: 'Give away', sorceress: 'Take',
};

// ---- the table ----
export class TableUI {
  constructor({ send, gameOverChoices }) {
    this.rawSend = send;
    this.gameOverChoices = gameOverChoices;
    this.view = null;
    this.presence = {};
    this.hostOffline = false;
    this.pop = null;          // { id, stage: 'menu'|'place', mode: 'play'|'place', focused }
    this.targets = null;
    this.lastLogN = null;
    this.prevHand = new Set();
    this.prevTurnPlayer = null;
    this.shownOver = false;
    this.overTimer = null;
    this.lastSend = 0;

    $('hand').addEventListener('click', e => {
      const el = e.target.closest('[data-id]');
      if (!el) return;
      e.stopPropagation();
      const id = el.dataset.id;
      if (this.targets?.hand.has(id)) return this.choose(this.targets.hand.get(id));
      if (performance.now() - this.lastSend < 350) return;
      this.pop = this.pop?.id === id ? null : { id, stage: 'menu' };
      this.renderPop();
      this.renderHandSelection();
    });
    $('card-pop').addEventListener('click', e => {
      e.stopPropagation();
      const b = e.target.closest('[data-pop]');
      if (b) this.popAction(b.dataset.pop, b.dataset.arg);
    });
    document.addEventListener('click', () => this.closePop());
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closePop(); });
    window.addEventListener('resize', () => this.closePop());

    // Table targets: players, combos, ready combos, turn-bar buttons.
    $('screen-game').addEventListener('click', e => {
      const t = e.target.closest('[data-steal],[data-pick],[data-combo],[data-ccard],[data-triple],[data-act]');
      if (!t) return;
      const d = t.dataset;
      if (d.pick !== undefined) return this.choose(Number(d.pick));
      if (d.ccard !== undefined && this.targets?.comboCards.has(d.ccard)) return this.choose(this.targets.comboCards.get(d.ccard));
      if (d.combo !== undefined && this.targets?.combos.has(d.combo)) return this.choose(this.targets.combos.get(d.combo));
      if (d.steal !== undefined) return this.send({ type: 'steal', target: Number(d.steal) });
      if (d.triple !== undefined) {
        const tri = readyTriples(this.view.hand)[Number(d.triple)];
        if (tri) this.send({ type: 'place_combo', cards: tri.map(c => c.id) });
        return;
      }
      if (d.act) this.doAct(d.act);
    });
    $('decision-options').addEventListener('click', e => {
      const b = e.target.closest('[data-opt]');
      if (b) this.choose(Number(b.dataset.opt));
    });
    $('pile-deck').addEventListener('click', e => {
      e.stopPropagation();
      if (this.targets?.deck !== undefined) return this.choose(this.targets.deck);
      if (this.canAct() && this.view.deckCount > 0 && this.view.turn.phase === 'main') this.send({ type: 'draw' });
    });
    $('pile-discard').addEventListener('click', e => {
      e.stopPropagation();
      const v = this.view;
      if (!v) return;
      openInfo(`Discard pile (${v.discard.length})`, v.discard.length
        ? `<p class="muted small">Newest first.</p><div class="card-grid">${[...v.discard].reverse().map(c => cardHTML(c, { cls: 'mini' })).join('')}</div>`
        : '<p class="muted">Empty.</p>');
    });
  }

  // All actions go through here: ignores accidental double-clicks that would
  // land on whatever just got re-rendered under the cursor.
  send(action) {
    const now = performance.now();
    if (now - this.lastSend < 350) return;
    this.lastSend = now;
    this.rawSend(action);
  }

  reset() {
    clearTimeout(this.overTimer);
    this.pop = null; this.targets = null; this.lastLogN = null; this.prevHand = new Set();
    this.prevTurnPlayer = null; this.shownOver = false; this.view = null; this.hostOffline = false;
    closeInfo();
    $('card-pop').hidden = true;
    $('decision').hidden = true;
    document.body.style.paddingBottom = '';
    for (const id of ['opponents', 'me-head', 'turnbar', 'me-combos', 'ready', 'hand', 'feed', 'log', 'decision-options', 'decision-reveal']) {
      $(id)._html = null;
      $(id).innerHTML = '';
    }
  }

  canAct() {
    const v = this.view;
    return !!v && !v.over && !v.pending && v.turn.player === v.me && v.me >= 0;
  }
  myPending() {
    const p = this.view?.pending;
    return p && p.player === this.view.me && !p.waiting ? p : null;
  }
  choose(i) {
    const p = this.myPending();
    if (!p || !p.options[i]) return;
    this.send({ type: 'choose', value: p.options[i].v });
  }

  doAct(act) {
    if (act === 'draw') this.send({ type: 'draw' });
    else if (act === 'pass') this.send({ type: 'pass' });
    else if (act === 'end') this.send({ type: 'end_turn' });
    else if (act === 'results') this.showGameOver();
  }

  // Map the pending decision's options onto things you can click on the table.
  computeTargets() {
    const p = this.myPending();
    if (!p) return null;
    const t = { players: new Map(), combos: new Map(), hand: new Map(), comboCards: new Map(), deck: undefined };
    p.options.forEach((o, i) => {
      const v = o.v;
      if (typeof v === 'number') t.players.set(v, i);
      else if (v && typeof v === 'object' && typeof v.steal === 'number') t.players.set(v.steal, i);
      else if (v && typeof v === 'object' && v.combo && v.card && v.owner !== undefined) t.comboCards.set(v.card, i);
      else if (v === 'draw') t.deck = i;
      else if (typeof v === 'string' && ['demon', 'highwayman', 'highwayman2', 'sorceress'].includes(p.task)) t.combos.set(v, i);
      else if (typeof v === 'string' && p.task === 'handLimit') t.hand.set(v, i);
    });
    return t;
  }

  render(v) {
    if (!v) return;
    const first = !this.view;
    this.view = v;
    this.targets = this.computeTargets();
    if (this.pop && !v.hand.some(c => c.id === this.pop.id)) this.pop = null;
    if (this.myPending()) this.pop = null;

    this.renderOpponents();
    this.renderCenter();
    this.renderMe();
    this.renderTurnbar();
    this.renderReady();
    this.renderHand();
    this.renderDecision();
    this.renderFeed();
    this.renderLog();
    this.renderPop();
    this.notify(first);
    if (v.over && !this.shownOver) {
      this.shownOver = true;
      clearTimeout(this.overTimer);
      this.overTimer = setTimeout(() => { if (this.view?.over) this.showGameOver(); }, 900);
    }
  }

  // ---- seats & combos ----
  chipHTML(combo, mine = false) {
    const ti = this.targets?.combos.get(combo.id);
    const target = ti !== undefined;
    const verb = target ? PICK_VERB[this.myPending().task] || 'Choose' : '';
    const pips = combo.cards.map(c => {
      const d = CARDS[c.k];
      if (this.targets?.comboCards.has(c.id)) {
        return `<button type="button" class="pip target" data-ccard="${c.id}" title="Take ${esc(d.name)}">${d.icon}${mine ? `<small>${esc(d.name)}</small>` : ''}</button>`;
      }
      return `<span class="pip" title="${esc(d.name)}">${d.icon}${mine ? `<small>${esc(d.name)}</small>` : ''}</span>`;
    }).join('');
    const tag = target ? 'button' : 'div';
    const label = `${names(combo.cards)}, ${comboPoints(combo)} points${combo.frozen ? ', protected by the Dragon' : ''}`;
    return `<${tag} ${target ? `type="button" data-combo="${combo.id}"` : ''} class="chip t-${combo.type} ${combo.frozen ? 'frozen' : ''} ${target ? 'target' : ''}"
      title="${esc(label)}" aria-label="${esc((target ? verb + ': ' : '') + label)}">
      <span class="pips">${pips}</span><span class="chip-pts">${comboPoints(combo)}${combo.frozen ? ' 🔒' : ''}</span>
      ${target ? `<span class="chip-cta">${esc(verb)}</span>` : ''}</${tag}>`;
  }

  seatHead(p, j, sub) {
    return `<span class="avatar" style="--hue:${SEAT_HUES[j % SEAT_HUES.length]}" aria-hidden="true">${esc(p.name.trim()[0] || '?').toUpperCase()}</span>
      <div class="seat-id"><span class="name">${esc(p.name)}</span><span class="seat-sub">${sub}</span></div>
      <span class="score-pill" title="Points on the table">${p.score}<small>pts</small></span>`;
  }

  renderOpponents() {
    const v = this.view;
    const me = v.me, n = v.players.length;
    const order = [];
    for (let i = 1; i <= n; i++) { const j = (Math.max(me, 0) + i) % n; if (j !== me) order.push(j); }
    const canSteal = this.canAct() && v.turn.phase === 'main';
    const pend = this.myPending();
    const html = order.map(j => {
      const p = v.players[j];
      const online = this.presence[p.id];
      const active = v.turn.player === j && !v.over;
      const deciding = v.pending && v.pending.player === j;
      const pick = this.targets?.players.get(j);
      const verb = pick !== undefined ? PICK_VERB[pend.task] || 'Choose' : '';
      let btn = '';
      if (pick !== undefined) btn = ib('target', `${verb}: ${p.name}`, `data-pick="${pick}"`, 'solid target');
      else if (canSteal && p.handCount >= 2) btn = ib('hand', `Steal a random card from ${p.name}`, `data-steal="${j}"`, 'solid');
      const status = pick !== undefined ? `<span class="target-txt">${esc(verb)}</span>` : [
        deciding ? '<span class="thinking">deciding</span>' : active ? '<span class="thinking">playing</span>' : '',
        p.skip ? '<span class="warn">🐺 skips next turn</span>' : '',
        online === false ? '<span class="muted">offline</span>' : '',
        v.over && v.winners.includes(j) ? '<span class="gold">👑 winner</span>' : '',
      ].filter(Boolean).join(' · ');
      const sub = `${online !== undefined ? `<span class="dot ${online ? '' : 'off'}"></span>` : ''}${p.ai ? '<span class="ai">AI</span>' : ''}<span class="handcount" title="Cards in hand"><i class="back-ico"></i>${p.handCount}</span>`;
      const finalHand = v.over && v.finalHands ? `<div class="final-hand" title="Cards left in hand">${icons(v.finalHands[j]) || '—'}</div>` : '';
      return `<article class="seat ${active ? 'active' : ''} ${pick !== undefined ? 'target' : ''}" style="--hue:${SEAT_HUES[j % SEAT_HUES.length]}" ${pick !== undefined ? `data-pick="${pick}"` : ''}>
        <div class="seat-top">${this.seatHead(p, j, sub)}<span class="seat-act">${btn}</span></div>
        <div class="seat-status">${status}</div>
        <div class="chips">${p.combos.map(c => this.chipHTML(c)).join('') || '<span class="muted small">No combos yet</span>'}</div>
        ${finalHand}
      </article>`;
    }).join('');
    put($('opponents'), html);
    $('opponents').dataset.count = order.length;
  }

  renderCenter() {
    const v = this.view;
    const drawable = (this.canAct() && v.turn.phase === 'main' && v.deckCount > 0) || this.targets?.deck !== undefined;
    const deck = $('pile-deck');
    deck.classList.toggle('glow', !!drawable);
    deck.disabled = !drawable;
    $('deck-cta').hidden = !drawable;
    $('deck-count').textContent = `Deck · ${v.deckCount}`;
    deck.querySelector('.card').classList.toggle('empty', v.deckCount === 0);
    const top = v.discard[v.discard.length - 1];
    put($('discard-top'), top ? cardHTML(top) : '<div class="card empty"></div>');
    $('discard-count').textContent = `Discard · ${v.discard.length}`;
    put($('limbo'), v.limbo.length ? `<div class="limbo-label">Laraki</div>${v.limbo.map(c => cardHTML(c, { cls: 'mini' })).join('')}` : '');
  }

  renderMe() {
    const v = this.view;
    if (v.me < 0) return;
    const p = v.players[v.me];
    $('me').classList.toggle('active', v.turn.player === v.me && !v.over);
    const sub = `You · <span class="handcount ${v.hand.length > HAND_LIMIT ? 'warn' : ''}" title="Cards in hand / hand limit"><i class="back-ico"></i>${v.hand.length}/${HAND_LIMIT}</span>`
      + `${p.skip ? ' · <span class="warn">🐺 you skip your next turn</span>' : ''}`;
    put($('me-head'), this.seatHead(p, v.me, sub));
    put($('me-combos'), p.combos.map(c => this.chipHTML(c, true)).join('')
      || '<span class="muted small">No combos yet. Only combos on the table score.</span>');
  }

  // One fixed-height line: progress pips, what to do now, and the action for it.
  renderTurnbar() {
    const v = this.view;
    const pip = (n, st) => `<span class="tb-pip ${st}">${st === 'done' ? ic('check') : n}</span>`;
    let pips = '', title = '', sub = '', acts = '', mood = 'idle';
    if (v.over) {
      title = 'Game over';
      sub = `${v.winners.map(i => esc(v.players[i].name)).join(' & ')} win${v.winners.length > 1 ? '' : 's'}`;
      acts = ib('trophy', 'See results', 'data-act="results"', 'primary');
      mood = 'now';
    } else if (this.hostOffline) {
      title = 'Paused';
      sub = 'The host is offline. The game continues when they rejoin.';
    } else if (v.turn.player !== v.me) {
      title = `<span class="thinking">${esc(v.players[v.turn.player].name)} is playing</span>`;
      sub = v.pending && v.pending.player !== v.me && v.pending.player !== v.turn.player
        ? `Waiting for ${esc(v.players[v.pending.player].name)} to decide` : 'Their moves appear in the feed above';
    } else if (this.myPending()) {
      title = 'Your decision';
      sub = 'Choose in the panel below';
      mood = 'now';
    } else if (v.pending) {
      title = `<span class="thinking">Waiting for ${esc(v.players[v.pending.player].name)}</span>`;
      sub = 'They are deciding';
    } else if (v.turn.phase === 'wrap') {
      pips = pip(1, 'done') + pip(2, 'done');
      title = 'Lay down your combo';
      sub = 'Then end your turn';
      acts = ib('check', 'End turn', 'data-act="end"', 'primary');
      mood = 'now';
    } else {
      const t = v.turn;
      const hasPlayable = v.hand.some(c => hasPower(c.k) || c.k === 'rune');
      const step1Done = t.play === 0 || !hasPlayable;
      const canDraw = v.deckCount > 0;
      const canSteal = v.players.some((p, i) => i !== v.me && p.handCount >= 2);
      pips = pip(1, step1Done ? 'done' : 'now') + pip(2, step1Done ? 'now' : '');
      mood = 'now';
      if (t.extra > 0) {
        title = `★ ${plural(t.extra, 'bonus action')}`;
        sub = 'Draw, steal or play another power';
      } else if (!step1Done) {
        title = 'Play a card, then draw or steal';
        sub = 'Pick a glowing card. Playing one is optional.';
      } else {
        title = 'Draw or steal to end your turn';
        sub = canSteal ? 'Use the deck, or the hand icon on a player' : 'Use the deck';
      }
      if (canDraw) acts = ib('draw', t.extra > 0 ? 'Draw (bonus action)' : 'Draw a card', 'data-act="draw"', 'primary');
      else if (!canSteal) acts = ib('skip', 'Pass', 'data-act="pass"', 'primary');
    }
    put($('turnbar'), `<div class="tb-pips">${pips}</div>
      <div class="tb-text"><b>${title}</b><span>${sub}</span></div><div class="tb-acts">${acts}</div>`);
    $('turnbar').dataset.mood = mood;
  }

  renderReady() {
    const v = this.view;
    if (v.me < 0) { put($('ready'), ''); return; }
    const hand = v.hand;
    const count = k => hand.filter(c => c.k === k).length;
    const myMove = this.canAct() && ['main', 'wrap'].includes(v.turn.phase);
    const triples = myMove ? readyTriples(hand) : [];
    const chips = triples.map((tri, i) =>
      `<button type="button" class="btn ready-btn" data-triple="${i}" title="Lay down this combo" aria-label="Lay down ${esc(names(tri))} for ${tripleValue(tri)} points">${ic('place')}${icons(tri)}<b>+${tripleValue(tri)}</b></button>`).join('');
    const prog = k => `<span class="prog ${count(k) >= 3 ? 'full' : ''}" title="3 ${CARDS[k].name}s = 10 pts">${CARDS[k].icon} ${count(k)}/3</span>`;
    const setting = ['swamp', 'path', 'clearing'].map(k => `<span class="${count(k) ? '' : 'dim'}" title="${CARDS[k].name}">${CARDS[k].icon}${count(k)}</span>`).join(' ');
    put($('ready'), `<div class="ready-actions">${chips}</div><span class="tracker" aria-label="Combo progress">${prog('owl')}${prog('crow')}
      <span class="prog" title="Swamp + Path + Clearing = 5 pts, or 3 of one = 3 pts">${setting}</span></span>`);
  }

  renderHand() {
    const v = this.view;
    if (v.me < 0) return;
    const tokens = v.turn.play + v.turn.extra;
    const playable = c => this.canAct() && v.turn.phase === 'main' && tokens > 0 && (hasPower(c.k) || c.k === 'rune');
    const discarding = this.targets?.hand.size > 0;
    const html = v.hand.map(c => {
      const cls = [
        this.prevHand.size && !this.prevHand.has(c.id) ? 'fresh' : '',
        playable(c) ? 'playable' : '',
        discarding ? 'target' : '',
        this.pop?.id === c.id ? 'selected' : '',
      ].filter(Boolean).join(' ');
      return cardHTML(c, { tag: 'button', cls, attrs: `type="button" data-id="${c.id}" aria-haspopup="dialog"` });
    }).join('') || '<p class="muted hand-empty">Your hand is empty.</p>';
    put($('hand'), html);
    this.prevHand = new Set(v.hand.map(c => c.id));
  }

  renderHandSelection() {
    for (const el of $('hand').querySelectorAll('[data-id]')) el.classList.toggle('selected', this.pop?.id === el.dataset.id);
  }

  // ---- card menu ----
  closePop() {
    if (!this.pop) return;
    this.pop = null;
    $('card-pop').hidden = true;
    this.renderHandSelection();
  }

  eligibleCombos() {
    const v = this.view;
    return v.players[v.me].combos.filter(c => c.type === 'super' && !c.frozen && c.cards.length < MAX_SUPER_COMBO);
  }

  renderPop() {
    const pop = $('card-pop');
    const v = this.view;
    const card = this.pop && v.hand.find(c => c.id === this.pop.id);
    if (!card) { pop.hidden = true; return; }
    const d = CARDS[card.k];
    const myTurn = this.canAct() && ['main', 'wrap'].includes(v.turn.phase);
    const main = myTurn && v.turn.phase === 'main';
    const tokens = v.turn.play + v.turn.extra;
    let body = '';
    if (this.pop.stage === 'place') {
      const spots = this.eligibleCombos();
      body = `<p class="pop-q">${this.pop.mode === 'play' ? 'Use its power and put it' : 'Put it'} where?</p><div class="pop-actions">
        <button type="button" class="btn" data-pop="to" data-arg="new">${ic('plus')}<span>New combo</span><b>+1</b></button>
        ${spots.map(c => `<button type="button" class="btn" data-pop="to" data-arg="${c.id}">${ic('place')}<span>${icons(c.cards)}</span><b>+${SUPER_POINTS[c.cards.length + 1] - SUPER_POINTS[c.cards.length]}</b></button>`).join('')}
        <button type="button" class="btn ghost sm" data-pop="back">${ic('back')}<span>Back</span></button></div>`;
    } else {
      const acts = [];
      if (main && hasPower(card.k) && tokens > 0) acts.push(`<button type="button" class="btn primary" data-pop="power">${ic('spark')}<span>Use power</span></button>`);
      if (myTurn && isSuper(card.k)) acts.push(`<button type="button" class="btn" data-pop="place">${ic('place')}<span>${card.k === 'dragon' ? 'Protect a combo' : 'Place for points'}</span></button>`);
      if (main && card.k === 'rune' && tokens > 0) acts.push(`<button type="button" class="btn primary" data-pop="rune">${ic('rune')}<span>Play: +2 actions</span></button>`);
      let note = '';
      const have = v.hand.filter(c => c.k === card.k).length;
      if (d.type === 'animal') note = `You have ${have} of 3 ${d.name}s. With 3, a button to lay them down appears above your hand.`;
      else if (d.type === 'setting') note = 'Ready setting combos appear as a button above your hand.';
      else if (d.type === 'amulet') note = 'Keep it in hand. When someone steals from you, you can block it.';
      else if (main && hasPower(card.k) && tokens === 0) note = 'You already played a card this turn. You can still place it for points.';
      else if (main && card.k === 'rune' && tokens === 0) note = 'You already played a card this turn.';
      else if (!myTurn && (isSuper(card.k) || card.k === 'rune')) note = 'You can play this on your turn.';
      body = `${note ? `<p class="pop-note">${esc(note)}</p>` : ''}${acts.length ? `<div class="pop-actions">${acts.join('')}</div>` : ''}`;
    }
    pop.innerHTML = `<div class="pop-head"><span class="pop-icon t-${d.type}" aria-hidden="true">${d.icon}</span><div><h3 id="pop-title">${esc(d.name)}</h3>
      <span class="muted small">${TYPE_LABEL[d.type]}</span></div></div><p class="pop-text">${esc(d.text)}</p>${body}`;
    pop.hidden = false;
    // Position above the card (or below if there is no room).
    const el = $('hand').querySelector(`[data-id="${card.id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    let top = r.top - h - 10;
    if (top < 8) top = Math.max(8, Math.min(r.bottom + 10, innerHeight - h - 8));
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    const focusKey = card.id + this.pop.stage;
    if (this.pop.focused !== focusKey) {
      this.pop.focused = focusKey;
      pop.querySelector('.pop-actions button')?.focus({ preventScroll: true });
    }
  }

  popAction(act, arg) {
    const card = this.view.hand.find(c => c.id === this.pop?.id);
    if (!card) return this.closePop();
    const go = combo => {
      const type = this.pop.mode === 'play' ? 'play_super' : 'place_super';
      this.closePop();
      this.send({ type, card: card.id, combo });
    };
    if (act === 'power' || act === 'place') {
      this.pop.mode = act === 'power' ? 'play' : 'place';
      if (!this.eligibleCombos().length) return go('new');
      this.pop.stage = 'place';
      return this.renderPop();
    }
    if (act === 'to') return go(arg);
    if (act === 'back') { this.pop.stage = 'menu'; return this.renderPop(); }
    if (act === 'rune') { this.closePop(); this.send({ type: 'play_rune', card: card.id }); }
  }

  // ---- decisions ----
  renderDecision() {
    const p = this.myPending();
    const dock = $('decision');
    if (!p) {
      dock.hidden = true;
      document.body.style.paddingBottom = '';
      return;
    }
    const t = this.targets;
    let help = '';
    if (t.hand.size) help = 'Click a card in your hand, or pick one below.';
    else if (t.players.size) help = 'Click a highlighted player, or pick below.';
    else if (t.combos.size) help = 'Click a highlighted combo on the table, or pick below.';
    else if (t.comboCards.size) help = 'Click a highlighted card on the table, or pick below.';
    $('decision-title').textContent = p.title;
    $('decision-help').textContent = help;
    put($('decision-reveal'), (p.reveal || []).map(h => `<div class="reveal"><h3>${esc(h.name)}</h3>
      <div class="card-grid">${h.cards.map(c => cardHTML(c, { cls: 'mini' })).join('') || '<span class="muted">Empty hand</span>'}</div></div>`).join(''));
    put($('decision-options'), p.options.map((o, i) =>
      `<button type="button" class="btn opt ${o.card ? 'with-card' : ''} ${o.v === 'block' || o.v === 'ok' ? 'primary' : ''}" data-opt="${i}">
        ${o.card ? cardHTML(o.card, { cls: 'mini' }) : ''}<span>${esc(o.label)}</span></button>`).join(''));
    const wasHidden = dock.hidden;
    dock.hidden = false;
    document.body.style.paddingBottom = `${dock.offsetHeight + 24}px`;
    if (wasHidden) dock.querySelector('[data-opt]')?.focus({ preventScroll: true });
  }

  // ---- what just happened ----
  renderFeed() {
    const v = this.view;
    const log = v.log;
    const isMark = e => e.msg.startsWith('—');
    const marks = log.map((e, i) => (isMark(e) ? i : -1)).filter(i => i >= 0);
    const start = marks.length ? marks[marks.length - 1] : -1;
    let header = start >= 0 ? log[start].msg.replace(/—/g, '').trim() : '';
    let items = log.slice(start + 1);
    if (!items.length && v.me >= 0) {
      // Nothing yet this turn: recap everything since the end of my previous turn.
      const myMark = `— ${v.players[v.me].name}'s turn —`;
      const mine = marks.filter(i => i < start && log[i].msg === myMark);
      const from = mine.length ? marks[marks.indexOf(mine[mine.length - 1]) + 1] : 0;
      items = log.slice(from, start);
      header = mine.length ? 'Since your last turn' : 'So far';
    }
    // Keep the latest 9 events, plus the turn headers they belong to.
    const keep = new Set();
    let n = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      if (isMark(items[i])) { if (n) keep.add(i); continue; }
      if (n < 9) { keep.add(i); n++; }
    }
    const shown = items.filter((_, i) => keep.has(i));
    const lastIdx = shown.length - 1;
    const changed = put($('feed'), `<div class="feed-head">${esc(header)}</div>` + (n
      ? `<ul>${shown.map((e, i) => isMark(e)
        ? `<li class="who">${esc(e.msg.replace(/—/g, '').replace(/['’]s turn/, '').trim())}</li>`
        : `<li class="${i === lastIdx ? 'latest' : ''} ${e.to ? 'private' : ''}">${esc(e.msg)}</li>`).join('')}</ul>`
      : '<p class="muted small">Nothing has happened yet this turn.</p>'));
    const ul = $('feed').querySelector('ul');
    if (changed && ul) ul.scrollTop = ul.scrollHeight;
  }

  // Pop up things that happen *to* you, and your turn starting.
  notify(first) {
    const v = this.view;
    const me = v.me;
    const newest = v.log.length ? v.log[v.log.length - 1].n : 0;
    let msg = null;
    if (!first && this.lastLogN !== null && me >= 0) {
      const myName = v.players[me].name;
      const nameRe = new RegExp(`(^|[^\\w])${myName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`);
      // Private notes ("The stolen card was Owl") matter only on someone else's turn;
      // public lines matter when they name me but I'm not the one acting.
      let myTurn = this.prevTurnPlayer === me;
      for (const e of v.log.filter(x => x.n > this.lastLogN)) {
        if (e.msg.startsWith('—')) { myTurn = e.msg === `— ${myName}'s turn —`; continue; }
        const aboutMe = e.to
          ? !myTurn
          : !e.msg.startsWith(myName + ' ') && !e.msg.includes(`activates for ${myName}`) && nameRe.test(e.msg);
        if (aboutMe) msg = e.msg;
      }
    }
    const myTurnStarts = !first && this.prevTurnPlayer !== null && this.prevTurnPlayer !== v.turn.player && v.turn.player === me && !v.over;
    if (myTurnStarts) showToast(msg ? `Your turn! (${msg})` : 'Your turn!', 'turn');
    else if (msg) showToast(msg, 'info');
    this.prevTurnPlayer = v.turn.player;
    this.lastLogN = newest;
  }

  logHTML() {
    return (this.view?.log || []).map(e =>
      `<li class="${e.to ? 'private' : ''} ${e.msg.startsWith('—') ? 'turn' : ''}">${esc(e.msg)}</li>`).join('');
  }

  renderLog() {
    const ol = $('log');
    const atBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 40;
    if (put(ol, this.logHTML()) && atBottom) ol.scrollTop = ol.scrollHeight;
  }

  openLog() {
    openInfo('Chronicle', `<ol class="log in-dialog">${this.logHTML()}</ol>`);
    const ol = document.querySelector('#info-body .log');
    if (ol) ol.scrollTop = ol.scrollHeight;
  }

  showGameOver() {
    const v = this.view;
    if (!v?.over) return;
    const rows = v.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score);
    const html = `<table class="final-table"><thead><tr><th>Player</th><th>Combos</th><th class="num">Points</th></tr></thead><tbody>
      ${rows.map(({ p, i }) => `<tr class="${v.winners.includes(i) ? 'win' : ''}"><td>${v.winners.includes(i) ? '👑 ' : ''}${esc(p.name)}${i === v.me ? ' (you)' : ''}</td>
      <td>${p.combos.map(c => icons(c.cards)).join(' · ') || '–'}</td><td class="num">${p.score}</td></tr>`).join('')}</tbody></table>`;
    openInfo(v.winners.includes(v.me) ? 'Victory in the Grimwood' : 'The Grimwood falls silent', html, this.gameOverChoices?.() || []);
  }
}
