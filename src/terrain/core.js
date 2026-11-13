// Layered heightfield terrain: the authoritative sim. Pure data + maths (no DOM, no three.js) so it
// runs unchanged in a worker, inline on the main thread, and in node tests. See docs/terrain-design.md.
import { MATERIALS, NMAT, ROCK } from './materials.js';

export const CHUNK = 32;
const D2R = Math.PI / 180;
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2]];

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
  addTop(c, mat, dh) {
    const b = c * 3; let n = this.nl[c];
    if (n > 0 && this.lm[b + n - 1] === mat) this.lt[b + n - 1] += dh;
    else if (n > 0 && this.lt[b + n - 1] < 0.03) { this.lm[b + n - 1] = mat; this.lt[b + n - 1] += dh; } // absorb dustings
    else {
      if (n === 3) { // merge the two bottom layers to make room
        if (this.lt[b + 1] > this.lt[b]) this.lm[b] = this.lm[b + 1];
        this.lt[b] += this.lt[b + 1]; this.lm[b + 1] = this.lm[b + 2]; this.lt[b + 1] = this.lt[b + 2]; n = 2;
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
   * cmd.capacity: m³ the tool's container can still take. Excess is windrowed `ahead` metres beyond the lip.
   * Returns { taken: Float64Array(NMAT) m³, pushed, resist }.
   */
  cut(cmd) {
    const { p0, p1 } = cmd, cell = this.cell, nx = this.nx, area = this.area;
    const taken = new Float64Array(NMAT), vol = this._vol;
    let cap = cmd.capacity || 0, pushed = 0, resist = 0;
    let mv = 0;
    for (let q = 0; q < 12; q += 3) mv = Math.max(mv, Math.hypot(p1[q] - p0[q], p1[q + 1] - p0[q + 1], p1[q + 2] - p0[q + 2]));
    const steps = Math.max(1, Math.min(10, Math.ceil(mv / (cell * 0.5))));
    const P = new Float64Array(12), ahead = cmd.ahead ?? 0.35;
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
        vol.fill(0);
        const got = this.removeTop(c, this.h[c] - yf, vol);
        if (got <= 0) continue;
        this.dist[c] = 255; this.wake(c);
        for (let m = 1; m < NMAT; m++) {
          let v = vol[m] * area; if (v <= 0) continue;
          resist += v * MATERIALS[m].dig;
          const om = MATERIALS[m].loosens || m; // cut clay comes out as loose spoil
          const take = Math.min(v, cap); if (take > 0) { taken[om] += take; cap -= take; v -= take; }
          if (v > 0) { // windrow ahead of the lip, at this cell's position across the blade
            const lx = P[6] + (P[9] - P[6]) * a, lz = P[8] + (P[11] - P[8]) * a;
            this.deposit(lx + pdx * ahead, lz + pdz * ahead, om, v); pushed += v;
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
      const target = MATERIALS[this.topMat(c)].compaction * 0.14 * load;
      if (this.rut[c] >= target) continue;
      const want = Math.min(target - this.rut[c], 0.006);
      vol.fill(0);
      const keep = this.rut[c];
      const got = this.removeTop(c, want, vol);
      this.rut[c] = keep + got; this.compacted += got * this.area; this.dist[c] = 255;
    }
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
    const out = [];
    for (let id = 0; id < this.chunkDirty.length; id++) {
      if (!this.chunkDirty[id]) continue;
      this.chunkDirty[id] = 0;
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
