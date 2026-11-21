// adsb.fi blocks browser calls, so this asks it for the page.
// It allows one request a second from us, so every place waits its turn in one line, and each place is asked every 15 seconds.
const RADIUS_NM = 250, EVERY = 15_000, RETRY = 3_000, GAP = 1_100, FRESH = 30_000;
const areas = new Map();

let free = 0;                            // when the next request may go
function turn() {
  const wait = Math.max(0, free - Date.now());
  free = Date.now() + wait + GAP;
  return new Promise(go => setTimeout(go, wait));
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

// Each answer is the whole sky, so it replaces the last one.
function refresh(area, lat, lon) {
  if (area.busy || Date.now() < area.next) return area.busy;
  area.busy = turn().then(() => planes(lat, lon))
    .then(list => { area.planes = list; area.heard = Date.now(); area.next = Date.now() + EVERY; },
      e => {
        const wait = Math.max(RETRY, e.wait || 0);
        area.next = Date.now() + wait;
        if (e.wait) free = Math.max(free, area.next);        // told to wait, and that holds for every place
        console.log('adsb.fi', area.id, 'failed:', e.message);
        throw e;
      })
    .finally(() => { area.busy = null; });
  area.busy.catch(() => {});
  return area.busy;
}

// Visitors under the same patch of sky share one set of requests.
async function sky(lat, lon) {
  const id = `${Math.round(lat * 4) / 4},${Math.round(lon * 4) / 4}`;
  if (!areas.has(id)) areas.set(id, { id, planes: [], heard: 0, next: 0, busy: null });
  const area = areas.get(id), job = refresh(area, lat, lon);
  if (Date.now() - area.heard > FRESH && job) await job.catch(() => {});   // nothing fresh to give, so wait for the answer
  return Date.now() - area.heard < FRESH ? area.planes : null;            // null: adsb.fi has not answered, which is not the same as an empty sky
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
