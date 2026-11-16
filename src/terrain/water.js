// Water: shallow water on a coarse grid (2×2 terrain cells) over the whole map, using the virtual-pipes scheme.
// Only where there is water does it cost anything: the grid is in TILES of TILE × TILE water cells (one terrain
// chunk each), and only active tiles are stepped. Water flowing into a dry tile wakes it in the same step (so none is
// lost); a tile that has been dry for a while goes back to sleep. So a river, a stream, a pond and later a reservoir
// cost what their wet area costs, and the rest of the valley nothing.
//
// Where water comes from and goes, from the map (maps.js):
//   river    { z, level, ... } and riverZ(x): filled at the start; a steady inflow at the west edge across the river,
//            and a free outflow at the east edge (to a fixed stage just beyond the map)
//   springs  [{ x, z, rate }] m³/s welling up at a point: a stream's source
//   ponds    [{ x, z, r, level }] filled to that level at the start (wherever the ground lies below it)
// Flowing water erodes the top material of the ground under it at a rate set by the material's erosion factor and
// carries it downstream; what leaves the map is booked as `washed`. Lives beside TerrainCore (same thread) and
// reads/writes its columns.
import { MATERIALS, NMAT } from './materials.js';

const G = 9.81;
export const TILE = 16;                 // water cells per tile side (= 32 terrain cells, one chunk)
const SLEEP = 120;                      // steps a tile must stay dry before it sleeps
// flow speed (m/s) below which a material stays put: the natural river bed is stable, a mud bank is not
const SCOUR = [9, 0.6, 0.35, 1.6, 1.0, 3.6, 9, 0.5];

export class Water {
  /** @param {import('./core.js').TerrainCore} core @param {object} map map definition (river / springs / ponds) */
  constructor(core, map) {
    this.core = core; this.map = map; const r = this.river = map.river || null;
    const k = this.k = 2, cell = this.cell = core.cell * k;        // water cell = k×k terrain cells
    this.nx = Math.floor(core.nx / k); this.nz = Math.floor(core.nz / k); this.ox = core.ox; this.oz = core.oz;
    this.i0 = 0; this.j0 = 0; // (the grid used to be a band along the river; kept for code that offsets by them)
    const n = this.n = this.nx * this.nz;
    this.d = new Float32Array(n); this.b = new Float32Array(n);
    this.fl = new Float32Array(n); this.fr = new Float32Array(n); this.fu = new Float32Array(n); this.fd = new Float32Array(n);
    this.vx = new Float32Array(n); this.vz = new Float32Array(n);
    this.tnx = Math.ceil(this.nx / TILE); this.tnz = Math.ceil(this.nz / TILE);
    this.active = new Uint8Array(this.tnx * this.tnz); this.list = []; this.dry = new Uint16Array(this.tnx * this.tnz);
    this.pinned = new Uint8Array(this.tnx * this.tnz); // sources: never sleep
    this.cleared = [];                                  // tiles put to sleep since the last pack (their wet flags and drawing to clear)
    this.inflow = r?.inflow ?? 3.0;          // m³/s at the river's west edge
    this.erodeK = r?.erodeK ?? 0.004;        // m of mud per second per m/s of flow above its scour speed
    this.outLevel = r ? r.level - (r.fall ?? 0.45) : -1e9;  // water surface just beyond the east edge
    this.springs = (map.springs || []).map((s) => ({ ...s, c: this.cellAt(s.x, s.z) }));
    this.tick = 0; this.washed = 0; this._vol = new Float64Array(NMAT); this.eroding = true;
    this.sampleBed(null);
    // the river's inflow cells: the west edge, across the river
    this.inCells = [];
    if (r) for (let j = 0; j < this.nz; j++) { const z = this.oz + (j + 0.5) * cell; if (Math.abs(z - map.riverZ(this.ox)) < (r.inWidth ?? 8)) this.inCells.push(j * this.nx); }
    // fill what starts full
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const c = j * this.nx + i, x = this.ox + (i + 0.5) * cell, z = this.oz + (j + 0.5) * cell;
      let lvl = -1e9;
      if (r && Math.abs(z - map.riverZ(x)) < 8) lvl = r.level;
      for (const p of map.ponds || []) if (Math.hypot(x - p.x, z - p.z) < p.r) lvl = Math.max(lvl, p.level);
      if (lvl > this.b[c]) { this.d[c] = lvl - this.b[c]; this.wake(this.tileOf(c)); }
    }
    for (const c of this.inCells) { const t = this.tileOf(c); this.pinned[t] = 1; this.wake(t); }
    for (const s of this.springs) { const t = this.tileOf(s.c); this.pinned[t] = 1; this.wake(t); }
    // let the flow establish before play starts, without eroding anything meanwhile
    this.eroding = false; for (let q = 0; q < (r?.warmup ?? map.waterWarmup ?? 2400); q++) this.step(1 / 60); this.eroding = true; this.tick = 0;
    this.markWet(null);
  }
  cellAt(x, z) { const i = Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.ox) / this.cell))), j = Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.oz) / this.cell))); return j * this.nx + i; }
  tileOf(c) { return ((c / this.nx / TILE) | 0) * this.tnx + (((c % this.nx) / TILE) | 0); }
  /** Start stepping tile t (its bed sampled fresh). */
  wake(t) { if (this.active[t]) return; this.active[t] = 1; this.dry[t] = 0; this.list.push(t); this.sampleBed([t]); }
  _range(t) { const ti = t % this.tnx, tj = (t / this.tnx) | 0; return [ti * TILE, tj * TILE, Math.min(this.nx, ti * TILE + TILE), Math.min(this.nz, tj * TILE + TILE)]; }
  /** Bed height per water cell from the ground: for the listed tiles, or all of them (null). */
  sampleBed(tiles) {
    const { core, k, nx, b } = this, cnx = core.nx, h = core.h;
    const one = (i0, j0, i1, j1) => { for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const t = j * k * cnx + i * k; b[j * nx + i] = (h[t] + h[t + 1] + h[t + cnx] + h[t + cnx + 1]) * 0.25; } };
    if (!tiles) one(0, 0, this.nx, this.nz); else for (const t of tiles) one(...this._range(t));
  }
  /** Wet flags on the ground under the listed tiles (null: all active ones and those just put to sleep). */
  markWet(tiles) {
    const { core, k, nx, d } = this, cnx = core.nx;
    for (const tile of tiles || [...this.list, ...this.cleared]) {
      const [i0, j0, i1, j1] = this._range(tile);
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const w = d[j * nx + i] > 0.06 ? 1 : 0, t = j * k * cnx + i * k;
        for (const c of [t, t + 1, t + cnx, t + cnx + 1]) if (core.wet[c] !== w) { core.wet[c] = w; core.chunkDirty[core.chunkOf(c)] = 1; core.wake(c); }
      }
    }
  }
  volume() { let s = 0; for (let c = 0; c < this.n; c++) s += this.d[c]; return s * this.cell * this.cell; }

  step(dt) {
    const { nx, nz, d, b, fl, fr, fu, fd, cell } = this, a2 = cell * cell, list = this.list;
    this.tick++;
    this.sampleBed(list);
    // sources: the river's inflow, spread over its wet edge cells; springs
    if (this.inCells.length) {
      let wetIn = 0; const lv = this.river.level; for (const c of this.inCells) if (b[c] < lv) wetIn++;
      if (wetIn) { const add = this.inflow * dt / (wetIn * a2); for (const c of this.inCells) if (b[c] < lv) d[c] += add; }
    }
    for (const s of this.springs) d[s.c] += s.rate * dt / a2;
    // pipes, for the cells of the tiles awake now; water pushed into a sleeping tile wakes it for the update below
    const kf = dt * cell * G, n0 = list.length;
    for (let q = 0; q < n0; q++) {
      const [i0, j0, i1, j1] = this._range(list[q]);
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const c = j * nx + i, hc = b[c] + d[c];
        let L = i > 0 ? Math.max(0, fl[c] + kf * (hc - b[c - 1] - d[c - 1])) : 0;
        let R = i < nx - 1 ? Math.max(0, fr[c] + kf * (hc - b[c + 1] - d[c + 1])) : (d[c] > 0.02 ? Math.max(0, fr[c] + kf * (hc - this.outLevel)) : 0); // east edge: a fixed stage beyond the map
        let U = j > 0 ? Math.max(0, fu[c] + kf * (hc - b[c - nx] - d[c - nx])) : 0;
        let D = j < nz - 1 ? Math.max(0, fd[c] + kf * (hc - b[c + nx] - d[c + nx])) : 0;
        const damp = 1 - Math.min(0.5, dt * (0.035 + 0.012 / Math.max(d[c], 0.03))); // bed friction, stronger in shallows
        L *= damp; R *= damp; U *= damp; D *= damp;
        const sum = (L + R + U + D) * dt, avail = d[c] * a2;
        if (sum > avail) { const s = avail / sum; L *= s; R *= s; U *= s; D *= s; }
        fl[c] = L; fr[c] = R; fu[c] = U; fd[c] = D;
        if (sum > 0) { // flowing out of its tile into a sleeping one: wake it
          if (L > 0 && i === i0 && i > 0) this.wake(this.tileOf(c - 1));
          if (R > 0 && i === i1 - 1 && i < nx - 1) this.wake(this.tileOf(c + 1));
          if (U > 0 && j === j0 && j > 0) this.wake(this.tileOf(c - nx));
          if (D > 0 && j === j1 - 1 && j < nz - 1) this.wake(this.tileOf(c + nx));
        }
      }
    }
    for (let q = 0; q < list.length; q++) {
      const t = list[q], [i0, j0, i1, j1] = this._range(t); let wet = false;
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const c = j * nx + i;
        const inL = i > 0 ? fr[c - 1] : 0, inR = i < nx - 1 ? fl[c + 1] : 0, inU = j > 0 ? fd[c - nx] : 0, inD = j < nz - 1 ? fu[c + nx] : 0;
        const dn = d[c] + dt * (inL + inR + inU + inD - fl[c] - fr[c] - fu[c] - fd[c]) / a2;
        const dm = Math.max(0.02, (d[c] + Math.max(dn, 0)) * 0.5);
        this.vx[c] = (inL - fl[c] + fr[c] - inR) * 0.5 / (cell * dm);
        this.vz[c] = (inU - fu[c] + fd[c] - inD) * 0.5 / (cell * dm);
        d[c] = dn > 0 ? dn : 0; if (d[c] > 1e-4) wet = true;
      }
      this.dry[t] = wet ? 0 : this.dry[t] + 1;
    }
    // tiles dry for long enough sleep (all their water and flow put to zero)
    for (let q = list.length - 1; q >= 0; q--) {
      const t = list[q]; if (this.pinned[t] || this.dry[t] < SLEEP) continue;
      const [i0, j0, i1, j1] = this._range(t);
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const c = j * nx + i; d[c] = fl[c] = fr[c] = fu[c] = fd[c] = this.vx[c] = this.vz[c] = 0; }
      this.active[t] = 0; list[q] = list[list.length - 1]; list.pop(); this.cleared.push(t);
    }
    if (this.eroding && this.tick % 4 === 0) { this.erode(dt * 4); this.markWet(null); if (this.cleared.length > 64) this.cleared.splice(0, this.cleared.length - 64); }
  }

  erode(dt) {
    const { core, k, nx, nz, d, vx, vz, cell } = this, cnx = core.nx, vol = this._vol;
    for (const tile of this.list) {
      const [i0, j0, i1, j1] = this._range(tile);
      for (let j = Math.max(1, j0); j < Math.min(nz - 1, j1); j++) for (let i = i0; i < i1; i++) {
        const c = j * nx + i; if (d[c] < 0.04) continue;
        const sp = Math.hypot(vx[c], vz[c]); if (sp < 0.35) continue;
        // carry one water cell downstream (two near the fastest flow)
        const hop = sp > 1.5 ? 2 : 1, ti = i + Math.round(vx[c] / sp) * hop, tj = j + Math.round(vz[c] / sp) * hop;
        const base = j * k * cnx + i * k;
        for (const t of [base, base + 1, base + cnx, base + cnx + 1]) {
          if (!core.nl[t]) continue;
          const m = core.topMat(t), over = Math.min(sp, 4) - SCOUR[m]; if (over <= 0) continue; // slower than this material's scour speed
          const dh = MATERIALS[m].erosion * this.erodeK * over * dt;
          if (dh < 1e-5) continue;
          vol.fill(0);
          const got = core.removeTop(t, dh, vol); if (got <= 0) continue;
          core.dist[t] = 255; core.wake(t);
          for (let q = 1; q < NMAT; q++) if (vol[q] > 0) {
            const v = vol[q] * core.area;
            if (ti >= nx - 1 || ti < 0 || tj < 0 || tj >= nz) { this.washed += v; continue; }
            const x = this.ox + (ti + 0.5) * cell, z = this.oz + (tj + 0.5) * cell;
            if (!core.deposit(x, z, q, v)) { core.lost -= v; this.washed += v; }
          }
        }
      }
    }
  }

  /** For the main thread: the awake tiles' water, and the tiles put to sleep since last time. All of it with full. */
  pack(full = false) {
    if (!full && this.tick % 6 !== 1) return null;
    const T2 = TILE * TILE, tiles = Int32Array.from(this.list), depth = new Float32Array(tiles.length * T2), vx = new Float32Array(tiles.length * T2), vz = new Float32Array(tiles.length * T2);
    tiles.forEach((t, q) => { const [i0, j0, i1, j1] = this._range(t); for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const c = j * this.nx + i, o = q * T2 + (j - j0) * TILE + (i - i0); depth[o] = this.d[c]; vx[o] = this.vx[c]; vz[o] = this.vz[c]; } });
    const out = { nx: this.nx, nz: this.nz, cell: this.cell, ox: this.ox, oz: this.oz, tile: TILE, full, tiles, depth, vx, vz, cleared: Int32Array.from(this.cleared) };
    this.cleared.length = 0;
    return out;
  }
  pack0() { return this.pack(true); }
  /** Saved: the water in the awake tiles. */
  save() { const p = this.pack(true); return { tiles: p.tiles, d: p.depth, washed: this.washed }; }
  restore(s) {
    if (!s?.tiles) return false;
    for (const t of [...this.list]) if (!this.pinned[t]) { const [i0, j0, i1, j1] = this._range(t); for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) this.d[j * this.nx + i] = 0; }
    for (const k of ['fl', 'fr', 'fu', 'fd', 'vx', 'vz']) this[k].fill(0);
    const T2 = TILE * TILE;
    Array.from(s.tiles).forEach((t, q) => { this.wake(t); const [i0, j0, i1, j1] = this._range(t); for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) this.d[j * this.nx + i] = s.d[q * T2 + (j - j0) * TILE + (i - i0)]; });
    this.washed = s.washed || 0; return true;
  }
}

/**
 * The main thread's copy of the water: whole-map arrays (depth, flow, bed) kept up to date from the worker's packs,
 * and the set of tiles that have water (for drawing). `apply` returns the tiles that changed.
 */
export class WaterMirror {
  constructor(p) { Object.assign(this, { nx: p.nx, nz: p.nz, cell: p.cell, ox: p.ox, oz: p.oz, tile: p.tile || TILE }); const n = this.nx * this.nz; this.depth = new Float32Array(n); this.vx = new Float32Array(n); this.vz = new Float32Array(n); this.bed = new Float32Array(n); this.wet = new Set(); this.tnx = Math.ceil(this.nx / this.tile); }
  _range(t) { const T = this.tile, ti = t % this.tnx, tj = (t / this.tnx) | 0; return [ti * T, tj * T, Math.min(this.nx, ti * T + T), Math.min(this.nz, tj * T + T)]; }
  /** @param terrain the TerrainClient (its heights give the bed) */
  apply(p, terrain) {
    const T = this.tile, T2 = T * T, changed = [];
    if (p.full) { this.depth.fill(0); this.vx.fill(0); this.vz.fill(0); for (const t of this.wet) changed.push(t); this.wet.clear(); }
    for (const t of p.cleared || []) { const [i0, j0, i1, j1] = this._range(t); for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const c = j * this.nx + i; this.depth[c] = this.vx[c] = this.vz[c] = 0; } this.wet.delete(t); changed.push(t); }
    Array.from(p.tiles).forEach((t, q) => { const [i0, j0, i1, j1] = this._range(t); for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const c = j * this.nx + i, o = q * T2 + (j - j0) * T + (i - i0); this.depth[c] = p.depth[o]; this.vx[c] = p.vx[o]; this.vz[c] = p.vz[o]; } this.wet.add(t); changed.push(t); });
    this.bedFrom(terrain, changed);
    return changed;
  }
  /** After a whole-grid update (co-op): which tiles have water, and the bed everywhere. */
  rescan(terrain) {
    this.wet.clear(); const T = this.tile;
    for (let c = 0; c < this.depth.length; c++) if (this.depth[c] > 0) { const i = c % this.nx, j = (c / this.nx) | 0; this.wet.add(((j / T) | 0) * this.tnx + ((i / T) | 0)); }
    this.bedFrom(terrain, null);
  }
  bedFrom(terrain, tiles) {
    const k = Math.round(this.cell / terrain.cell), h = terrain.h, nx = terrain.nx;
    const one = (i0, j0, i1, j1) => { for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const t = j * k * nx + i * k; this.bed[j * this.nx + i] = (h[t] + h[t + 1] + h[t + nx] + h[t + nx + 1]) * 0.25; } };
    if (!tiles) one(0, 0, this.nx, this.nz); else for (const t of new Set(tiles)) one(...this._range(t));
  }
}

export function attachWater(core, map) {
  if (!map.river && !map.springs && !map.ponds) return null;
  core.water = new Water(core, map);
  return core.water;
}
