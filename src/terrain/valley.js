// The valley (docs/valley-layout.md): 192 m wide, 288 m long, falling north to south, a worn-out quarry valley.
// Today's 120 m map (dirtColumn, maps.js) sits unchanged in the middle; everything round it is built from named
// FEATURES, each a function that adjusts the ground (g, the surface height) and its layers only within its own area.
// A chapter that needs its area changed changes its feature, and nothing else moves.
//
// Coordinates as in the code: x west → east (−96…96), z north → south (−178…110). Heights above the river: yard 9 m,
// dam crest 18 m (built in chapter 6), hills about 30 m.
import { TOPSOIL, MUD, CLAY, SAND, GRAVEL, ROCK, SPOIL } from './materials.js';
import { smooth } from '../util/rng.js';
import { MAPS, dirtColumn, wob } from './maps.js';

const SQ = 60; // today's map: |x|, |z| < 60

/** A path: a polyline [[x, z], ...] with its length and bounding box, for quick distance tests. */
function path(pts) {
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]); let L = 0; const at = [0];
  for (let k = 1; k < pts.length; k++) { L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); at.push(L); }
  return { pts, L, at, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
}
/** Distance from (x, z) to path P, and how far along it the nearest point is (s, metres). Infinity beyond `reach`. */
function near(P, x, z, reach, out = {}) {
  out.d = Infinity; out.s = 0;
  if (x < P.x0 - reach || x > P.x1 + reach || z < P.z0 - reach || z > P.z1 + reach) return out;
  for (let k = 0; k < P.pts.length - 1; k++) {
    const [ax, az] = P.pts[k], [bx, bz] = P.pts[k + 1], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz), t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (len * len)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t); if (d < out.d) { out.d = d; out.s = P.at[k] + t * len; }
  }
  return out;
}
const toLine = (P, x, z, reach) => near(P, x, z, reach).d;
/** A watercourse cut to a bed falling evenly from `from` m at its start to `to` m at its end: a bed `half` m either
 *  side of the line, banks rising from it at `bank` (m per m) out to `width`. It never runs uphill, whatever it crosses. */
function course(c, P, from, to, half, bank, width) {
  const n = near(P, c.x, c.z, width); if (n.d >= width) return false;
  const bed = from + (to - from) * n.s / P.L, cap = bed + Math.max(0, n.d - half) * bank;
  if (c.g > cap) c.g = cap;
  return n.d < half + 1.5;
}
const top = (L) => L[L.length - 1];

// ---------------------------------------------------------------------------------------------------- the features
const STREAM = path([[-50, -150], [-50, -136], [-62, -112], [-72, -96], [-72, -60], [-72, 0], [-72, 22]]);   // from the spring to the river
const GULLY = path([[88, -128], [82, -104], [78, -82], [78, -40], [78, 0], [78, 24]]);                    // woodland run-off, across the road in
const ROAD_IN = path([[96, -110], [84, -96], [74, -70], [64, -52], [60, -46]]);                           // the old track, from the east edge to the yard
const QUARRY = { x0: -96, x1: -70, z0: -112, z1: -70, floor: 10.5 };
const TIP_MOUNDS = [[-84, 56, 7, 2.2], [-70, 64, 6, 1.6], [-50, 70, 5, 1.9], [-88, 78, 6, 1.4], [-46, 96, 7, 2.4], [-80, 102, 5, 1.2]];      // x, z, r, h
const SPOIL_MOUNDS = [[70, 52, 8, 2.6], [86, 62, 7, 3.0], [52, 74, 9, 2.2], [74, 82, 8, 2.8], [90, 96, 6, 1.8], [58, 100, 7, 2.4], [44, 66, 5, 1.6]];
const POND = { x: -66, z: 88, r: 9, depth: 1.4, silt: 0.6 };

export const FEATURES = [
  { name: 'head of the valley', what: 'the ground rising north of the yard to the hills, ~30 m at the north edge',
    apply(c) { if (c.z < -SQ) c.g += 7 * smooth(-64, -150, c.z) + 13 * smooth(-140, -178, c.z); } },
  { name: 'side hills', what: 'east and west of today\'s map, the valley sides rise north of the river',
    apply(c) { const ax = Math.abs(c.x); if (ax > SQ) c.g += 6 * smooth(SQ, 96, ax) * smooth(15, -20, c.z); } },
  { name: 'stream', what: 'from the spring down the west side to the river: a bed falling steadily (a valley head where the dam goes, a ravine through the terraces) (3, 6)',
    apply(c) { if (course(c, STREAM, 16, -0.6, 1.4, 0.55, 12)) c.bare = true; } },
  { name: 'gully', what: 'run-off from the woodland, down the east side to the river, across the road in (3)',
    apply(c) { if (course(c, GULLY, 16.5, -0.6, 0.6, 0.7, 5)) c.bare = true; } },
  { name: 'road in', what: 'the old track from the east edge to the yard: rutted mud, to be built up (2)',
    apply(c) { const d = toLine(ROAD_IN, c.x, c.z, 2.2); if (d < 2.2) { c.g -= 0.12 * smooth(2.2, 1, d); c.surface = MUD; c.surfaceDepth = 0.3; } } },
  { name: 'old quarry', what: 'a bowl cut into the west hillside, rock faces and floor, rubble lying about (7)',
    apply(c) { const q = QUARRY; if (c.x > q.x0 - 1 && c.x < q.x1 + 4 && c.z > q.z0 - 4 && c.z < q.z1 + 4) {
      const inside = Math.min(c.x - (q.x0 - 1), q.x1 - c.x, c.z - q.z0, q.z1 - c.z);       // metres in from the rim
      if (inside > -3) { const cut = Math.max(0, c.g - q.floor) * smooth(-3, 3, inside); c.g -= cut; if (cut > 1.2) c.rock = true; }
      const r = Math.hypot(c.x + 84, c.z + 84); if (inside > 3 && r < 4) c.add = [GRAVEL, 1.6 * (1 - r / 4)]; // old blasted stone
    } } },
  { name: 'rock under the west hill', what: 'the hill the quarry worked: rock 1.5 m down',
    apply(c) { if (c.x < -70 && c.z > -125 && c.z < -55) c.rockAt = 1.5; } },
  { name: 'old tip', what: 'south-west: mounds of rubble and spoil (3, 5)',
    apply(c) { for (const [x, z, r, h] of TIP_MOUNDS) { const d = Math.hypot(c.x - x, c.z - z); if (d < r) c.add = [GRAVEL, Math.max(c.add?.[1] || 0, h * (1 - (d / r) ** 2))]; } } },
  { name: 'silted pond', what: 'in the old tip: a hollow half full of silt, shallow water over it (3, 5)',
    apply(c) { const p = POND, d = Math.hypot(c.x - p.x, c.z - p.z); if (d < p.r) { const k = 1 - (d / p.r) ** 2; c.g -= p.depth * k; c.silt = p.silt * k; c.bare = true; } } },
  { name: 'spoil heaps', what: 'south-east: bare heaps of clay spoil, for topsoil, seed and an orchard (5)',
    apply(c) { for (const [x, z, r, h] of SPOIL_MOUNDS) { const d = Math.hypot(c.x - x, c.z - z); if (d < r) { c.spoil = Math.max(c.spoil || 0, h * (1 - (d / r) ** 2)); c.bare = true; } } } },
];

/** The ground outside today's square: today's terraces, river and sand rise carried on, then the features. */
function valleyColumn(x, z) {
  const me = MAPS.dirttown;
  const b1 = smooth(-30, -26.8, z), b2 = smooth(-12, -8.8, z), b3 = smooth(6, 8.6, z);
  const onBank = [b1, b2, b3].some((b) => b > 0.02 && b < 0.98);
  const dr = Math.abs(z - me.riverZ(x)), chan = smooth(7, 2.5, dr), south = smooth(26, 34, z);
  const out = Math.max(Math.abs(x) - SQ, Math.abs(z) - SQ, 0); // how far outside today's square
  const c = { x, z, g: 9 - 3 * b1 - 3 * b2 - 2.2 * b3 + south * 0.8 + wob(x, z) * smooth(0, 4, out) * (1 - chan) };
  for (const f of FEATURES) f.apply(c);
  const surface = c.g - chan * 1.8, bedRock = c.rockAt ? surface - c.rockAt : null;
  const bed = Math.min(surface - 0.05, c.g - 4.5 + chan * 2.2, c.rock ? surface - 6 : 1e9);
  let layers, depth = surface - bed;
  if (c.rock) layers = [[ROCK, depth]];                                       // the quarry: rock to the surface
  else if (chan > 0.97) layers = [[CLAY, depth - 0.3], [SAND, 0.3]];
  else if (chan > 0 || onBank || c.bare) layers = [[CLAY, depth]];
  else if (dr < 12) layers = [[CLAY, depth - 1.2], [MUD, 1.2]];
  else layers = [[CLAY, depth - 0.3], [TOPSOIL, 0.3]];
  if (bedRock !== null && !c.rock && layers[0][1] > c.rockAt) { const keep = surface - bedRock; layers = [[ROCK, depth - keep], [CLAY, keep - 0.3], top(layers)[0] === CLAY ? [CLAY, 0.3] : top(layers)]; }
  if (c.surface && !c.rock) { const t = top(layers); if (t[0] === TOPSOIL || t[1] <= c.surfaceDepth) t[0] = c.surface; else { t[1] -= c.surfaceDepth; layers.push([c.surface, c.surfaceDepth]); } } // the track's mud in place of the topsoil
  if (c.silt) layers.push([MUD, c.silt]);
  if (c.spoil) layers.push([SPOIL, c.spoil]);
  if (c.add) layers.push(c.add);
  return { bed, layers: layers.filter((l) => l[1] > 1e-4) };
}

export function makeValley() {
  const me = MAPS.dirttown;
  return {
    ...me,
    cfg: { nx: 768, nz: 1152, cell: 0.25, ox: -96, oz: -178 },
    river: { ...me.river, x0: -96, x1: 96 },
    springs: [{ x: -50, z: -150, rate: 0.35 }, { x: 88, z: -128, rate: 0.05 }],
    ponds: [{ x: POND.x, z: POND.z, r: POND.r - 1, level: 1.6 - POND.depth + POND.silt + 0.35 }],
    streams: [{ pts: STREAM.pts, half: 1.2, depth: 0.12 }, { pts: GULLY.pts, half: 0.5, depth: 0.05 }], // running from the start, not filling for minutes
    woods: [{ x0: 40, x1: 92, z0: -170, z1: -110, n: 90 }, { x0: -96, x1: -76, z0: -178, z1: -130, n: 30 }], // drawn by render/scenery.js
    features: FEATURES,
    build(core) {
      const { nx, nz, cell, ox, oz } = core.cfg;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = ox + i * cell, z = oz + j * cell;
        const inside = x >= -SQ && x <= SQ - cell && z >= -SQ && z <= SQ - cell;
        const col = inside ? dirtColumn(x, z, Math.min(x + SQ, z + SQ, SQ - cell - x, SQ - cell - z)) : valleyColumn(x, z);
        core.setColumn(j * nx + i, col.bed, col.layers);
      }
    },
  };
}

