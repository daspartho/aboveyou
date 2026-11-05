// The visitor's rough location, from the headers Vercel adds to each request. City level, no permission needed, nothing stored.
export default function handler(req, res) {
  const lat = Number(req.headers['x-vercel-ip-latitude']), lon = Number(req.headers['x-vercel-ip-longitude']);
  res.setHeader('access-control-allow-origin', 'https://partho.world');
  res.setHeader('cache-control', 'private, no-store');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(404).end();
  res.json({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });
}
