import { Music } from './audio.js';
import { FAR, WORDS, play, parts, beat, hum, spread, inChord, kindOf, pitchOf, panOf } from './rules.js';

const API = 'https://ensemble-above.vercel.app';
const POLL = 10_000;
const $ = id => document.getElementById(id), rad = d => d * Math.PI / 180;
const canvas = $('c'), g = canvas.getContext('2d');
const ink = a => `rgba(130,255,170,${a})`;

let home = null, planes = new Map(), ctx = null, music = null, picked = null, muted = false;
let W = 0, H = 0, S = 0, CX = 0, CY = 0, next = null, pulling = false, pressed = null, holding = null, dialing = false, levering = false, reach = FAR, opened = 0, hover = null, deepOne = null;
function resize() {
  const d = devicePixelRatio || 1; W = innerWidth; H = innerHeight;
  const up = W / H < 1.2;                // on tall screens the note sits under the radar, on wide ones beside it
  S = up ? Math.min(W * 0.41, (H - 340) / 2.2) : Math.min(H * 0.44, (W - 385) / 2.25);
  CX = up ? W / 2 : Math.max(W / 2, 325 + S * 1.1);
  CY = up ? 100 + S * 1.1 : H / 2;
  canvas.width = W * d | 0; canvas.height = H * d | 0; g.setTransform(d, 0, 0, d, 0, 0);
}
addEventListener('resize', resize); resize();

function move(p, secs) {                // carries a plane forward from its last report
  const km = p.gs * 1.852 * secs / 3600;
  p.x = p.x0 + km * Math.sin(rad(p.track)); p.y = p.y0 + km * Math.cos(rad(p.track));
  p.d = Math.hypot(p.x, p.y); p.az = (Math.atan2(p.x, p.y) * 180 / Math.PI + 360) % 360;
}

const started = performance.now();
let audioShift = 0;                     // keeps one clock from page load through the first touch
const now = () => ctx ? ctx.currentTime + audioShift : (performance.now() - started) / 1000;
const OPENING = 1.8;                    // seconds for the sky to fill outward from you
const shown = t => [...planes.values()].filter(p => p.d <= reach && p.d / FAR <= (t - opened) / OPENING);
const heard = () => [...planes.values()].filter(p => p.d <= reach);

// The sweep's position is counted in turns, so the speed can change without it jumping.
let mark = { t: 0, turns: 0 };
const turns = t => holding ? mark.turns : mark.turns + (t - mark.t) / play.turn;
const beatTime = n => mark.t + (n / play.beats - mark.turns) * play.turn;
function retime(apply) { const t = now(); mark = { t, turns: turns(t) }; apply(); next = null; music?.setBeat(play.turn / play.beats); }

async function poll() {
  if (!home) return;
  try {
    const d = await (await fetch(`${API}/api/sky?lat=${home[0]}&lon=${home[1]}`)).json(), seen = new Set();
    for (const a of d.ac) {
      const x0 = (a.lon - home[1]) * 111.32 * Math.cos(rad(home[0])), y0 = (a.lat - home[0]) * 110.57;
      if (Math.hypot(x0, y0) > FAR) continue;
      seen.add(a.hex);
      const p = planes.get(a.hex) || { sang: -1e9, sangLoud: 0 };
      Object.assign(p, a, { x0, y0 });
      move(p, (Date.now() - a.at) / 1000);
      planes.set(a.hex, p);
    }
    for (const h of planes.keys()) if (!seen.has(h)) planes.delete(h);
  } catch {}
}

const sang = (p, at, loud, m, deep) => {
  flash[m % 12] = at + audioShift;
  if (deep) deepOne = p; else { p.sang = at + audioShift; p.sangLoud = loud; }
};

function schedule() {
  const t = now(), age = Date.now();
  for (const p of planes.values()) move(p, (age - p.at) / 1000);
  if (!music || muted || holding) { next = null; return; }
  const list = heard(), ahead = document.hidden ? 3 : 0.4;   // hidden tabs run timers once a second
  spread(list);
  if (next === null || beatTime(next) < t) next = Math.ceil(turns(t) * play.beats);
  while (beatTime(next) < t + ahead) { beat(music, next, beatTime(next) - audioShift, list, sang); next++; }
  hum(music, ctx.currentTime, list);
}

const polar = (az, r) => [CX + Math.sin(rad(az)) * r * S, CY - Math.cos(rad(az)) * r * S];

function sweep(deg) {
  const a = rad(deg - 90), edge = reach / FAR * S, fan = g.createConicGradient(a, CX, CY);
  fan.addColorStop(0, ink(0)); fan.addColorStop(0.8, ink(0)); fan.addColorStop(1, ink(0.2));
  g.fillStyle = fan; g.beginPath(); g.arc(CX, CY, edge, 0, 7); g.fill();
  g.strokeStyle = ink(0.5); g.lineWidth = 1;
  g.beginPath(); g.moveTo(CX, CY); g.lineTo(CX + Math.cos(a) * edge, CY + Math.sin(a) * edge); g.stroke();
}

// Beats are marks round the rim, and one handle on the rim sets how many.
const DIAL_FROM = 45, DIAL_SPAN = 90;   // from north-east round to south-east
const dialAz = () => DIAL_FROM + (play.beats - 4) / 92 * DIAL_SPAN;
// The speed lever stands beside the radar, or lies under it on tall screens. Push towards the word for faster.
const SLOWEST = 120, FASTEST = 2;
const track = () => W / H < 1.2 ? [CX - S * 0.55, CY + S * 1.2, CX + S * 0.55, CY + S * 1.2] : [CX + S * 1.24, CY + S * 0.5, CX + S * 1.24, CY - S * 0.5];
function lever() {
  const [ax, ay, bx, by] = track(), u = Math.log(play.turn / SLOWEST) / Math.log(FASTEST / SLOWEST), up = ax === bx;
  const along = v => [ax + (bx - ax) * v, ay + (by - ay) * v];
  g.strokeStyle = ink(0.35); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
  const [x, y] = along(u);
  g.fillStyle = ink(levering ? 1 : 0.8); up ? g.fillRect(x - 11, y - 3, 22, 6) : g.fillRect(x - 3, y - 11, 6, 22);
  g.fillStyle = ink(0.6); g.textAlign = up ? 'center' : 'left';
  g.fillText('speed', up ? bx : bx + 12, up ? by - 16 : by + 1);
  const say = `${play.turn} sec / sweep`, room = x + 16 + g.measureText(say).width < W;
  g.textAlign = up && !room ? 'right' : up ? 'left' : 'center';
  g.fillText(say, up ? x + (room ? 16 : -16) : x, up ? y + 1 : y + 20);
  g.textAlign = 'left';
}
function rim() {
  g.strokeStyle = ink(0.35); g.beginPath();
  for (let i = 0; i < play.beats; i++) {
    const [a, b] = polar(i / play.beats * 360, 1), [c, d] = polar(i / play.beats * 360, 1.018);
    g.moveTo(a, b); g.lineTo(c, d);
  }
  g.stroke();
  const [x, y] = polar(dialAz(), 1), room = x + 72 < W;   // on narrow screens the label sits above the handle
  g.fillStyle = ink(dialing ? 1 : 0.7); g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
  g.fillStyle = ink(0.6); g.textAlign = room ? 'left' : 'right';
  g.fillText(`${play.beats} beats`, room ? x + (Math.abs(dialAz() - 90) < 8 ? 30 : 10) : x + 6, room ? y + 1 : y - 12);   // clears the e
  g.textAlign = 'left';
}

function frame() {
  const t = now(), deg = (turns(t) % 1) * 360, fade = play.turn / 3;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.font = '11px ui-monospace, Menlo, monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.strokeStyle = ink(0.16); g.lineWidth = 1;
  for (const km of [100, 200, 300, 400, FAR]) { g.beginPath(); g.arc(CX, CY, km / FAR * S, 0, 7); g.stroke(); }
  g.beginPath(); g.moveTo(CX - S, CY); g.lineTo(CX + S, CY); g.moveTo(CX, CY - S); g.lineTo(CX, CY + S); g.stroke();
  g.fillStyle = ink(0.5); g.textAlign = 'center';
  ['n', 'e', 's', 'w'].forEach((l, i) => { const [x, y] = polar(i * 90, 1.05); g.fillText(l, x, y); });
  g.textAlign = 'left';
  sweep(deg); rim(); lever();
  g.font = '13px ui-monospace, "SF Mono", Menlo, monospace'; g.fillStyle = ink(1);
  g.fillText(`${shown(t).length} planes above you`, 24, 30);
  g.font = '11px ui-monospace, Menlo, monospace';
  const r = reach / FAR, [hx, hy] = polar(225, r);    // how far you are listening
  g.strokeStyle = ink(pulling ? 0.9 : 0.5); g.beginPath(); g.arc(CX, CY, r * S, 0, 7); g.stroke();
  g.fillStyle = ink(pulling ? 1 : 0.7); g.beginPath(); g.arc(hx, hy, 4, 0, 7); g.fill();
  g.fillStyle = ink(0.6); g.textAlign = 'right'; g.fillText(`${Math.round(reach)} km`, hx - 10, hy + 1); g.textAlign = 'left';
  g.fillStyle = ink(1); g.beginPath(); g.arc(CX, CY, 3, 0, 7); g.fill();
  g.fillStyle = ink(0.6); g.fillText('you', CX + 8, CY + 1);
  const edge = (t - opened) / OPENING;
  for (const p of planes.values()) {
    if (p.d / FAR > edge) continue;
    const [x, y] = polar(p.az, p.d / FAR);
    p.sx = x; p.sy = y;
    if (p === picked) { g.strokeStyle = ink(0.9); g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke(); }
    if (p === deepOne && !muted) { g.strokeStyle = ink(0.45); g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke(); }
    const since = (deg - p.az + 360) % 360 / 360 * play.turn, far = p.d > reach ? 0.25 : 1;
    const glow = since < fade ? (1 - since / fade) ** 2.2 : 0;
    const big = /A[45]/.test(p.cat || '') ? 2.6 : /A3/.test(p.cat || '') ? 1.9 : 1.3;
    const tail = p.gs * 1.852 / 30 / FAR * S;                       // where it was two minutes ago
    g.strokeStyle = ink((0.16 + glow * 0.4) * far); g.beginPath(); g.moveTo(x, y);
    g.lineTo(x - Math.sin(rad(p.track)) * tail, y + Math.cos(rad(p.track)) * tail); g.stroke();
    g.fillStyle = ink((0.55 + glow * 0.45) * far); g.beginPath(); g.arc(x, y, big, 0, 7); g.fill();
    if (t >= p.sang && t - p.sang < 1.2) {   // a ring opens on the plane you just heard
      const a = (t - p.sang) / 1.2;
      g.strokeStyle = ink((1 - a) * (0.15 + p.sangLoud * 0.75)); g.beginPath(); g.arc(x, y, 4 + a * (6 + p.sangLoud * 16), 0, 7); g.stroke();
    }
  }
  if (hover && hover.sx != null) {       // the plane under the hand says what it is
    const label = `${hover.flight || hover.reg || hover.hex}  ${(Math.round(hover.alt / 100) * 100).toLocaleString('en')} ft  ${Math.round(hover.gs * 1.852)} km/h`;
    g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(hover.sx + 8, hover.sy - 8, g.measureText(label).width + 8, 16);
    g.fillStyle = ink(1); g.fillText(label, hover.sx + 12, hover.sy);
  }
  for (let i = 0; i < 12; i++) {         // the keys light as the planes play them; the chord's keys stay brighter
    const on = play.keys.has(i), f = t >= flash[i] ? Math.max(0, 1 - (t - flash[i]) / 0.8) : 0;
    const a = (inChord(i) ? 0.75 : 0.4) + 0.25 * f;   // solid colour, so a black key hides the white keys behind it
    keys[i].style.background = on ? `rgb(${130 * a},${255 * a},${170 * a})` : '';
  }
  requestAnimationFrame(frame);
}

function nearest(x, y) {
  let best = null, gap = 22;
  for (const p of planes.values()) { if (p.sx == null) continue; const d = Math.hypot(p.sx - x, p.sy - y); if (d < gap) { gap = d; best = p; } }
  return best;
}
const handPlays = p => {                 // a plane under your hand plays its note, like a key
  if (!music || muted || p.d > reach || ctx.currentTime - (p.touched ?? -9) < 0.5) return;
  p.touched = ctx.currentTime;
  music.strike(kindOf(p), pitchOf(p), ctx.currentTime, 0.3, panOf(p));
  sang(p, ctx.currentTime, 1, pitchOf(p));
};
const onRing = e => Math.abs(Math.hypot(e.clientX - CX, e.clientY - CY) / S - reach / FAR) < 0.03;
const aim = e => (Math.atan2(e.clientX - CX, CY - e.clientY) * 180 / Math.PI + 360) % 360;
const onDial = e => { const [x, y] = polar(dialAz(), 1); return Math.hypot(e.clientX - x, e.clientY - y) < 16; };
const onTrack = e => {                   // how far along the lever the hand is, 0 to 1
  const [ax, ay, bx, by] = track();
  return ((e.clientX - ax) * (bx - ax) + (e.clientY - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2);
};
const onLever = e => {
  const [ax, ay, bx, by] = track(), u = onTrack(e);
  return u > -0.08 && u < 1.08 && Math.hypot(e.clientX - (ax + (bx - ax) * u), e.clientY - (ay + (by - ay) * u)) < 18;
};
const inRadar = e => Math.hypot(e.clientX - CX, e.clientY - CY) < S;
// Press inside the radar and the sweep comes to your hand. It plays what it crosses, then carries on.
function turnSweep(e) {
  const to = aim(e), step = ((to - holding.deg + 540) % 360) - 180;
  if (music && !muted) for (const p of heard()) {
    const past = ((p.az - holding.deg + 540) % 360) - 180;
    if (step && past / step > 0 && past / step <= 1) handPlays(p);
  }
  holding.deg = to; mark = { t: now(), turns: to / 360 };
}
function pushLever(e) {
  const v = Math.round(SLOWEST * (FASTEST / SLOWEST) ** Math.min(1, Math.max(0, onTrack(e))));
  if (v !== play.turn) retime(() => { play.turn = v; });
}
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  if (onDial(e)) { dialing = true; return; }
  if (onLever(e)) { levering = true; pushLever(e); return; }
  if (onRing(e)) { pulling = true; return; }
  if (inRadar(e)) pressed = [e.clientX, e.clientY];
  choose(e.clientX, e.clientY);
  const p = nearest(e.clientX, e.clientY); if (p) handPlays(p);
});
canvas.addEventListener('pointermove', e => {
  canvas.style.cursor = pulling || dialing || onDial(e) || onRing(e) ? 'ew-resize' : levering || onLever(e) ? 'grab' : holding ? 'grabbing' : inRadar(e) ? 'grab' : 'default';
  if (pressed && !holding && Math.hypot(e.clientX - pressed[0], e.clientY - pressed[1]) > 6) {
    holding = { deg: aim(e) }; mark = { t: now(), turns: holding.deg / 360 };
  }
  if (levering) pushLever(e);
  else if (holding) turnSweep(e);
  else if (dialing) {
    const n = 4 + Math.round(Math.min(1, Math.max(0, (aim(e) - DIAL_FROM) / DIAL_SPAN)) * 23) * 4;
    if (n !== play.beats) { retime(() => { play.beats = n; }); if (music && !muted) music.strike('tiny', 76, ctx.currentTime, 0.12, 0); }
  } else if (pulling) {
    reach = Math.max(40, Math.min(FAR, Math.hypot(e.clientX - CX, e.clientY - CY) / S * FAR));
  } else {
    hover = nearest(e.clientX, e.clientY);
  }
});
const letGo = () => {
  pulling = dialing = levering = false; pressed = null;
  if (!holding) return;
  mark = { t: now(), turns: holding.deg / 360 }; holding = null; next = null;
};
canvas.addEventListener('pointerup', letGo); canvas.addEventListener('pointercancel', letGo);

function card(p, route) {
  const motion = Math.abs(p.rate) < 300 ? 'level' : p.rate > 0 ? 'climbing' : 'descending';
  $('card').textContent = [
    [route?.airline, p.flight].filter(Boolean).join(' ').toLowerCase() || p.reg?.toLowerCase() || p.hex,
    (p.desc || p.type || '').toLowerCase(),
    route?.path,
    `${(Math.round(p.alt / 100) * 100).toLocaleString('en')} ft, ${motion}`,
    `${Math.round(p.gs * 1.852)} km/h, ${Math.round(p.d)} km from you`,
    p.oat != null ? `${p.oat}°c outside` : null,
  ].filter(Boolean).join('\n');
  $('card').hidden = false;
}

// A route only shows if it fits where the plane really is: about 1 in 5 lookups is out of date.
function routeFits(p, o, e) {
  const R = 6371, arc = (a, b, c, d) => 2 * Math.asin(Math.sqrt(Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2));
  const bearing = (a, b, c, d) => Math.atan2(Math.sin(rad(d - b)) * Math.cos(rad(c)), Math.cos(rad(a)) * Math.sin(rad(c)) - Math.sin(rad(a)) * Math.cos(rad(c)) * Math.cos(rad(d - b)));
  const off = Math.abs(Math.asin(Math.sin(arc(o.latitude, o.longitude, p.lat, p.lon)) * Math.sin(bearing(o.latitude, o.longitude, p.lat, p.lon) - bearing(o.latitude, o.longitude, e.latitude, e.longitude)))) * R;
  const turn = Math.abs(((bearing(p.lat, p.lon, e.latitude, e.longitude) * 180 / Math.PI - p.track + 180) % 360 + 360) % 360 - 180);
  return off < 200 && (turn < 60 || arc(p.lat, p.lon, e.latitude, e.longitude) * R < 200 || arc(p.lat, p.lon, o.latitude, o.longitude) * R < 200);
}

async function choose(x, y) {
  const best = nearest(x, y);
  picked = best;
  if (!best) { $('card').hidden = true; return; }
  card(best);
  if (!best.flight) return;
  try {
    const r = (await (await fetch(`https://api.adsbdb.com/v0/callsign/${best.flight}`)).json()).response?.flightroute;
    if (picked !== best || !r) return;
    card(best, { airline: r.airline?.name, path: routeFits(best, r.origin, r.destination) ? `${r.origin.municipality} to ${r.destination.municipality}`.toLowerCase() : null });
  } catch {}
}

function go(lat, lon) { home = [lat, lon]; opened = now() + 0.4; poll(); }

async function locate() {
  try {                                  // rough location from the connection, so no permission prompt
    const r = await fetch(`${API}/api/where`);
    if (r.ok) { const q = await r.json(); return go(q.lat, q.lon); }
  } catch {}
  go(28.57, 77.32);                      // if that fails, a sky to show anyway
}

// The note on the page is also its controls: every marked word can be changed.
for (const el of document.querySelectorAll('[data-rule]')) el.onclick = () => {
  const list = WORDS[el.dataset.rule], word = list[(list.indexOf(play[el.dataset.rule]) + 1) % list.length];
  play[el.dataset.rule] = word; el.textContent = word;
};

// A line that describes a part of the music switches that part off and on.
for (const el of document.querySelectorAll('[data-part]')) el.onclick = e => {
  if (e.target.dataset.rule) return;
  const k = el.dataset.part; parts[k] = !parts[k]; el.classList.toggle('off', !parts[k]);
};

const keys = [], flash = new Array(12).fill(-9);
{                                        // one octave of a piano. A key that is off can't be played by any plane.
  const whites = [0, 2, 4, 5, 7, 9, 11], blacks = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };
  for (let i = 0; i < 12; i++) {
    const b = document.createElement('button'), black = i in blacks;
    b.className = black ? 'black' : 'white';
    b.style.left = (black ? (blacks[i] + 1) * 24 - 7 : whites.indexOf(i) * 24) + 'px';
    b.onclick = () => {
      if (play.keys.has(i)) { if (play.keys.size > 1) play.keys.delete(i); }
      else { play.keys.add(i); if (music && !muted) { music.strike('narrow', 60 + i, ctx.currentTime, 0.25, 0); flash[i] = now(); } }
    };
    keys[i] = b; $('keys').append(b);
  }
}

$('sound').onclick = () => {
  if (ctx) { muted = !muted; music.mute(muted); $('sound').textContent = muted ? 'listen' : 'stop listening'; return; }
  const t = now();
  ctx = new AudioContext(); ctx.resume(); audioShift = t - ctx.currentTime;
  music = new Music(ctx); music.setBeat(play.turn / play.beats);
  $('sound').textContent = 'stop listening'; $('note').hidden = false;
};

locate();
setInterval(poll, POLL); setInterval(schedule, 250);
requestAnimationFrame(frame);
