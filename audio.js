// The instrument. rules.js decides what each plane plays; this file only makes the sound.
// Every sound is synthesised here, with no samples and no recorded music.
const hz = m => 440 * 2 ** ((m - 69) / 12);
const LEVEL = 0.95;
const KINDS = {
  tiny: { ratio: 4, bite: 0.6, ring: 0.3 },     // a short wooden tick
  regional: { ratio: 3, bite: 0.7, ring: 0.8 }, // a bright pluck
  narrow: { ratio: 2, bite: 0.9, ring: 1.5 },   // a clear bell
  long: { ratio: 1, bite: 0.8, ring: 1.9, tine: 0.1 },   // a round electric piano
  wide: { ratio: 1, bite: 1.5, ring: 3 },       // a warm, heavy note
  jumbo: { ratio: 0.5, bite: 1.2, ring: 5 },    // a deep, slow gong
};

export class Music {
  constructor(ctx) {
    this.ctx = ctx; this.hums = new Map();
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.02 | 0, ctx.sampleRate);        // a very short burst of noise, fading out
    this.noise.getChannelData(0).forEach((_, i, d) => { d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2; });
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

  // Generated reverb: a few early echoes off the walls, then noise that dies away evenly and gets darker as it goes.
  room(sec) {
    const { ctx } = this, rate = ctx.sampleRate, n = sec * rate | 0, b = ctx.createBuffer(2, n, rate), gap = rate * 0.03 | 0;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let low = 0;
      for (let i = gap; i < n; i++) {
        const t = i / n; low += ((Math.random() * 2 - 1) - low) * (0.3 * (1 - t) ** 2 + 0.02);
        d[i] = low * Math.exp(-5.5 * t) * Math.min(1, (i - gap) / 800) * 0.5;
      }
      for (let k = 1; k <= 6; k++) d[(rate * (0.007 + Math.random() * 0.06)) | 0] += 0.5 / k * (Math.random() < 0.5 ? -1 : 1);
    }
    return b;
  }

  // Six instruments, so the sections of the sky can be told apart by ear. All are two-oscillator FM.
  // ratio sets the character, bite how hard the note starts, ring how long it lasts in seconds.
  strike(kind, m, t, loud, pan, far = 0) {
    const { ratio, bite, ring, tine } = KINDS[kind], f = hz(m), near = far < 0.75;
    // High notes die sooner, which keeps a busy sky clear. Far planes are rounder, so distance changes the tone as well as the level.
    const out = this.tone(f, t, loud * (1 - (m - 39) / 60 * 0.5), ratio, bite * (1 - far * 0.4), ring * Math.min(1, (262 / f) ** 0.3), pan, far, near);
    if (near) this.struck(out, t, tine && f);                                 // only near planes have an audible strike
  }
  // Near notes play on two voices a few cents apart, which makes any of the six fuller without changing what it is.
  tone(f, t, level, ratio, bite, ring, pan, far, full) {
    const { ctx } = this, g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, ring / 5);
    for (const cents of full ? [-4, 4] : [0]) {
      const c = ctx.createOscillator(), o = ctx.createOscillator(), mod = ctx.createGain(), part = ctx.createGain();
      c.frequency.value = f; c.detune.value = cents; o.frequency.value = f * ratio; part.gain.value = full ? 0.6 : 1;
      mod.gain.setValueAtTime(f * bite, t); mod.gain.setTargetAtTime(f * bite * 0.1, t, ring * 0.1);   // bright at first, then mellow, never a bare sine
      o.connect(mod).connect(c.frequency); c.connect(part).connect(g);
      c.start(t); o.start(t); c.stop(t + ring * 1.2); o.stop(t + ring * 1.2);
    }
    const p = ctx.createStereoPanner(), a = ctx.createGain(), b = ctx.createGain(), e = ctx.createGain();
    p.pan.value = pan; a.gain.value = 1 - far * 0.5; b.gain.value = 0.14 + far * 0.5; e.gain.value = 0.08 * (1 - far);
    g.connect(p); p.connect(a).connect(this.dry); p.connect(b).connect(this.wet); p.connect(e).connect(this.echo);
    return g;
  }
  struck(to, t, tine) {
    const { ctx } = this, n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = this.noise; bp.type = 'bandpass'; bp.frequency.value = 2000; g.gain.value = 0.08;
    n.connect(bp).connect(g).connect(to); n.start(t);
    if (!tine) return;
    const o = ctx.createOscillator(), a = ctx.createGain();                              // the short high ring of an electric piano's tine
    o.frequency.value = Math.min(tine * 14, 9000); a.gain.setValueAtTime(0.1, t); a.gain.setTargetAtTime(0, t, 0.02);
    o.connect(a).connect(to); o.start(t); o.stop(t + 0.1);
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

  mute(on) {                                   // clears the fade-in first, or stopping during it leaves the hum playing
    const { gain } = this.master, t = this.ctx.currentTime;
    gain.cancelScheduledValues(t); gain.setTargetAtTime(on ? 0 : LEVEL, t, 0.06);
  }
  setBeat(sec) { this.echo.delayTime.setTargetAtTime(Math.min(3.9, sec * 3), this.ctx.currentTime, 0.3); }
}
