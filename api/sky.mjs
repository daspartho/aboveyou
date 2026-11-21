// adsb.fi blocks browser calls, so this asks it for the page. The rules:
// A place shows its latest sky from adsb.fi until a new one arrives. A failed request keeps the last sky, unless that sky is over
// a minute old, then there is nothing to show; a long line alone never takes a sky away.
// All places share one line, a request at a time, spaced by adsb.fi's limit of one a second.
// A new place's first request goes to the front; every later one, including a retry after a failure, waits its normal turn, so failures never crowd out the rest.
// Each place asks again EVERY after its last answer, the pace the page asks at;
// with more places in the line, turns come round later, and that is all crowding does.
// A place nobody has asked about for a minute is closed. When adsb.fi says wait, everything waits.
const RADIUS_NM = 250, EVERY = 15_000, GAP = 1_100, CURRENT = 60_000, CLOSE = 60_000;
const areas = new Map();

const firsts = [], rest = [];             // the line: new places' first requests, in the order they came, then everyone else's
let free = 0, ticking = false;
const listened = area => area.waiting > 0 || Date.now() - area.asked <= CLOSE;   // someone waiting for an answer is listening
function turn(area, first) {             // resolves true when it is this place's turn, false if nobody is listening there anymore
  return new Promise(go => { (first ? firsts : rest).push({ area, go }); tick(); });
}
function tick() {
  if (ticking || !(firsts.length || rest.length)) return;
  ticking = true;
  setTimeout(() => {
    ticking = false;
    if (Date.now() < free) return tick();                // told to wait in the meantime
    const next = firsts.shift() || rest.shift();
    if (!listened(next.area)) { next.go(false); return tick(); }   // skipped without using a turn
    free = Date.now() + GAP; next.go(true); tick();
  }, Math.max(0, free - Date.now()));
}

const pick = a => ({
  hex: a.hex, flight: (a.flight || '').trim(), lat: a.lat, lon: a.lon,
  alt: a.alt_baro, rate: a.baro_rate ?? 0, gs: a.gs ?? 0,
  track: a.track ?? a.true_heading ?? 0, oat: a.oat ?? null,
  type: a.t ?? null, desc: a.desc ?? null, reg: a.r ?? null, cat: a.category ?? null,
});

async function planes(lat, lon) {
  const r = await fetch(`https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${RADIUS_NM}`, { signal: AbortSignal.timeout(9_000) });
  if (!r.ok) throw Object.assign(new Error(String(r.status)), { wait: Number(r.headers.get('retry-after')) * 1000 || 0 });
  const d = await r.json();
  return (d.aircraft || [])
    .filter(a => typeof a.alt_baro === 'number' && a.lat != null && a.lon != null && (a.seen_pos ?? 0) < 60)
    .map(a => ({ ...pick(a), at: Date.now() - (a.seen_pos ?? 0) * 1000 }));
}

function refresh(area) {
  if (area.busy || (area.sky && !area.failing && Date.now() < area.next)) return area.busy;
  const first = !area.tried; area.tried = true;
  area.busy = turn(area, first).then(go => go ? planes(area.lat, area.lon) : Promise.reject(Object.assign(new Error('nobody listening'), { left: true })))
    .then(list => { area.sky = list; area.heard = Date.now(); area.failing = false; area.next = Date.now() + EVERY; },
      e => {
        if (e.left) throw e;
        area.failing = true;
        if (e.wait) free = Math.max(free, Date.now() + e.wait);   // told to wait, and that holds for every place
        console.log('adsb.fi', area.id, 'failed:', e.message);
        throw e;
      })
    .finally(() => { area.busy = null; });
  area.busy.catch(() => {});
  return area.busy;
}

// Visitors under the same patch of sky share one place. It is asked from where its first visitor is,
// which is usually where everyone in that city is, since locations from a connection are a city's middle.
async function sky(lat, lon) {
  const now = Date.now(), id = `${Math.round(lat * 4) / 4},${Math.round(lon * 4) / 4}`;
  for (const [k, a] of areas) if (!a.busy && !listened(a)) areas.delete(k);   // nobody listening there anymore, and nothing waiting in line
  if (!areas.has(id)) areas.set(id, { id, lat, lon, sky: null, heard: 0, failing: false, tried: false, waiting: 0, next: 0, busy: null, asked: now });
  const area = areas.get(id), fresh = !area.tried;
  area.asked = now;
  const job = refresh(area);
  if (fresh && job) { area.waiting++; await job.catch(() => {}); area.waiting--; }   // a newcomer is first in line, so wait for its answer
  if (!area.sky || (area.failing && Date.now() - area.heard > CURRENT)) return null;   // no sky to give, which is not the same as an empty sky
  return area.sky;
}

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  res.setHeader('access-control-allow-origin', 'https://partho.world');
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return res.status(400).end();
  const ac = await sky(lat, lon);
  res.setHeader('cache-control', ac ? 'public, s-maxage=8' : 'no-store');
  if (!ac) return res.status(503).end();
  res.json({ ac });
}
