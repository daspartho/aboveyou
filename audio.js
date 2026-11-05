// The instrument. rules.js decides what each plane plays; this file only makes the sound.
// Every sound is synthesised here, with no samples and no recorded music.
const hz = m => 440 * 2 ** ((m - 69) / 12);
const LEVEL = 0.95;
const KINDS = {
  tiny: { ratio: 4, bite: 0.6, ring: 0.3 },     // a short wooden tick
  regional: { ratio: 3, bite: 0.7, ring: 0.8 }, // a bright pluck
  narrow: { ratio: 2, bite: 0.9, ring: 1.5 },   // a clear bell
  long: { ratio: 1, bite: 0.8, ring: 1.9 },     // a round electric piano
  wide: { ratio: 1, bite: 1.5, ring: 3 },       // a warm, heavy note
  jumbo: { ratio: 0.5, bite: 1.2, ring: 5 },    // a deep, slow gong
};

export class Music {
  constructor(ctx) {
    this.ctx = ctx; this.hums = new Map();
    this.master = ctx.createGain(); this.master.gain.setValueAtTime(0, ctx.currentTime); this.master.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + 1.2);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.ratio.value = 8; limiter.attack.value = 0.01; limiter.release.value = 0.3;
    this.master.connect(limiter).connect(ctx.destination);

    this.dry = ctx.createGain(); this.dry.connect(this.master);
    this.wet = ctx.createConvolver(); this.wet.buffer = this.room(2.8);
    const clear = ctx.createBiquadFilter(); clear.type = 'highpass'; clear.frequency.value = 130;   // keeps the room out of the bass's way
    this.wet.connect(clear).connect(this.master);

    // An echo three beats long, darker on each repeat.
    this.echo = ctx.createDelay(4); this.echo.delayTime.value = 2.25;
    const tone = ctx.createBiquadFilter(), back = ctx.createGain();
    tone.type = 'lowpass'; tone.frequency.value = 1500; back.gain.value = 0.3;
    this.echo.connect(tone).connect(back).connect(this.echo); tone.connect(this.wet);

    // The hum sits under everything and is kept dark so it never competes with the notes.
    this.humBus = ctx.createBiquadFilter(); this.humBus.type = 'lowpass'; this.humBus.frequency.value = 620;
    const humWet = ctx.createGain(); humWet.gain.value = 0.5;
    this.humBus.connect(this.dry); this.humBus.connect(humWet).connect(this.wet);
  }

  // Generated reverb: under three seconds of noise that gets darker as it dies away.
  room(sec) {
    const { ctx } = this, n = sec * ctx.sampleRate | 0, b = ctx.createBuffer(2, n, ctx.sampleRate), gap = ctx.sampleRate * 0.03 | 0;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let low = 0;
      for (let i = gap; i < n; i++) {
        const t = i / n; low += ((Math.random() * 2 - 1) - low) * (0.3 * (1 - t) ** 2 + 0.02);
        d[i] = low * (1 - t) ** 2.5 * Math.min(1, (i - gap) / 800) * 0.5;
      }
    }
    return b;
  }

  // Six instruments, so the sections of the sky can be told apart by ear. All are two-oscillator FM.
  // ratio sets the character, bite how hard the note starts, ring how long it lasts in seconds.
  strike(kind, m, t, loud, pan, far = 0) {
    const { ratio, bite, ring } = KINDS[kind];
    this.tone(hz(m), t, loud * (1 - (m - 39) / 60 * 0.5), ratio, bite, ring, pan, far);
  }
  tone(f, t, level, ratio, bite, ring, pan, far) {
    const { ctx } = this, c = ctx.createOscillator(), o = ctx.createOscillator(), mod = ctx.createGain(), g = ctx.createGain();
    c.frequency.value = f; o.frequency.value = f * ratio;
    mod.gain.setValueAtTime(f * bite, t); mod.gain.exponentialRampToValueAtTime(f * bite * 0.04, t + ring * 0.4);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, ring / 5);
    o.connect(mod).connect(c.frequency); c.connect(g);
    const p = ctx.createStereoPanner(), a = ctx.createGain(), b = ctx.createGain(), e = ctx.createGain();
    p.pan.value = pan; a.gain.value = 1 - far * 0.5; b.gain.value = 0.14 + far * 0.5; e.gain.value = 0.08 * (1 - far);
    g.connect(p); p.connect(a).connect(this.dry); p.connect(b).connect(this.wet); p.connect(e).connect(this.echo);
    c.start(t); o.start(t); c.stop(t + ring * 1.2); o.stop(t + ring * 1.2);
  }
  // The bass: a plucked saw that small speakers can play, with a sine under it.
  bass(m, t) {
    const { ctx } = this, f = hz(m), s = ctx.createOscillator(), n = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), mix = ctx.createGain();
    s.type = 'sawtooth'; s.frequency.value = f; n.frequency.value = f; mix.gain.value = 0.4;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(160, t + 0.5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.2, t + 0.006); g.gain.setTargetAtTime(0, t + 0.006, 0.28);
    s.connect(mix).connect(lp); n.connect(lp); lp.connect(g).connect(this.dry);
    s.start(t); n.start(t); s.stop(t + 1.5); n.stop(t + 1.5);
  }

  // levels maps a note to how many planes hold it. The sound thickens with the crowd without getting much louder.
  hum(levels, t) {
    let all = 0; for (const w of levels.values()) all += w;
    const fill = 0.05 * (1 - Math.exp(-all / 25));
    for (const m of levels.keys()) if (!this.hums.has(m)) this.hums.set(m, this.humVoice(m));
    for (const [m, v] of this.hums) v.setTargetAtTime(levels.has(m) ? fill * Math.sqrt(levels.get(m) / all) : 0, t, 0.5);
  }
  humVoice(m) {                                // two voices a hair apart, so each note breathes slowly
    const { ctx } = this, g = ctx.createGain(); g.gain.value = 0; g.connect(this.humBus);
    for (const off of [-0.07, 0.07]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(m) + off; o.connect(g); o.start();
    }
    return g.gain;
  }

  mute(on) { this.master.gain.setTargetAtTime(on ? 0 : LEVEL, this.ctx.currentTime, 0.06); }
  setBeat(sec) { this.echo.delayTime.setTargetAtTime(Math.min(3.9, sec * 3), this.ctx.currentTime, 0.3); }
}
