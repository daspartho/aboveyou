// The music system. Each sentence on the page is one rule here, and every rule reads only plane data.
import { sizeOf } from './size.js';

export const FAR = 463;                 // km. 250 nautical miles, the most adsb.fi will return.
const LOW = 39, SPAN = 41;              // notes run from 78 Hz to 830 Hz
const clamp = v => Math.min(1, Math.max(0, v));

// Below 29,000 ft planes are passing through. From there up they cruise on fixed heights 1,000 ft apart,
// so that band gets most of the range: with the black keys lit, each cruising height is its own key.
const height = p => p.alt < 29000 ? clamp(p.alt / 29000) * 0.3 : 0.3 + clamp((p.alt - 29000) / 12000) * 0.7;

const DATA = {                   // every measure runs 0 to 1
  height,
  size: p => Math.sqrt(clamp(sizeOf(p) / 500)),
  distance: p => clamp(1 - p.d / FAR),                  // 1 is overhead
  heading: p => clamp(p.track / 360),
  speed: p => clamp(p.gs / 520),                        // knots; fast airliners reach about 520 over the ground
};

// Distance and speed are ranked within the planes in range, so they spread across the notes in any sky.
const SCALES = new Set(['height', 'size', 'heading']);
let ranks = {};
export function spread(list) {
  ranks = {};
  for (const word of new Set([play.note, play.sound, play.loud])) {
    if (SCALES.has(word)) continue;
    const sorted = [...list].sort((a, b) => DATA[word](a) - DATA[word](b)), map = new Map();
    sorted.forEach((p, i) => map.set(p, sorted.length > 1 ? i / (sorted.length - 1) : 0.5));
    ranks[word] = map;
  }
}
const value = (word, p) => ranks[word]?.get(p) ?? DATA[word](p);

const RANK = {                          // who picks the chord
  biggest: sizeOf, nearest: p => -p.d, highest: p => p.alt, lowest: p => -p.alt, fastest: p => p.gs,
};

// Every plane measure that differs between planes is open to every rule. What sounds good is for the player to find.
export const WORDS = {
  note: ['height', 'distance', 'heading', 'size', 'speed'],
  sound: ['size', 'height', 'distance', 'heading', 'speed'],
  loud: ['distance', 'height', 'size', 'heading', 'speed'],
  deep: Object.keys(RANK),
  tune: Object.keys(RANK),
  climb: ['two', 'three', 'four'],
  descend: ['two', 'three', 'four'],
};
const COUNT = { two: 2, three: 3, four: 4 };

export const play = {
  turn: 12, beats: 32,                  // seconds per sweep, and how many beats in a sweep
  note: 'height', sound: 'size', loud: 'distance', deep: 'biggest',
  tune: 'nearest', climb: 'two', descend: 'two',
  keys: new Set([1, 3, 6, 8, 10]),      // the five black keys of a piano: they never clash
};

function snap(m, set = play.keys) {     // nearest note that is allowed
  for (let d = 0; d < 12; d++) {
    if (set.has((m + d) % 12)) return m + d;
    if (set.has((m - d + 120) % 12)) return m - d;
  }
  return m;
}

const noteOf = p => {            // bigger plane, lower note, as with a big plate and a small one
  if (!parts.pitch) return snap(63);     // with this rule off, every plane plays one note and only the rhythm is left
  const v = value(play.note, p);
  return snap(LOW + Math.round((play.note === 'size' ? 1 - v : v) * SPAN));
};
// Size splits the sky into six sections. For size the cuts fall at about 50, 120, 170, 220 and 400 seats.
const SECTIONS = [[0.316, 'tiny'], [0.49, 'regional'], [0.583, 'narrow'], [0.663, 'long'], [0.894, 'wide'], [Infinity, 'jumbo']];
export const kindOf = p => { if (!parts.timbre) return 'narrow'; const v = value(play.sound, p); return SECTIONS.find(s => v < s[0])[1]; };
const OCTAVE = { tiny: 12, regional: 12, narrow: 0, long: 0, wide: -12, jumbo: -12 };   // big plates are low, small plates are high
export const pitchOf = p => noteOf(p) + OCTAVE[kindOf(p)];
const loudOf = p => !parts.loudness ? 0.5 : 0.03 + 0.97 * value(play.loud, p) ** 2.5;
export const panOf = p => Math.sin(p.az * Math.PI / 180) * 0.75;

function neighbour(m, dir) {             // the next key that is on, above or below
  for (let d = 1; d <= 12; d++) if (play.keys.has((m + dir * d + 120) % 12)) return m + dir * d;
  return m;
}

let bassNote = null, chord = null, lastLead = 66;
export const inChord = i => chord?.has(i);
export const parts = { hum: true, notes: true, pitch: true, timbre: true, loudness: true, tune: true, chord: true, climb: true, descend: true };   // each can be switched off from its line

// The biggest plane in a quarter sets the chord: its own note, plus every other lit key above it.
function chordOn(root) {
  const keys = [...play.keys].sort((a, b) => a - b), at = keys.indexOf(root % 12);
  return new Set([0, 2, 4].map(step => keys[(at + step) % keys.length]));
}
// A melody moves by small steps, so the lead takes its note in the octave closest to the last one.
function closeBy(m) {
  let best = 48 + ((m - 48) % 12 + 12) % 12;
  for (let c = best; c <= 84; c += 12) if (Math.abs(c - lastLead) < Math.abs(best - lastLead)) best = c;
  return best;
}

// One beat of the sweep. list is the planes in range. Calls back with each plane that sounded and its note.
export function beat(music, n, at, list, heard) {
  const i = n % play.beats, len = play.turn / play.beats, quarter = play.beats / 4, pulse = Math.max(1, Math.round(play.beats / 8));
  if (!parts.chord) bassNote = chord = null;
  else if (i % quarter === 0 || bassNote === null) {   // a new quarter of the sky, or the first beat you hear
    const from = Math.floor(i / quarter) * 90;
    const best = list.filter(p => p.az >= from && p.az < from + 90).sort((a, b) => RANK[play.deep](b) - RANK[play.deep](a))[0];
    if (best) {
      const m = noteOf(best);
      bassNote = 33 + ((m - 33) % 12 + 12) % 12; chord = chordOn(m); heard(best, at, 1, m, true);
    }
  }
  if (bassNote !== null && list.length && i % pulse === 0) music.bass(bassNote, at);
  const scale = 0.5 / (1 + list.length / 300);
  const accent = i % (pulse * 2) === 0 ? 1.25 : i % pulse === 0 ? 1.05 : i % 2 === 0 ? 0.85 : 0.65;   // some beats lean harder, as in any rhythm
  if (!parts.notes) return;
  const here = list.filter(p => Math.round(p.az / 360 * play.beats) % play.beats === i).sort((a, b) => RANK[play.tune](b) - RANK[play.tune](a));
  here.forEach((p, order) => {
    const place = p.az / 360 * play.beats, slot = Math.round(place), lead = parts.tune && order === 0;
    const loud = loudOf(p), kind = kindOf(p);
    let m = pitchOf(p);
    if (chord && i % 2 === 0) m = snap(m, chord);  // strong beats stay on the chord, weak beats may pass between
    if (lead) { m = closeBy(m); lastLead = m; }
    const level = (lead ? Math.max(loud, 0.3) * accent : loud * 0.55) * scale, far = lead ? 1 - Math.max(loud, 0.3) : Math.max(0.6, 1 - loud);
    // Only the lead lands on the beat. The rest keep their true angle and fall between beats, like rain.
    const when = at + (lead ? 0 : (place - slot + 0.5) * len);
    music.strike(kind, m, when, level, panOf(p), far);
    const run = p.rate > 0 ? 'climb' : 'descend';
    if (Math.abs(p.rate) > 300 && parts[run]) {
      for (let s = 1, step = m; s < COUNT[play[run]]; s++) {
        step = neighbour(step, Math.sign(p.rate));
        music.strike(kind, step, when + s * len / 2, level, panOf(p), far);
      }
    }
    heard(p, when, lead ? 1 : loud * 0.55, m);
  });
}

export function hum(music, t, list) {   // every plane in range holds its note an octave down
  const levels = new Map();
  if (parts.hum) for (const p of list) { const m = noteOf(p) - 12; levels.set(m, (levels.get(m) || 0) + 1); }
  music.hum(levels, t);
}
