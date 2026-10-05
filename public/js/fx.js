// Visual playback of game events: flying cards, a spotlight for played powers,
// a turn banner, floating badges and score pop-ups. Purely cosmetic: the table
// is re-rendered from the view afterwards, so a skipped animation loses nothing.
import { CARDS, artStyle } from './cards.js';

const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// Every wait also ends early when the playback is cut short (clear()), so a new move never queues behind an old animation.
let cutNow = () => {};
let cut = new Promise(r => { cutNow = r; });
function cutAll() {
  cutNow();
  cut = new Promise(r => { cutNow = r; });
}
const sleep = ms => Promise.race([new Promise(r => setTimeout(r, ms)), cut]);
// Browsers pause animations in background tabs, so never wait on one longer than it should take.
const settle = (anim, ms) => Promise.race([anim.finished.catch(() => {}), sleep(ms + 400)]);
import { reducedMotion as reduced } from './settings.js';

// Which sound accompanies each event.
const SOUND_FOR = {
  draw: 'draw', steal: 'steal', block: 'block', discard: 'discard', skipped: 'skipped', rune: 'rune', play: 'play',
  place: 'place', ask: 'flip', give: 'flip', take: 'draw', swapHands: 'swap', swapCombo: 'swap', seize: 'swap',
  destroy: 'destroy', curse: 'curse', peek: 'peek', combo: 'combo', pass: 'click',
};
const center = el => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: r.width > 0 && r.bottom > 0 && r.top < innerHeight };
};

export class FX {
  constructor() {
    this.layer = document.getElementById('fx');
    this.gen = 0;
  }

  // Fast-forward: stop the current sequence and remove its effects.
  skip() {
    this.gen++;
    cutAll();
    this.layer.replaceChildren();
  }

  clear() {
    this.gen++;
    cutAll();
    this.layer.replaceChildren();
  }

  // --- anchors ---
  seat(p) {
    if (p === this.me) return document.getElementById('hand');
    return document.querySelector(`.seat[data-seat="${p}"]`) || document.getElementById('opponents');
  }
  scoreEl(p) {
    if (p === this.me) return document.querySelector('#me-head .score-pill');
    return document.querySelector(`.seat[data-seat="${p}"] .score-pill`);
  }
  deck() { return document.getElementById('pile-deck'); }
  discard() { return document.getElementById('pile-discard'); }
  middle() { return document.querySelector('.center') || document.body; }

  // On phones the seats scroll sideways: bring the seat into view before animating at it.
  async reveal(p) {
    if (p === this.me || p == null || p < 0) return;
    const strip = document.getElementById('opponents');
    const el = document.querySelector(`.seat[data-seat="${p}"]`);
    if (!el || strip.scrollWidth <= strip.clientWidth) return;
    const left = el.offsetLeft - strip.offsetLeft - 10;
    if (Math.abs(strip.scrollLeft - left) < 20) return;
    strip.scrollTo({ left, behavior: 'smooth' });
    await sleep(220);
  }

  // --- primitives ---
  cardEl(k) {
    const el = document.createElement('div');
    if (k) {
      const d = CARDS[k];
      el.className = `fx-card t-${d.type}`;
      if (d.img) { el.classList.add('has-art'); el.style.setProperty('--art', `url('${d.img}')`); }
      else el.innerHTML = `<span>${d.icon}</span>`;
    } else {
      el.className = 'fx-card back';
      el.innerHTML = '<span>🌲</span>';
    }
    return el;
  }

  async fly(fromEl, toEl, k, ms) {
    if (!fromEl || !toEl) return;
    const a = center(fromEl), b = center(toEl);
    const el = this.cardEl(k);
    this.layer.append(el);
    const anim = el.animate([
      { transform: `translate(${a.x}px, ${a.y}px) scale(.7)`, opacity: 0 },
      { transform: `translate(${a.x}px, ${a.y}px) scale(1)`, opacity: 1, offset: .12 },
      { transform: `translate(${b.x}px, ${b.y}px) scale(1)`, opacity: 1, offset: .85 },
      { transform: `translate(${b.x}px, ${b.y}px) scale(.75)`, opacity: 0 },
    ], { duration: ms, easing: 'cubic-bezier(.4, .1, .2, 1)' });
    await settle(anim, ms);
    el.remove();
  }

  badge(anchor, text, ms, cls = '') {
    if (!anchor) return Promise.resolve();
    const c = center(anchor);
    const el = document.createElement('div');
    el.className = `fx-badge ${cls}`;
    el.textContent = text;
    this.layer.append(el);
    const anim = el.animate([
      { transform: `translate(${c.x}px, ${c.y}px) translate(-50%, -30%) scale(.6)`, opacity: 0 },
      { transform: `translate(${c.x}px, ${c.y}px) translate(-50%, -80%) scale(1.1)`, opacity: 1, offset: .25 },
      { transform: `translate(${c.x}px, ${c.y}px) translate(-50%, -120%) scale(1)`, opacity: 1, offset: .75 },
      { transform: `translate(${c.x}px, ${c.y}px) translate(-50%, -160%) scale(.9)`, opacity: 0 },
    ], { duration: ms, easing: 'ease-out' });
    return settle(anim, ms).then(() => el.remove());
  }

  pulse(anchor, cls = '') {
    if (!anchor) return;
    anchor.classList.remove('fx-pulse', 'bad', 'good');
    void anchor.offsetWidth; // restart the animation
    anchor.classList.add('fx-pulse');
    if (cls) anchor.classList.add(cls);
    setTimeout(() => anchor.classList.remove('fx-pulse', 'bad', 'good'), 900);
  }

  async spotlight(k, caption, ms) {
    const d = CARDS[k];
    const el = document.createElement('div');
    el.className = 'fx-spot';
    el.innerHTML = `<div class="fx-spot-cap">${esc(caption)}</div>
      <div class="fx-spot-card t-${d.type} ${d.img ? 'has-art' : ''}" ${artStyle(d)}>${d.img ? '' : `<span class="fx-spot-icon">${d.icon}</span><b>${esc(d.name)}</b>`}</div>
      ${d.img ? `<b class="fx-spot-name">${esc(d.name)}</b>` : ''}
      <div class="fx-spot-text">${esc(d.text)}</div>`;
    this.layer.append(el);
    const anim = el.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.85)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: .15 },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: .85 },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.96)' },
    ], { duration: ms, easing: 'ease-out' });
    await settle(anim, ms);
    el.remove();
  }

  banner(text, ms, mine) {
    const el = document.createElement('div');
    el.className = `fx-banner ${mine ? 'mine' : ''}`;
    el.textContent = text;
    this.layer.append(el);
    const anim = el.animate([
      { opacity: 0, transform: 'translate(-50%, -12px)' },
      { opacity: 1, transform: 'translate(-50%, 0)', offset: .15 },
      { opacity: 1, transform: 'translate(-50%, 0)', offset: .8 },
      { opacity: 0, transform: 'translate(-50%, -6px)' },
    ], { duration: ms, easing: 'ease-out' });
    return settle(anim, ms).then(() => el.remove());
  }

  scorePops(prev, next) {
    if (!prev || reduced()) return;
    next.players.forEach((p, i) => {
      const d = p.score - (prev.players[i]?.score ?? p.score);
      if (!d) return;
      this.badge(this.scoreEl(i), `${d > 0 ? '+' : ''}${d}`, 1300, d > 0 ? 'good' : 'bad');
    });
  }

  // --- event playback ---
  // speed: multiplier for durations (1 = normal). Returns when the sequence is done.
  // onEvent(entry) is called as each event starts, so the feed can narrate in step with the animation.
  async play(events, { me, names, speed = 1, own = false, onEvent = null }) {
    if (!events.length) return;
    const soundOf = ev => (ev.t === 'turn' ? (ev.p === me ? 'yourTurn' : 'turn') : ev.t === 'power' ? (ev.k === events.find(x => x.ev.t === 'play')?.ev.k ? null : 'play') : SOUND_FOR[ev.t]);
    if (reduced()) {
      // No motion: still narrate and play the sounds, briefly spaced so they stay distinct.
      for (const e of events) {
        onEvent?.(e);
        const name = soundOf(e.ev);
        if (name) { this.sound?.(name); await sleep(160); }
      }
      return;
    }
    this.me = me;
    const gen = this.gen;
    const T = ms => Math.max(80, ms * speed * (own ? 0.55 : 1));
    const who = p => (p === me ? 'You' : names[p]);
    let lastPlay = null;
    for (const e of events) {
      if (gen !== this.gen) return;
      const ev = e.ev;
      const p = ev.p;
      onEvent?.(e);
      const name = soundOf(ev);
      if (name) this.sound?.(name);
      await this.reveal(p);
      switch (ev.t) {
        case 'turn':
          if (p === me) this.pulse(document.getElementById('me'), 'good');
          else this.pulse(this.seat(p));
          await Promise.race([this.banner(p === me ? 'Your turn' : `${names[p]}’s turn`, T(1100), p === me), sleep(T(450))]);
          break;
        case 'draw':
          await this.fly(this.deck(), this.seat(p), null, T(560));
          break;
        case 'steal':
          await this.reveal(ev.from);
          this.pulse(this.seat(ev.from), 'bad');
          await this.fly(this.seat(ev.from), this.seat(p), null, T(620));
          break;
        case 'block':
          this.pulse(this.seat(p), 'good');
          await this.badge(this.seat(p), '🧿 Blocked!', T(1100), 'good');
          break;
        case 'discard':
          await this.fly(this.seat(p), this.discard(), ev.k, T(560));
          break;
        case 'skipped':
          await this.badge(this.seat(p), '🐺 Turn skipped', T(1100), 'bad');
          break;
        case 'rune':
          if (!own) await this.spotlight('rune', `${who(p)} ${p === me ? 'play' : 'plays'}`, T(1300));
          await this.badge(this.seat(p), '+2 actions', T(800), 'good');
          break;
        case 'play':
          lastPlay = ev.k;
          if (!own) await this.spotlight(ev.k, `${who(p)} ${p === me ? 'play' : 'plays'}`, T(1700));
          else await this.badge(this.seat(p), CARDS[ev.k].icon, T(600));
          break;
        case 'place':
          await this.badge(this.seat(p), `${CARDS[ev.k].icon} placed`, T(800));
          break;
        case 'power':
          // The spotlight already introduced a freshly played card; re-activations (Elf, Nymph) get their own.
          if (lastPlay !== ev.k && !own) await this.spotlight(ev.k, `${who(p)}: power again`, T(1400));
          lastPlay = null;
          break;
        case 'ask':
          await this.badge(this.seat(p), `${CARDS[ev.k].icon} ?`, T(900));
          break;
        case 'give':
          await this.reveal(ev.to);
          await this.fly(ev.from === 'limbo' ? this.middle() : this.seat(p), this.seat(ev.to), ev.k, T(600));
          break;
        case 'take': {
          const src = ev.from === 'discard' ? this.discard() : ev.from === 'limbo' ? this.middle() : this.seat(ev.from);
          await this.fly(src, this.seat(p), ev.k, T(620));
          break;
        }
        case 'swapHands':
          await Promise.all([
            this.fly(this.seat(p), this.seat(ev.with), null, T(700)),
            this.fly(this.seat(ev.with), this.seat(p), null, T(700)),
          ]);
          break;
        case 'swapCombo':
        case 'seize': {
          const other = ev.with ?? ev.from;
          this.pulse(this.seat(other), 'bad');
          await this.fly(this.seat(other), this.seat(p), null, T(700));
          break;
        }
        case 'destroy':
          this.pulse(this.seat(ev.owner), 'bad');
          await Promise.all([this.badge(this.seat(ev.owner), '💥 Destroyed', T(1000), 'bad'),
            this.fly(this.seat(ev.owner), this.discard(), null, T(700))]);
          break;
        case 'curse':
          this.pulse(this.seat(ev.target), 'bad');
          await this.badge(this.seat(ev.target), '🐺 Loses next turn', T(1100), 'bad');
          break;
        case 'peek':
          if (ev.target >= 0) await this.badge(this.seat(ev.target), '👁️ Peeked', T(900));
          else await this.badge(this.middle(), '👁️ Every hand revealed to ' + who(p), T(1000));
          break;
        case 'combo':
          this.pulse(this.seat(p), 'good');
          await sleep(T(350));
          break;
        case 'pass':
          await this.badge(this.seat(p), '⏭ Pass', T(800));
          break;
        case 'over':
          await this.banner('Game over', T(1400), false);
          break;
        default:
          break;
      }
    }
  }
}
