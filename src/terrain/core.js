// Layered heightfield terrain: the authoritative sim. Pure data + maths (no DOM, no three.js) so it
// runs unchanged in a worker, inline on the main thread, and in node tests. See docs/terrain-design.md.
import { MATERIALS, NMAT, ROCK, SHOT } from './materials.js';
const RIP_BREAKOUT = 1; // a tooth breaks rock out to the sides as well as below it: 1 m less deep for each 1 m aside (45°)
const RIP_EFFORT = 6;
const ROCK_SCRAPE = 8; // resistance per m³ of rock an edge meets: very hard going, but the edge rides over it (at `dig` 99 it stopped a dozer dead) // resistance per m³ of rock broken by a ripper, against dig for soil (rock to a blade or bucket is `dig` 99)

export const CHUNK = 32;
const D2R = Math.PI / 180;
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2]];

const SPILL_CLEAR = 1.6; // m beyond a trench wall that a blade's spill is left
export class TerrainCore {
  /** @param {{nx:number, nz:number, cell:number, ox:number, oz:number}} cfg  ox/oz = world position of sample (0,0) */
  constructor(cfg) {
    const { nx, nz, cell, ox, oz } = cfg;
    this.cfg = cfg; this.nx = nx; this.nz = nz; this.cell = cell; this.ox = ox; this.oz = oz;
    this.area = cell * cell;
    const n = this.n = nx * nz;
    this.bed = new Float32Array(n); this.h = new Float32Array(n);
    this.nl = new Uint8Array(n); this.lm = new Uint8Array(n * 3); this.lt = new Float32Array(n * 3);
    this.dist = new Uint8Array(n); this.rut = new Float32Array(n); this.wet = new Uint8Array(n);
    this.queued = new Uint8Array(n); this.queue = new Int32Array(n); this.qHead = 0; this.qLen = 0;
    this.cnx = Math.ceil(nx / CHUNK); this.cnz = Math.ceil(nz / CHUNK);
    this.chunkDirty = new Uint8Array(this.cnx * this.cnz); this.chunkStamp = new Int32Array(this.cnx * this.cnz);
    // chunks changed since the map was built (saves hold only these): not counted until the first delivery of the whole map
    this.touched = new Uint8Array(this.cnx * this.cnz); this.tracking = false;
    this.tickNo = 0; this.awakeChunks = 0;
    this.lost = 0; this.compacted = 0; // m³
    this.relaxBudget = 40000;
    this.tal = new Float32Array(NMAT); this.talWet = new Float32Array(NMAT);
    MATERIALS.forEach((m, i) => { this.tal[i] = cell * Math.tan(m.repose * D2R); this.talWet[i] = cell * Math.tan(m.reposeWet * D2R); });
    this.nbOff = NB.map(([di, dj, d]) => [dj * nx + di, d]);
    this._vol = new Float64Array(NMAT);
  }

  // ---------------------------------------------------------------- columns
  /** Set a column from scratch (map building). layers: [[material, thickness], ...] bottom → top. */
  setColumn(c, bed, layers) {
    this.bed[c] = bed; let h = bed, n = 0;
    for (const [m, t] of layers) { if (t <= 0 || n === 3) continue; this.lm[c * 3 + n] = m; this.lt[c * 3 + n] = t; h += t; n++; }
    this.nl[c] = n; this.h[c] = h; this.dist[c] = 0; this.rut[c] = 0;
    this.chunkDirty[this.chunkOf(c)] = 1;
  }
  chunkOf(c) { return (((c / this.nx) | 0) / CHUNK | 0) * this.cnx + ((c % this.nx) / CHUNK | 0); }
  topMat(c) { const n = this.nl[c]; return n ? this.lm[c * 3 + n - 1] : ROCK; }
  _fixH(c) {
    const b = c * 3, n = this.nl[c];
    this.h[c] = this.bed[c] + (n > 0 ? this.lt[b] : 0) + (n > 1 ? this.lt[b + 1] : 0) + (n > 2 ? this.lt[b + 2] : 0);
    this.chunkDirty[this.chunkOf(c)] = 1;
  }
  /** Remove up to dh metres from the top of column c; adds removed thickness per material to out. */
  removeTop(c, dh, out) {
    const b = c * 3; let n = this.nl[c], rem = dh;
    while (rem > 1e-9 && n > 0) {
      const t = this.lt[b + n - 1], m = this.lm[b + n - 1];
      if (t <= rem) { out[m] += t; rem -= t; n--; } else { this.lt[b + n - 1] = t - rem; out[m] += rem; rem = 0; }
    }
    this.nl[c] = n; this._fixH(c);
    return dh - rem;
  }
  /** Thickness of loose material on top of column c, down to the first solid layer (rock), or all of it. */
  softAbove(c) { const b = c * 3; let s = 0; for (let k = this.nl[c] - 1; k >= 0; k--) { if (MATERIALS[this.lm[b + k]].solid) return s; s += this.lt[b + k]; } return s; }
  addTop(c, mat, dh) {
    const b = c * 3; let n = this.nl[c];
    if (n > 0 && this.lm[b + n - 1] === mat) this.lt[b + n - 1] += dh;
    else if (n > 0 && this.lt[b + n - 1] < 0.03) { this.lm[b + n - 1] = mat; this.lt[b + n - 1] += dh; } // absorb dustings
    else {
      if (n === 3) { // merge two layers to make room: the bottom two, unless the bottom is rock, which must never swallow
        // the soil above it (it did: a blade's spoil dropped on clay over rock turned 1.2 m of clay into rock)
        const q = MATERIALS[this.lm[b]].solid ? b + 1 : b;
        if (this.lt[q + 1] > this.lt[q]) this.lm[q] = this.lm[q + 1];
        this.lt[q] += this.lt[q + 1];
        if (q === b) { this.lm[b + 1] = this.lm[b + 2]; this.lt[b + 1] = this.lt[b + 2]; }
        n = 2;
      }
      this.lm[b + n] = mat; this.lt[b + n] = dh; n++;
    }
    this.nl[c] = n; this.rut[c] = 0; this._fixH(c);
  }
  wake(c) {
    if (this.queued[c]) return;
    this.queued[c] = 1; this.queue[(this.qHead + this.qLen) % this.n] = c; this.qLen++;
  }
  isBorder(i, j) { return i < 1 || j < 1 || i >= this.nx - 1 || j >= this.nz - 1; }

  // ---------------------------------------------------------------- queries
  heightAt(x, z) {
    let fi = (x - this.ox) / this.cell, fj = (z - this.oz) / this.cell;
    fi = fi < 0 ? 0 : fi > this.nx - 1.001 ? this.nx - 1.001 : fi; fj = fj < 0 ? 0 : fj > this.nz - 1.001 ? this.nz - 1.001 : fj;
    const i = fi | 0, j = fj | 0, tx = fi - i, tz = fj - j, c = j * this.nx + i, h = this.h;
    return (h[c] * (1 - tx) + h[c + 1] * tx) * (1 - tz) + (h[c + this.nx] * (1 - tx) + h[c + this.nx + 1] * tx) * tz;
  }
  cellAt(x, z) {
    const i = Math.round((x - this.ox) / this.cell), j = Math.round((z - this.oz) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }

  // ---------------------------------------------------------------- relaxation
  relax(budget = this.relaxBudget) {
    const { h, nl, lm, lt, queue, queued, nx, n, tal, talWet, wet, dist, nbOff } = this;
    const count = Math.min(this.qLen, budget), stamp = ++this.tickNo;
    let awake = 0, moved = 0;
    for (let k = 0; k < count; k++) {
      const c = queue[this.qHead]; this.qHead = (this.qHead + 1) % n; this.qLen--; queued[c] = 0;
      const i = c % nx, j = (c / nx) | 0;
      if (i < 1 || j < 1 || i >= nx - 1 || j >= this.nz - 1) continue;
      const ch = this.chunkOf(c);
      if (this.chunkStamp[ch] !== stamp) { this.chunkStamp[ch] = stamp; awake++; }
      for (let q = 0; q < 8; q++) {
        const nb = c + nbOff[q][0];
        let d = h[c] - h[nb], hi = c, lo = nb;
        if (d < 0) { d = -d; hi = nb; lo = c; }
        const nh = nl[hi];
        if (!nh) continue;
        const top = hi * 3 + nh - 1, m = lm[top];
        const ex = d - (wet[hi] ? talWet[m] : tal[m]) * nbOff[q][1];
        if (ex <= 0.004) continue;
        // never let the receiving cell be on the outer ring: that ring is the fixed map edge
        const li = lo % nx, lj = (lo / nx) | 0;
        if (li < 1 || lj < 1 || li >= nx - 1 || lj >= this.nz - 1) continue;
        let mv = ex * 0.22; if (mv > lt[top]) mv = lt[top];
        if (mv <= 0) continue;
        if (mv >= lt[top]) { nl[hi] = nh - 1; } else lt[top] -= mv;
        this._fixH(hi); this.addTop(lo, m, mv);
        dist[hi] = 255; dist[lo] = 255;
        moved += mv; this.wake(hi); this.wake(lo);
      }
    }
    this.awakeChunks = awake;
    return moved * this.area;
  }

  // ---------------------------------------------------------------- commands
  /** Clod landing: split bilinearly over the 4 surrounding samples. Returns false (and books it lost) off-map. */
  deposit(x, z, mat, vol) {
    if (vol <= 0) return true;
    const fi = (x - this.ox) / this.cell, fj = (z - this.oz) / this.cell;
    if (!(fi >= 1 && fj >= 1 && fi < this.nx - 2 && fj < this.nz - 2)) { this.lost += vol; return false; }
    const i = fi | 0, j = fj | 0, tx = fi - i, tz = fj - j, dh = vol / this.area, c = j * this.nx + i;
    const w = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz], cs = [c, c + 1, c + this.nx, c + this.nx + 1];
    for (let q = 0; q < 4; q++) if (w[q] > 1e-4) { this.addTop(cs[q], mat, dh * w[q]); this.dist[cs[q]] = 255; this.wake(cs[q]); }
      else if (w[q] > 0) { this.addTop(cs[q === 0 ? 3 : 0], mat, dh * w[q]); } // keep the crumbs: volume must add up
    return true;
  }

  /**
   * Swept cut. cmd.p0 / cmd.p1: previous and current corners [backL, backR, lipL, lipR] as flat xyz arrays (12 numbers).
   * cmd.capacity: m³ the tool's container can still take. Excess is windrowed `ahead` metres beyond the lip, and, if
   * cmd.heap is given (a blade: it has no bucket to dig a face with), only up to that many metres above the edge;
   * beyond that it spills round the ends of the edge.
   * Solid material (rock) is never taken: a bucket or blade cuts only what lies on it, and meets heavy resistance.
   * cmd.rip (a ripper tooth): breaks the rock it sweeps into shot rock where it lies, and takes nothing.
   * Returns { taken: Float64Array(NMAT) m³, pushed, resist }.
   */
  cut(cmd) {
    const { p0, p1 } = cmd, cell = this.cell, nx = this.nx, area = this.area;
    const taken = new Float64Array(NMAT), vol = this._vol;
    let cap = cmd.capacity || 0, pushed = 0, resist = 0;
    let mv = 0;
    for (let q = 0; q < 12; q += 3) mv = Math.max(mv, Math.hypot(p1[q] - p0[q], p1[q + 1] - p0[q + 1], p1[q + 2] - p0[q + 2]));
    const steps = Math.max(1, Math.min(10, Math.ceil(mv / (cell * 0.5))));
    const P = new Float64Array(12), ahead = cmd.ahead ?? 0.35, heapMax = cmd.heap || 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      for (let q = 0; q < 12; q++) P[q] = p0[q] + (p1[q] - p0[q]) * t;
      // plane through backL, backR, lipL
      const ux = P[3] - P[0], uy = P[4] - P[1], uz = P[5] - P[2], vx = P[6] - P[0], vy = P[7] - P[1], vz = P[8] - P[2];
      let nxx = uy * vz - uz * vy, nyy = uz * vx - ux * vz, nzz = ux * vy - uy * vx;
      const nlen = Math.hypot(nxx, nyy, nzz); if (nlen < 1e-9) continue;
      nxx /= nlen; nyy /= nlen; nzz /= nlen;
      if (Math.abs(nyy) < 0.12) continue; // floor is near vertical: nothing sensible to cut
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let q = 0; q < 12; q += 3) { x0 = Math.min(x0, P[q]); x1 = Math.max(x1, P[q]); z0 = Math.min(z0, P[q + 2]); z1 = Math.max(z1, P[q + 2]); }
      const i0 = Math.max(1, Math.floor((x0 - this.ox) / cell)), i1 = Math.min(nx - 2, Math.ceil((x1 - this.ox) / cell));
      const j0 = Math.max(1, Math.floor((z0 - this.oz) / cell)), j1 = Math.min(this.nz - 2, Math.ceil((z1 - this.oz) / cell));
      // 2D basis of the rectangle in xz for the inside test
      const wl = ux * ux + uz * uz, dl = vx * vx + vz * vz; if (wl < 1e-9 || dl < 1e-9) continue;
      // push direction: back → lip, horizontal
      const dlen = Math.sqrt(dl), pdx = vx / dlen, pdz = vz / dlen;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = this.ox + i * cell, z = this.oz + j * cell, rx = x - P[0], rz = z - P[2];
        const a = (rx * ux + rz * uz) / wl, b = (rx * vx + rz * vz) / dl;
        if (a < 0 || a > 1 || b < 0 || b > 1) continue;
        const c = j * nx + i, yf = P[1] - (nxx * rx + nzz * rz) / nyy;
        if (this.h[c] <= yf + 1e-4) continue;
        const soft = this.softAbove(c), reach = this.h[c] - yf - (cmd.rip ? Math.abs(a - 0.5) * Math.sqrt(wl) * RIP_BREAKOUT : 0); // (a ripper's floor is wide: the rock breaks less deep away from its line)
        if (reach <= 1e-4) continue;
        if (cmd.rip) { // a ripper: breaks the rock it reaches into shot rock, where it lies; takes nothing away
          if (reach <= soft + 1e-4) continue;
          vol.fill(0); this.removeTop(c, reach, vol);
          let broke = 0; for (let m = 1; m < NMAT; m++) if (MATERIALS[m].solid && vol[m] > 0) { broke += vol[m]; vol[m] = 0; }
          if (broke > 0) this.addTop(c, MATERIALS[ROCK].loosens || SHOT, broke);
          for (let m = 1; m < NMAT; m++) if (vol[m] > 0) this.addTop(c, m, vol[m]); // what lay on the rock goes back on top
          resist += broke * area * RIP_EFFORT; this.dist[c] = 255; this.wake(c);
          continue;
        }
        if (reach > soft) resist += Math.min(reach - soft, 0.1) * area * ROCK_SCRAPE; // scraping solid rock: it takes nothing, and the machine feels it
        if (soft <= 1e-4) continue;
        vol.fill(0);
        const got = this.removeTop(c, Math.min(reach, soft), vol); // only what lies on the rock
        if (got <= 0) continue;
        this.dist[c] = 255; this.wake(c);
        for (let m = 1; m < NMAT; m++) {
          let v = vol[m] * area; if (v <= 0) continue;
          resist += v * MATERIALS[m].dig;
          const om = MATERIALS[m].loosens || m; // cut clay comes out as loose spoil
          const take = Math.min(v, cap); if (take > 0) { taken[om] += take; cap -= take; v -= take; }
          if (v > 0) { // windrow ahead of the lip, at this cell's position across the blade
            const lx = P[6] + (P[9] - P[6]) * a, lz = P[8] + (P[11] - P[8]) * a;
            let tx = lx + pdx * ahead, tz = lz + pdz * ahead;
            // a blade holds only so high a heap: once the heap ahead stands `heap` above the cutting edge, what more
            // is cut spills round the nearer end of the blade and is left beside it as a windrow
            if (heapMax && this.heightAt(tx, tz) > P[7] + heapMax) {
              const ex = P[9] - P[6], ez = P[11] - P[8], el = Math.hypot(ex, ez) || 1, side = a < 0.5 ? -1 : 1;
              // In a trench the end of the blade is against the wall: soil left on the wall's lip slumps straight back
              // in behind the blade, the tracks climb onto it and the cut levels off into a platform. So find the
              // wall (ground standing above the heap) and leave the spill well back from its edge, as a berm.
              const sx = side * ex / el, sz = side * ez / el, bx = side < 0 ? P[6] : P[9], bz = side < 0 ? P[8] : P[11];
              let d = 0.55;
              for (let w = 0.3; w <= 1.5; w += 0.3) if (this.heightAt(bx + sx * w, bz + sz * w) > P[7] + heapMax) { d = w + SPILL_CLEAR; break; }
              tx = bx + sx * d + pdx * 0.1; tz = bz + sz * d + pdz * 0.1;
            }
            this.deposit(tx, tz, om, v); pushed += v;
          }
        }
      }
    }
    return { taken, pushed, resist };
  }

  /** Tyre/track footprint: ruts soft ground up to a material-dependent depth. load 0..1. */
  compact(x, z, r, load) {
    const cell = this.cell, vol = this._vol;
    const i0 = Math.max(1, Math.round((x - r - this.ox) / cell)), i1 = Math.min(this.nx - 2, Math.round((x + r - this.ox) / cell));
    const j0 = Math.max(1, Math.round((z - r - this.oz) / cell)), j1 = Math.min(this.nz - 2, Math.round((z + r - this.oz) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = j * this.nx + i; if (!this.nl[c]) continue;
      const sink = MATERIALS[this.topMat(c)].sink;
      if (sink) { this._sink(c, i, j, Math.ceil(r / cell) + 1, sink * load); continue; }
      const target = MATERIALS[this.topMat(c)].compaction * 0.14 * load;
      if (this.rut[c] >= target) continue;
      const want = Math.min(target - this.rut[c], 0.006);
      vol.fill(0);
      const keep = this.rut[c];
      const got = this.removeTop(c, want, vol);
      this.rut[c] = keep + got; this.compacted += got * this.area; this.dist[c] = 255;
    }
  }

  /**
   * A wheel in bog: the mud under it is squeezed out to the sides, until the wheel stands `depth` below the mud
   * around it. Nothing is lost: what leaves this cell is heaped on the four cells `ring` away, and being mud it
   * slumps back in once the wheel has gone.
   */
  _sink(c, i, j, ring, depth) {
    const nx = this.nx, around = [c - ring, c + ring, c - ring * nx, c + ring * nx].filter((q) => q >= 0 && q < this.n && this.nl[q]);
    if (!around.length) return;
    let hr = -1e9; for (const q of around) hr = Math.max(hr, this.h[q]); // the mud standing beside the rut, not the rut ahead and behind
    const want = Math.min(depth - (hr - this.h[c]), 0.15, this.lt[c * 3 + this.nl[c] - 1]); if (want <= 0.001) return; // only the mud gives way, not what is under it
    const vol = this._vol; vol.fill(0);
    const got = this.removeTop(c, want, vol); if (got <= 0) return;
    for (let m = 1; m < NMAT; m++) if (vol[m] > 0) for (const q of around) { this.addTop(q, m, vol[m] / around.length); this.dist[q] = 255; this.wake(q); }
    this.dist[c] = 255; this.wake(c);
  }

  /** Run one fixed step: apply commands, relax. Returns per-command results (null where there is none). */
  step(cmds) {
    const results = [];
    if (cmds) for (const cmd of cmds) {
      if (cmd.k === 'cut') { const r = this.cut(cmd); r.id = cmd.id; results.push(r); }
      else if (cmd.k === 'deposit') this.deposit(cmd.x, cmd.z, cmd.m, cmd.v);
      else if (cmd.k === 'compact') this.compact(cmd.x, cmd.z, cmd.r, cmd.load);
    }
    if (this.water) this.water.step(1 / 60);
    this.moved = this.relax();
    return results;
  }

  // ---------------------------------------------------------------- output
  /** Pack and clear dirty chunks: [{id, h: Float32Array(32*32), info: Uint8Array(32*32*4)}] */
  collectDirty() {
    const out = [], track = this.tracking; this.tracking = true;
    for (let id = 0; id < this.chunkDirty.length; id++) {
      if (!this.chunkDirty[id]) continue;
      this.chunkDirty[id] = 0; if (track) this.touched[id] = 1;
      out.push(this.packChunk(id));
    }
    return out;
  }
  packChunk(id) {
    const ci = id % this.cnx, cj = (id / this.cnx) | 0, hh = new Float32Array(CHUNK * CHUNK), info = new Uint8Array(CHUNK * CHUNK * 4);
    for (let j = 0; j < CHUNK; j++) {
      const gj = cj * CHUNK + j; if (gj >= this.nz) break;
      for (let i = 0; i < CHUNK; i++) {
        const gi = ci * CHUNK + i; if (gi >= this.nx) break;
        const c = gj * this.nx + gi, k = j * CHUNK + i;
        hh[k] = this.h[c];
        info[k * 4] = this.topMat(c); info[k * 4 + 1] = this.dist[c]; info[k * 4 + 2] = this.wet[c] ? 255 : 0; info[k * 4 + 3] = this.nl[c];
      }
    }
    return { id, h: hh, info };
  }
  markAllDirty() { this.chunkDirty.fill(1); }

  /**
   * Everything needed to put the ground back as it is now (game/save.js): copies, safe to keep or send.
   * Only the chunks changed since the map was built are in it (every player builds the map the same way), so a save
   * is as big as the work done, not as the map. Per chunk, CHUNK² cells of each array, in `ids` order.
   */
  snapshot() {
    const w = this.water, ids = []; for (let id = 0; id < this.touched.length; id++) if (this.touched[id] || this.chunkDirty[id] && this.tracking) ids.push(id);
    const K = CHUNK * CHUNK, m = ids.length, a = { bed: new Float32Array(m * K), nl: new Uint8Array(m * K), lm: new Uint8Array(m * K * 3), lt: new Float32Array(m * K * 3), dist: new Uint8Array(m * K), rut: new Float32Array(m * K) };
    ids.forEach((id, q) => this._eachCell(id, (c, k) => { const o = q * K + k;
      a.bed[o] = this.bed[c]; a.nl[o] = this.nl[c]; a.dist[o] = this.dist[c]; a.rut[o] = this.rut[c];
      for (let l = 0; l < 3; l++) { a.lm[o * 3 + l] = this.lm[c * 3 + l]; a.lt[o * 3 + l] = this.lt[c * 3 + l]; } }));
    return { v: 2, nx: this.nx, nz: this.nz, ids: Int32Array.from(ids), ...a, lost: this.lost, compacted: this.compacted, water: w ? w.save() : null };
  }
  _eachCell(id, fn) { const ci = id % this.cnx, cj = (id / this.cnx) | 0; let k = 0; for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++, k++) { const x = ci * CHUNK + i, z = cj * CHUNK + j; if (x < this.nx && z < this.nz) fn(z * this.nx + x, k); } }
  /**
   * Put a snapshot back. Returns false (and changes nothing) if it is for a different size of map.
   * `rebuild` puts the map back as built; it is called only if this ground has already been changed (a snapshot
   * holds only the chunks its own site changed, so the rest must be as built). Whole-map snapshots (saves from
   * before chunked ones) are still read.
   */
  restore(s, rebuild = null) {
    if (!s || s.nx !== this.nx || s.nz !== this.nz) return false;
    if (s.v === 2) {
      if (this.touched.some((t) => t)) { if (!rebuild) return false; rebuild(); }
      const K = CHUNK * CHUNK; this.touched.fill(0);
      Array.from(s.ids).forEach((id, q) => { this.touched[id] = 1; this._eachCell(id, (c, k) => { const o = q * K + k;
        this.bed[c] = s.bed[o]; this.nl[c] = s.nl[o]; this.dist[c] = s.dist[o]; this.rut[c] = s.rut[o];
        for (let l = 0; l < 3; l++) { this.lm[c * 3 + l] = s.lm[o * 3 + l]; this.lt[c * 3 + l] = s.lt[o * 3 + l]; } }); });
    } else {
      if (s.lt.length !== this.lt.length) return false;
      this.bed.set(s.bed); this.nl.set(s.nl); this.lm.set(s.lm); this.lt.set(s.lt); this.dist.set(s.dist); this.rut.set(s.rut);
      this.touched.fill(1);
    }
    this.lost = s.lost; this.compacted = s.compacted;
    for (let c = 0; c < this.n; c++) this._fixH(c);
    this.queued.fill(0); this.qHead = 0; this.qLen = 0;
    if (this.water && s.water) this.water.restore(s.water); // (water saved before tiles is not read: the river refills by itself)
    this.markAllDirty(); this.tracking = false; // the next delivery is the whole ground again, not new work
    return true;
  }

  /** Volume audit in m³: per material in the ground, plus everything booked as gone. */
  audit() {
    const byMat = new Float64Array(NMAT);
    for (let c = 0; c < this.n; c++) for (let k = 0, n = this.nl[c]; k < n; k++) byMat[this.lm[c * 3 + k]] += this.lt[c * 3 + k];
    let ground = 0;
    for (let m = 0; m < NMAT; m++) { byMat[m] *= this.area; ground += byMat[m]; }
    const washed = this.water ? this.water.washed : 0;
    return { ground, byMat: Array.from(byMat), lost: this.lost, compacted: this.compacted, washed, total: ground + this.lost + this.compacted + washed };
  }
}
