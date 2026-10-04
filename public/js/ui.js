// Renders a player's view of the table and turns clicks into engine actions.
//
// Interaction model:
//  - Click a card in your hand → a small menu opens on the card with what you can do with it.
//  - Ready combos appear as one-click buttons above your hand.
//  - Draw from the deck pile; steal with the button on an opponent.
//  - When the game needs your decision, a dock appears at the bottom and the
//    valid targets (players, combos, cards) light up on the table.
import {
  BASICS, CARDS, HAND_LIMIT, MAX_SUPER_COMBO, SUPERNATURALS, SUPER_POINTS, comboPoints, hasPower, isSuper,
} from './cards.js';
import { readyTriples } from './engine.js';

const $ = id => document.getElementById(id);
export const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const TYPE_LABEL = { super: 'Super', animal: 'Animal', setting: 'Setting', amulet: 'Amulet', rune: 'Rune' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function cardHTML(c, { cls = '', tag = 'div', attrs = '' } = {}) {
  const d = CARDS[c.k];
  return `<${tag} class="card t-${d.type} ${cls}" title="${esc(d.name)}: ${esc(d.text)}" ${attrs}>`
    + `<span class="card-type">${TYPE_LABEL[d.type]}</span>`
    + `<div class="card-icon" aria-hidden="true">${d.icon}</div><div class="card-name">${esc(d.name)}</div></${tag}>`;
}
const backHTML = (cls = '') => `<div class="card back ${cls}"><div class="card-icon" aria-hidden="true">🌲</div></div>`;
const icons = cards => cards.map(c => CARDS[c.k].icon).join('');
const names = cards => cards.map(c => CARDS[c.k].name).join(', ');

function tripleValue(cards) {
  if (cards[0].k === 'owl' || cards[0].k === 'crow') return 10;
  return new Set(cards.map(c => c.k)).size === 3 ? 5 : 3;
}

export function showToast(msg, kind = 'error') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show ${kind}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => t.classList.remove('show'), kind === 'error' ? 3200 : 2600);
}

// ---- generic info dialog (rules, discard pile, results) ----
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
      b.textContent = ch.label;
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
    <li><b>Draw or steal.</b> Click the deck, or press <i>Steal a card</i> on a player with 2+ cards. Your turn then ends by itself.</li>
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
    <li>Highwayman swaps one of your combos for one of theirs. Dragon-protected combos are immune to all powers.</li>
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
  dracula: 'Steal 2 cards', goblins: 'Steal a card', sqsteal: 'Steal a card', ghouls: 'Steal a card', eternals: 'Steal a card',
  demon: 'Destroy', highwayman: 'Take this', highwayman2: 'Give this', sorceress: 'Take this',
};

// ---- the table ----
export class TableUI {
  constructor({ send, gameOverChoices }) {
    this.send = send;
    this.gameOverChoices = gameOverChoices;
    this.view = null;
    this.presence = {};
    this.pop = null;          // { id, stage: 'menu'|'place', mode: 'play'|'place' }
    this.targets = null;
    this.lastLogN = null;
    this.prevHand = new Set();
    this.prevTurnPlayer = null;
    this.shownOver = false;

    $('hand').addEventListener('click', e => {
      const el = e.target.closest('[data-id]');
      if (!el) return;
      e.stopPropagation();
      const id = el.dataset.id;
      if (this.targets?.hand.has(id)) return this.choose(this.targets.hand.get(id));
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

    // Table targets: players, combos, ready combos, stepper buttons.
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
        ? `<div class="card-grid">${[...v.discard].reverse().map(c => cardHTML(c, { cls: 'mini' })).join('')}</div>`
        : '<p class="muted">Empty.</p>');
    });
  }

  reset() {
    this.pop = null; this.targets = null; this.lastLogN = null; this.prevHand = new Set();
    this.prevTurnPlayer = null; this.shownOver = false; this.view = null;
    closeInfo();
    $('card-pop').hidden = true;
    $('decision').hidden = true;
    document.body.classList.remove('docked');
  }

  canAct() {
    const v = this.view;
    return v && !v.over && !v.pending && v.turn.player === v.me && v.me >= 0;
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
    this.renderStepper();
    this.renderReady();
    this.renderHand();
    this.renderDecision();
    this.renderFeed();
    this.renderLog();
    this.renderPop();
    this.notify(first);
    if (v.over && !this.shownOver) { this.shownOver = true; setTimeout(() => this.showGameOver(), 900); }
  }

  comboChip(combo) {
    const i = this.targets?.combos.get(combo.id);
    const target = i !== undefined;
    const pickVerb = target ? PICK_VERB[this.myPending().task] || 'Choose' : '';
    const cards = combo.cards.map(c => (this.targets?.comboCards.has(c.id)
      ? cardHTML(c, { cls: 'mini target', tag: 'button', attrs: `type="button" data-ccard="${c.id}"` })
      : cardHTML(c, { cls: 'mini' }))).join('');
    return `<div class="combo ${combo.frozen ? 'frozen' : ''} ${target ? 'target' : ''}" ${target ? `data-combo="${combo.id}" role="button" tabindex="0"` : ''}
      title="${esc(names(combo.cards))}${combo.frozen ? ' (protected by the Dragon)' : ''}">${cards}
      <span class="pts">${comboPoints(combo)}${combo.frozen ? ' 🔒' : ''}</span>
      ${target ? `<span class="combo-cta">${esc(pickVerb)}</span>` : ''}</div>`;
  }

  renderOpponents() {
    const v = this.view;
    const me = v.me, n = v.players.length;
    const order = [];
    for (let i = 1; i <= n; i++) { const j = (Math.max(me, 0) + i) % n; if (j !== me) order.push(j); }
    const canSteal = this.canAct() && v.turn.phase === 'main';
    const pend = this.myPending();
    $('opponents').innerHTML = order.map(j => {
      const p = v.players[j];
      const online = this.presence[p.id];
      const active = v.turn.player === j && !v.over;
      const deciding = v.pending && v.pending.player === j;
      const pick = this.targets?.players.get(j);
      let btn = '';
      if (pick !== undefined) btn = `<button type="button" class="btn primary sm" data-pick="${pick}">${esc(PICK_VERB[pend.task] || 'Choose')}</button>`;
      else if (canSteal && p.handCount >= 2) btn = `<button type="button" class="btn sm" data-steal="${j}" title="Take a random card from ${esc(p.name)}. Ends your turn unless you have bonus actions.">Steal a card</button>`;
      const hand = v.over && v.finalHands ? v.finalHands[j] : null;
      return `<article class="opp ${active ? 'active' : ''} ${pick !== undefined ? 'target' : ''}" data-player="${j}">
        <div class="opp-head">
          ${online !== undefined ? `<span class="dot ${online ? '' : 'off'}" title="${online ? 'online' : 'offline'}"></span>` : ''}
          <span class="name">${esc(p.name)}</span>
          ${p.ai ? '<span class="tag">AI</span>' : ''}
          ${p.skip ? '<span class="tag warn">🐺 skips next turn</span>' : ''}
          ${v.over && v.winners.includes(j) ? '<span class="tag gold">👑 winner</span>' : ''}
          <span class="score">${p.score}<small> pts</small></span>
        </div>
        ${active || deciding ? `<div class="opp-status"><span class="thinking">${deciding ? 'deciding' : 'playing'}</span></div>` : ''}
        <div class="backs">${hand ? hand.map(c => cardHTML(c, { cls: 'mini' })).join('')
          : Array.from({ length: Math.min(p.handCount, 8) }, () => backHTML('tiny')).join('')}
          <span>${plural(p.handCount, 'card')}</span>${btn}</div>
        <div class="combos">${p.combos.map(c => this.comboChip(c)).join('') || '<span class="muted small">No combos yet</span>'}</div>
      </article>`;
    }).join('');
  }

  renderCenter() {
    const v = this.view;
    const drawable = (this.canAct() && v.turn.phase === 'main' && v.deckCount > 0) || this.targets?.deck !== undefined;
    $('pile-deck').classList.toggle('glow', !!drawable);
    $('pile-deck').disabled = !drawable;
    $('deck-cta').hidden = !drawable;
    $('deck-cta').textContent = v.turn.extra > 0 && !this.targets ? 'Draw (bonus)' : 'Draw';
    $('deck-count').textContent = `Deck · ${v.deckCount}`;
    $('pile-deck').querySelector('.card').classList.toggle('empty', v.deckCount === 0);
    const top = v.discard[v.discard.length - 1];
    $('discard-top').innerHTML = top ? cardHTML(top) : '<div class="card empty"></div>';
    $('discard-count').textContent = `Discard · ${v.discard.length}`;
    $('limbo').innerHTML = v.limbo.length ? `<div class="limbo-label">Laraki</div>${v.limbo.map(c => cardHTML(c, { cls: 'mini' })).join('')}` : '';
  }

  renderMe() {
    const v = this.view;
    if (v.me < 0) return;
    const p = v.players[v.me];
    $('me').classList.toggle('active', v.turn.player === v.me && !v.over);
    $('me-name').textContent = p.name;
    $('me-score').innerHTML = `${p.score}<small> pts</small>${p.skip ? ' <span class="tag warn">🐺 you skip your next turn</span>' : ''}`;
    $('me-combos').innerHTML = p.combos.map(c => this.comboChip(c)).join('')
      || '<span class="muted small">Combos you lay down appear here. Only combos on the table score.</span>';
  }

  renderStepper() {
    const v = this.view;
    const el = $('stepper');
    if (v.over) {
      el.innerHTML = `<li class="step now"><div><b>Game over.</b> ${v.winners.map(i => esc(v.players[i].name)).join(' & ')} win${v.winners.length > 1 ? '' : 's'}.
        <button type="button" class="btn sm primary" data-act="results">See results</button></div></li>`;
      return;
    }
    if (v.turn.player !== v.me) {
      const who = v.players[v.turn.player].name;
      const waiting = v.pending && v.pending.player !== v.me && v.pending.player !== v.turn.player
        ? ` · waiting for ${esc(v.players[v.pending.player].name)}` : '';
      el.innerHTML = `<li class="step idle"><div><span class="thinking">${esc(who)} is playing</span>${waiting}</div></li>`;
      return;
    }
    const t = v.turn;
    if (this.myPending()) {
      el.innerHTML = '<li class="step now"><div><b>Your decision:</b> see the panel at the bottom of the screen.</div></li>';
      return;
    }
    if (v.pending) {
      el.innerHTML = `<li class="step idle"><div><span class="thinking">Waiting for ${esc(v.players[v.pending.player].name)} to decide</span></div></li>`;
      return;
    }
    if (t.phase === 'wrap') {
      el.innerHTML = `<li class="step done"><span class="num">✓</span><div>Card drawn</div></li>
        <li class="step now"><span class="num">3</span><div><b>Lay down your combo</b> (button above your hand), then
        <button type="button" class="btn sm primary" data-act="end">End turn</button></div></li>`;
      return;
    }
    const canDraw = v.deckCount > 0;
    const canSteal = v.players.some((p, i) => i !== v.me && p.handCount >= 2);
    const step1 = t.play > 0
      ? `<li class="step now"><span class="num">1</span><div><b>Play a card</b> <span class="muted">(optional)</span><br><span class="muted small">Click a glowing Supernatural or Rune in your hand.</span></div></li>`
      : '<li class="step done"><span class="num">✓</span><div>Card played</div></li>';
    const bonus = t.extra > 0
      ? `<li class="step bonus"><span class="num">★</span><div><b>${plural(t.extra, 'bonus action')}</b><br><span class="muted small">Draw, steal, or use another power. These don't end your turn.</span></div></li>` : '';
    const close = canDraw || canSteal
      ? `<li class="step ${t.play > 0 ? '' : 'now'}"><span class="num">2</span><div><b>${t.extra > 0 ? 'Then draw or steal' : 'Draw or steal'}</b> to end your turn<br>
          <span class="actions-inline">${canDraw ? `<button type="button" class="btn sm ${t.play > 0 ? '' : 'primary'}" data-act="draw">${t.extra > 0 ? 'Draw (bonus)' : 'Draw a card'}</button>` : ''}
          ${canSteal ? '<span class="muted small">or press <i>Steal a card</i> on a player</span>' : ''}</span></div></li>`
      : '<li class="step now"><span class="num">2</span><div>Nothing to draw or steal. <button type="button" class="btn sm primary" data-act="pass">Pass</button></div></li>';
    el.innerHTML = step1 + bonus + close;
  }

  renderReady() {
    const v = this.view;
    if (v.me < 0) { $('ready').innerHTML = ''; return; }
    const hand = v.hand;
    const count = k => hand.filter(c => c.k === k).length;
    const myMove = this.canAct() && ['main', 'wrap'].includes(v.turn.phase);
    const triples = myMove ? readyTriples(hand) : [];
    const chips = triples.map((tri, i) =>
      `<button type="button" class="btn ready-btn" data-triple="${i}">Lay down ${icons(tri)} <b>+${tripleValue(tri)} pts</b></button>`).join('');
    const prog = k => `<span class="prog ${count(k) >= 3 ? 'full' : ''}" title="3 ${CARDS[k].name}s = 10 pts">${CARDS[k].icon} ${count(k)}/3</span>`;
    const setting = ['swamp', 'path', 'clearing'].map(k => `<span class="${count(k) ? '' : 'dim'}" title="${CARDS[k].name}">${CARDS[k].icon}${count(k)}</span>`).join(' ');
    $('ready').innerHTML = `${chips}<span class="tracker" aria-label="Combo progress">${prog('owl')}${prog('crow')}
      <span class="prog" title="Swamp + Path + Clearing = 5 pts, or 3 of one = 3 pts">${setting}</span></span>`;
  }

  renderHand() {
    const v = this.view;
    if (v.me < 0) return;
    const tokens = v.turn.play + v.turn.extra;
    const playable = c => this.canAct() && v.turn.phase === 'main' && tokens > 0 && (hasPower(c.k) || c.k === 'rune');
    const discarding = this.targets?.hand.size > 0;
    $('hand').innerHTML = v.hand.map(c => {
      const cls = [
        this.prevHand.size && !this.prevHand.has(c.id) ? 'fresh' : '',
        playable(c) ? 'playable' : '',
        discarding ? 'target' : '',
        this.pop?.id === c.id ? 'selected' : '',
      ].join(' ');
      return cardHTML(c, { tag: 'button', cls, attrs: `type="button" data-id="${c.id}" aria-haspopup="dialog"` });
    }).join('') || '<span class="muted">Your hand is empty.</span>';
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
        <button type="button" class="btn" data-pop="to" data-arg="new">Start a new combo <b>+1 pt</b></button>
        ${spots.map(c => `<button type="button" class="btn" data-pop="to" data-arg="${c.id}">Add to ${icons(c.cards)} <b>+${SUPER_POINTS[c.cards.length + 1] - SUPER_POINTS[c.cards.length]} pts</b></button>`).join('')}
        <button type="button" class="btn ghost sm" data-pop="back">← Back</button></div>`;
    } else {
      const acts = [];
      if (main && hasPower(card.k) && tokens > 0) acts.push('<button type="button" class="btn primary" data-pop="power">✦ Use power</button>');
      if (myTurn && isSuper(card.k)) acts.push(`<button type="button" class="btn" data-pop="place">${card.k === 'dragon' ? 'Place to protect a combo' : 'Place for points only'}</button>`);
      if (main && card.k === 'rune' && tokens > 0) acts.push('<button type="button" class="btn primary" data-pop="rune">Play Rune: +2 bonus actions</button>');
      let note = '';
      const have = v.hand.filter(c => c.k === card.k).length;
      if (d.type === 'animal') note = `You have ${have} of 3 ${d.name}s. With 3, a button to lay them down appears above your hand.`;
      else if (d.type === 'setting') note = 'Swamp + Path + Clearing = 5 pts, or 3 of the same = 3 pts. Ready combos appear above your hand.';
      else if (d.type === 'amulet') note = 'Keep it in hand. When someone steals from you, you can block it.';
      else if (main && hasPower(card.k) && tokens === 0) note = 'You already played a card this turn. You can still place it for points.';
      else if (!myTurn && (isSuper(card.k) || card.k === 'rune')) note = 'You can play this on your turn.';
      body = `${note ? `<p class="pop-note">${esc(note)}</p>` : ''}${acts.length ? `<div class="pop-actions">${acts.join('')}</div>` : ''}`;
    }
    pop.innerHTML = `<div class="pop-head"><span class="pop-icon" aria-hidden="true">${d.icon}</span><div><h3 id="pop-title">${esc(d.name)}</h3>
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
    pop.querySelector('.pop-actions button')?.focus({ preventScroll: true });
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
    if (!p) { dock.hidden = true; document.body.classList.remove('docked'); return; }
    const t = this.targets;
    let help = '';
    if (t.hand.size) help = 'Click a card in your hand, or pick one below.';
    else if (t.players.size) help = 'Click a highlighted player, or pick below.';
    else if (t.combos.size) help = 'Click a highlighted combo on the table, or pick below.';
    else if (t.comboCards.size) help = 'Click a highlighted card on the table, or pick below.';
    $('decision-title').textContent = p.title;
    $('decision-help').textContent = help;
    $('decision-reveal').innerHTML = (p.reveal || []).map(h => `<div class="reveal"><h3>${esc(h.name)}</h3>
      <div class="card-grid">${h.cards.map(c => cardHTML(c, { cls: 'mini' })).join('') || '<span class="muted">Empty hand</span>'}</div></div>`).join('');
    $('decision-options').innerHTML = p.options.map((o, i) =>
      `<button type="button" class="btn opt ${o.card ? 'with-card' : ''} ${o.v === 'block' || o.v === 'ok' ? 'primary' : ''}" data-opt="${i}">
        ${o.card ? cardHTML(o.card, { cls: 'mini' }) : ''}<span>${esc(o.label)}</span></button>`).join('');
    const wasHidden = dock.hidden;
    dock.hidden = false;
    document.body.classList.add('docked');
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
    $('feed').innerHTML = `<div class="feed-head">${esc(header)}</div>` + (n
      ? `<ul>${shown.map((e, i) => isMark(e)
        ? `<li class="who">${esc(e.msg.replace(/—/g, '').replace(/['’]s turn/, '').trim())}</li>`
        : `<li class="${i === lastIdx ? 'latest' : ''} ${e.to ? 'private' : ''}">${esc(e.msg)}</li>`).join('')}</ul>`
      : '<p class="muted small">Nothing has happened yet this turn.</p>');
    const ul = $('feed').querySelector('ul');
    if (ul) ul.scrollTop = ul.scrollHeight;
  }

  // Pop up things that happen *to* you while you're not acting, and your turn starting.
  notify(first) {
    const v = this.view;
    const me = v.me;
    const newest = v.log.length ? v.log[v.log.length - 1].n : 0;
    if (!first && this.lastLogN !== null && me >= 0 && v.turn.player !== me) {
      const myName = v.players[me].name;
      const aboutMe = v.log.filter(e => e.n > this.lastLogN).filter(e => e.to
        || (e.msg.includes(myName) && !e.msg.startsWith(myName) && !e.msg.startsWith('—')));
      if (aboutMe.length) showToast(aboutMe[aboutMe.length - 1].msg, 'info');
    }
    if (!first && this.prevTurnPlayer !== null && this.prevTurnPlayer !== v.turn.player && v.turn.player === me && !v.over) {
      showToast('Your turn!', 'turn');
    }
    this.prevTurnPlayer = v.turn.player;
    this.lastLogN = newest;
  }

  renderLog() {
    const ol = $('log');
    const atBottom = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 40;
    ol.innerHTML = this.view.log.map(e =>
      `<li class="${e.to ? 'private' : ''} ${e.msg.startsWith('—') ? 'turn' : ''}">${esc(e.msg)}</li>`).join('');
    if (atBottom) ol.scrollTop = ol.scrollHeight;
  }

  showGameOver() {
    const v = this.view;
    const rows = v.players.map((p, i) => ({ p, i })).sort((a, b) => b.p.score - a.p.score);
    const html = `<table class="final-table"><thead><tr><th>Player</th><th>Combos</th><th>Points</th></tr></thead><tbody>
      ${rows.map(({ p, i }) => `<tr class="${v.winners.includes(i) ? 'win' : ''}"><td>${v.winners.includes(i) ? '👑 ' : ''}${esc(p.name)}${i === v.me ? ' (you)' : ''}</td>
      <td>${p.combos.map(c => icons(c.cards)).join(' · ') || '–'}</td><td>${p.score}</td></tr>`).join('')}</tbody></table>`;
    openInfo('The Grimwood falls silent', html, this.gameOverChoices?.() || []);
  }
}
