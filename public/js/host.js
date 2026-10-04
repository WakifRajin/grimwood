// Owns the authoritative game state: applies actions and drives AI seats.
// Offline play runs one in the page; online, the room host's browser runs it.
import { apply, viewFor } from './engine.js';
import { aiDecide } from './ai.js';

export class GameHost {
  constructor(state, { onChange, aiDelay = 1100 } = {}) {
    this.state = state;
    this.onChange = onChange;
    this.aiDelay = aiDelay;
    this.timer = null;
    this.stopped = false;
  }

  start() {
    this.onChange?.(this.state);
    this.scheduleAI();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  // Returns an error message, or null on success. Applies to a copy so a
  // rejected action can never leave the state half-modified.
  submit(seat, action) {
    if (this.stopped) return 'This game is no longer running.';
    const next = structuredClone(this.state);
    try {
      apply(next, { ...action, player: seat });
    } catch (e) {
      return e.message;
    }
    this.state = next;
    this.onChange?.(next);
    this.scheduleAI();
    return null;
  }

  actor() {
    const s = this.state;
    return s.pending ? s.pending.player : s.turn.player;
  }

  scheduleAI() {
    clearTimeout(this.timer);
    const s = this.state;
    if (this.stopped || s.over) return;
    const seat = this.actor();
    const level = s.players[seat].ai;
    if (!level) return;
    const delay = s.pending ? this.aiDelay * 0.7 : this.aiDelay;
    this.timer = setTimeout(() => {
      const action = aiDecide(viewFor(this.state, seat), level);
      if (action && !this.submit(seat, action)) return;
      // Safety net so a confused bot can never stall the table.
      const st = this.state;
      const fallback = st.pending ? { type: 'choose', value: st.pending.options[0].v }
        : st.turn.phase === 'wrap' ? { type: 'end_turn' }
        : st.deck.length ? { type: 'draw' } : { type: 'pass' };
      const err = this.submit(seat, fallback);
      if (err) console.error('AI stalled:', err, action);
    }, delay);
  }
}
