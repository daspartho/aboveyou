// adsb.fi and adsb.lol block browser calls, so this fetches for the page and merges them.
// Each sees planes the other misses, and either one carries the sky if the other fails.
const RADIUS_NM = 250, FI_EVERY = 8_000, LOL_EVERY = 60_000, STALE = 90_000, FIRST_WAIT = 4_000;
const areas = new Map();

const pick = a => ({
  hex: a.hex, flight: (a.flight || '').trim(), lat: a.lat, lon: a.lon,
  alt: a.alt_baro, rate: a.baro_rate ?? 0, gs: a.gs ?? 0,
  track: a.track ?? a.true_heading ?? 0, oat: a.oat ?? null,
  type: a.t ?? null, desc: a.desc ?? null, reg: a.r ?? null, cat: a.category ?? null,
});

async function planes(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(9_000) });
  if (!r.ok) throw new Error(String(r.status));
  const d = await r.json();
  return (d.aircraft || d.ac || [])
    .filter(a => typeof a.alt_baro === 'number' && a.lat != null && a.lon != null && (a.seen_pos ?? 0) < 60)
    .map(a => ({ ...pick(a), at: Date.now() - (a.seen_pos ?? 0) * 1000 }));
}

function refresh(area, source, every, url) {
  const s = area[source];
  if (s.busy || Date.now() - s.time < every) return s.busy;
  s.busy = planes(url)
    .then(list => { for (const p of list) { const o = area.planes.get(p.hex); if (!o || p.at >= o.at) area.planes.set(p.hex, p); } })
    .catch(() => {})
    .finally(() => { s.time = Date.now(); s.busy = null; });
  return s.busy;
}

// Visitors under the same patch of sky share one set of requests.
async function sky(lat, lon) {
  const id = `${Math.round(lat * 4) / 4},${Math.round(lon * 4) / 4}`;
  if (!areas.has(id)) areas.set(id, { planes: new Map(), fi: { time: 0 }, lol: { time: 0 } });
  const area = areas.get(id), now = Date.now();
  for (const [hex, p] of area.planes) if (now - p.at > STALE) area.planes.delete(hex);
  const jobs = [
    refresh(area, 'fi', FI_EVERY, `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${RADIUS_NM}`),
    refresh(area, 'lol', LOL_EVERY, `https://api.adsb.lol/v2/point/${lat}/${lon}/${RADIUS_NM}`),
  ].filter(Boolean);
  if (!area.planes.size && jobs.length) await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, FIRST_WAIT))]);
  return [...area.planes.values()];
}

export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  res.setHeader('access-control-allow-origin', 'https://partho.world');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).end();
  res.setHeader('cache-control', 'public, s-maxage=8');
  res.json({ ac: await sky(lat, lon) });
}
