// Sound effects and background music, synthesised with the Web Audio API.
// No audio files: everything is generated, so there is nothing to download or license.
//
// Browsers only allow audio after a user gesture, so the context is created lazily
// on the first pointer/key press (see unlock()).

const NOTE = n => 440 * 2 ** ((n - 69) / 12); // MIDI note → Hz

// D minor: the four chords cycle i – VI – III – VII (Dm, Bb, F, C).
const CHORDS = [
  [50, 53, 57], // D F A
  [46, 50, 53], // Bb D F
  [41, 45, 48], // F A C
  [48, 52, 55], // C E G
];
const MELODY = [62, 65, 67, 69, 72, 74, 77]; // D minor pentatonic-ish, upper register

export class GameAudio {
  constructor(settings) {
    this.settings = settings; // { music: 0..1, sfx: 0..1, muted: bool }
    this.ctx = null;
    this.musicOn = false;
    this.timer = null;
  }

  // ---------- setup ----------
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    // A shared reverb gives everything the same misty-forest space.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.5);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.9;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noise = this.noiseBuffer();
    this.applyVolumes();
    if (this.wantMusic) this.startMusic();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.settings.muted ? 0 : 1;
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx * m, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.55 * m, t, 0.3);
  }

  setPaused(paused) {
    if (!this.ctx) return;
    if (paused) this.ctx.suspend();
    else this.ctx.resume();
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  noiseBuffer() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ---------- building blocks ----------
  out(bus, wet = 0.2) {
    const g = this.ctx.createGain();
    g.connect(bus);
    if (wet) {
      const s = this.ctx.createGain();
      s.gain.value = wet;
      g.connect(s).connect(this.reverbSend);
    }
    return g;
  }

  env(param, t, peak, attack, decay, from = 0.0001) {
    param.setValueAtTime(from, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  tone({ f, f2 = null, type = 'sine', at = 0, attack = 0.005, decay = 0.3, gain = 0.3, wet = 0.2, bus = this.sfxBus, detune = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + attack + decay);
    const g = ctx.createGain();
    this.env(g.gain, t, gain, attack, decay);
    o.connect(g).connect(this.out(bus, wet));
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  hiss({ at = 0, dur = 0.15, from = 1500, to = 3500, q = 1.2, type = 'bandpass', gain = 0.25, wet = 0.1 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    this.env(g.gain, t, gain, dur * 0.25, dur * 0.75);
    src.connect(f).connect(g).connect(this.out(this.sfxBus, wet));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ---------- sound effects ----------
  sfx(name) {
    if (!this.ctx || this.settings.muted || this.settings.sfx <= 0) return;
    const S = SOUNDS[name];
    if (S) S(this);
  }

  // ---------- music ----------
  get wantMusic() { return this.settings.music > 0 && !this.settings.muted; }

  startMusic() {
    this.musicOn = true;
    if (!this.ctx || this.timer) return;
    this.step = 0;
    this.nextAt = this.ctx.currentTime + 0.3;
    this.drone();
    this.timer = setInterval(() => this.schedule(), 250);
  }

  stopMusic() {
    this.musicOn = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.droneNodes) {
      const t = this.ctx.currentTime;
      for (const n of this.droneNodes) { n.g.gain.setTargetAtTime(0.0001, t, 0.8); n.o.stop(t + 4); }
      this.droneNodes = null;
    }
  }

  drone() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.droneNodes = [NOTE(38), NOTE(45)].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(i ? 0.035 : 0.06, t + 4);
      o.connect(g).connect(this.out(this.musicBus, 0.3));
      o.start(t);
      return { o, g };
    });
  }

  // Look-ahead scheduler: each beat is 0.75s; a chord lasts 8 beats.
  schedule() {
    const ctx = this.ctx;
    while (this.nextAt < ctx.currentTime + 1.2) {
      const beat = this.step % 32;
      const chord = CHORDS[Math.floor(this.step / 8) % CHORDS.length];
      if (beat % 8 === 0) this.pad(chord, this.nextAt, 6.4);
      // Sparse music-box melody: notes on some beats, rests on others.
      if (Math.random() < (beat % 2 === 0 ? 0.42 : 0.18)) {
        const n = Math.random() < 0.5 ? chord[Math.floor(Math.random() * 3)] + 12 : MELODY[Math.floor(Math.random() * MELODY.length)];
        this.pluck(NOTE(n), this.nextAt + (Math.random() < 0.3 ? 0.375 : 0));
      }
      this.step++;
      this.nextAt += 0.75;
    }
  }

  pad(chord, t, dur) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(380, t);
    filter.frequency.linearRampToValueAtTime(900, t + dur * 0.5);
    filter.frequency.linearRampToValueAtTime(420, t + dur);
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 2.2);
    g.gain.setValueAtTime(0.05, t + dur - 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
    filter.connect(g).connect(this.out(this.musicBus, 0.6));
    for (const n of chord) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(n - 12);
        o.detune.value = det;
        o.connect(filter);
        o.start(t);
        o.stop(t + dur + 1.4);
      }
    }
  }

  pluck(f, t) {
    const ctx = this.ctx;
    for (const [mult, gain] of [[1, 0.05], [2, 0.012], [3.01, 0.006]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 / mult);
      o.connect(g).connect(this.out(this.musicBus, 0.8));
      o.start(t);
      o.stop(t + 2.6);
    }
  }
}

// Each sound is a tiny recipe of tones and filtered noise.
const SOUNDS = {
  click: a => a.tone({ f: 1800, f2: 1200, type: 'triangle', decay: 0.035, gain: 0.05, wet: 0 }),
  flip: a => a.hiss({ dur: 0.09, from: 3000, to: 5000, gain: 0.12, wet: 0 }),
  draw: a => { a.hiss({ dur: 0.16, from: 1400, to: 4200, gain: 0.22 }); a.tone({ f: 520, f2: 760, type: 'triangle', at: 0.05, decay: 0.08, gain: 0.05 }); },
  place: a => { a.tone({ f: 180, f2: 70, decay: 0.16, gain: 0.32, wet: 0.05 }); a.hiss({ dur: 0.05, from: 2500, to: 1500, gain: 0.1, wet: 0 }); },
  discard: a => a.hiss({ dur: 0.14, from: 5000, to: 1800, type: 'highpass', q: 0.7, gain: 0.16 }),
  steal: a => { a.hiss({ dur: 0.38, from: 500, to: 3800, type: 'lowpass', q: 4, gain: 0.3 }); a.tone({ f: 330, f2: 220, type: 'triangle', at: 0.1, decay: 0.25, gain: 0.08 }); },
  play: a => [0, 3, 7, 12].forEach((s, i) => a.tone({ f: NOTE(62 + s), type: 'triangle', at: i * 0.07, decay: 0.9, gain: 0.09, wet: 0.6 })),
  rune: a => [12, 19, 24, 31].forEach((s, i) => a.tone({ f: NOTE(62 + s), type: 'sine', at: i * 0.05, decay: 0.7, gain: 0.07, wet: 0.7 })),
  block: a => { a.tone({ f: 880, type: 'sine', decay: 0.9, gain: 0.16, wet: 0.5 }); a.tone({ f: 1318, type: 'sine', decay: 0.7, gain: 0.08, wet: 0.5 }); a.tone({ f: 2093, type: 'sine', decay: 0.4, gain: 0.04, wet: 0.5 }); },
  destroy: a => { a.hiss({ dur: 0.8, from: 900, to: 120, type: 'lowpass', q: 1, gain: 0.45, wet: 0.3 }); a.tone({ f: 70, f2: 38, decay: 0.8, gain: 0.4, wet: 0.2 }); },
  curse: a => { a.tone({ f: 260, f2: 170, type: 'sawtooth', attack: 0.15, decay: 0.7, gain: 0.05, wet: 0.6 }); a.tone({ f: 262, f2: 172, type: 'sawtooth', attack: 0.15, decay: 0.7, gain: 0.05, wet: 0.6, detune: 25 }); },
  peek: a => a.hiss({ dur: 0.5, from: 3000, to: 7000, q: 6, gain: 0.08, wet: 0.6 }),
  swap: a => { a.hiss({ dur: 0.3, from: 800, to: 3000, gain: 0.2 }); a.hiss({ at: 0.18, dur: 0.3, from: 3000, to: 800, gain: 0.2 }); },
  combo: a => [0, 4, 7].forEach((s, i) => a.tone({ f: NOTE(67 + s), type: 'triangle', at: i * 0.06, decay: 0.6, gain: 0.09, wet: 0.4 })),
  scoreUp: a => { a.tone({ f: NOTE(76), type: 'sine', decay: 0.25, gain: 0.08, wet: 0.3 }); a.tone({ f: NOTE(81), type: 'sine', at: 0.08, decay: 0.4, gain: 0.08, wet: 0.3 }); },
  scoreDown: a => { a.tone({ f: NOTE(69), type: 'sine', decay: 0.25, gain: 0.08, wet: 0.3 }); a.tone({ f: NOTE(64), type: 'sine', at: 0.09, decay: 0.4, gain: 0.08, wet: 0.3 }); },
  turn: a => a.tone({ f: 620, type: 'sine', decay: 0.18, gain: 0.07, wet: 0.3 }),
  yourTurn: a => { a.tone({ f: NOTE(74), type: 'triangle', decay: 1.2, gain: 0.12, wet: 0.5 }); a.tone({ f: NOTE(81), type: 'triangle', at: 0.16, decay: 1.4, gain: 0.12, wet: 0.5 }); },
  attention: a => a.tone({ f: NOTE(79), f2: NOTE(83), type: 'sine', decay: 0.35, gain: 0.08, wet: 0.4 }),
  skipped: a => a.tone({ f: 140, f2: 90, type: 'triangle', decay: 0.4, gain: 0.18, wet: 0.2 }),
  error: a => { a.tone({ f: 160, type: 'square', decay: 0.09, gain: 0.04, wet: 0 }); a.tone({ f: 150, type: 'square', at: 0.12, decay: 0.12, gain: 0.04, wet: 0 }); },
  win: a => [0, 4, 7, 12, 16].forEach((s, i) => a.tone({ f: NOTE(62 + s), type: 'triangle', at: i * 0.12, decay: 1.4, gain: 0.1, wet: 0.6 })),
  lose: a => [7, 3, 0, -5].forEach((s, i) => a.tone({ f: NOTE(62 + s), type: 'triangle', at: i * 0.22, decay: 1.4, gain: 0.08, wet: 0.7 })),
};
