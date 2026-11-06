// The coast, as lines of [lat, lon], read from OpenStreetMap vector tiles at the zoom where they carry OpenStreetMap's own coastline.
const ZOOM = 6;
const tileOf = (lat, lon, n = 2 ** ZOOM) => [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)];
const place = (tx, ty, x, y, size, n = 2 ** ZOOM) => [Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + y / size) / n))) * 180 / Math.PI, (tx + x / size) / n * 360 - 180];

// The smallest reader of the vector tile format that gets at what is needed here: fields of a protocol buffer message.
function varint(b, at) {
  let v = 0, m = 1, c;
  do { c = b[at++]; v += (c & 127) * m; m *= 128; } while (c > 127);
  return [v, at];
}
function fields(b) {
  const out = [];
  for (let at = 0, tag, v; at < b.length;) {
    [tag, at] = varint(b, at);
    const id = tag >> 3, kind = tag & 7;
    if (kind === 0) { [v, at] = varint(b, at); out.push([id, v]); }
    else if (kind === 2) { [v, at] = varint(b, at); out.push([id, b.subarray(at, at + v)]); at += v; }
    else at += kind === 1 ? 8 : 4;
  }
  return out;
}
function numbers(b) {
  const out = [];
  for (let at = 0, v; at < b.length;) { [v, at] = varint(b, at); out.push(v); }
  return out;
}
const text = b => new TextDecoder().decode(b);

function oceanLines(bytes, tx, ty) {
  const lines = [];
  for (const [id, layer] of fields(bytes)) {
    if (id !== 3) continue;
    const f = fields(layer), get = k => f.filter(x => x[0] === k).map(x => x[1]);
    if (text(get(1)[0]) !== 'water') continue;
    const keys = get(3).map(text), values = get(4).map(v => { const s = fields(v).find(x => x[0] === 1); return s && text(s[1]); }), size = get(5)[0] ?? 4096;
    for (const feature of get(2)) {
      const g = fields(feature), tags = numbers(g.find(x => x[0] === 2)?.[1] ?? []);
      let ocean = false;
      for (let i = 0; i < tags.length; i += 2) if (keys[tags[i]] === 'class' && values[tags[i + 1]] === 'ocean') ocean = true;
      if (!ocean) continue;
      const cmd = numbers(g.find(x => x[0] === 4)[1]), zig = v => (v >> 1) ^ -(v & 1);
      let x = 0, y = 0, line = [];
      const inside = () => x > 0 && x < size && y > 0 && y < size;      // what lies on a tile's edge is the cut, not the coast
      const end = () => { if (line.length > 1) lines.push(line); line = []; };
      for (let i = 0; i < cmd.length;) {
        const c = cmd[i] & 7, count = cmd[i++] >> 3;
        if (c === 7) { end(); continue; }
        for (let k = 0; k < count; k++) {
          x += zig(cmd[i++]); y += zig(cmd[i++]);
          if (c === 1) end();
          if (inside()) line.push(place(tx, ty, x, y, size)); else end();
        }
      }
      end();
    }
  }
  return lines;
}

export async function coastAround(lat, lon, km) {
  const dlat = km / 110.57, dlon = km / (111.32 * Math.cos(lat * Math.PI / 180));
  const [x0, y0] = tileOf(Math.min(lat + dlat, 85), lon - dlon), [x1, y1] = tileOf(Math.max(lat - dlat, -85), lon + dlon);
  const { tiles: [url] } = await (await fetch('https://tiles.openfreemap.org/planet')).json(), jobs = [], n = 2 ** ZOOM;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const wrap = (x % n + n) % n;
    jobs.push(fetch(url.replace('{z}', ZOOM).replace('{x}', wrap).replace('{y}', y)).then(r => r.ok ? r.arrayBuffer() : null).then(b => b ? oceanLines(new Uint8Array(b), wrap, y) : []));
  }
  return (await Promise.all(jobs)).flat();
}
