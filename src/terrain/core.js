// Layered heightfield terrain: the authoritative sim. Pure data + maths (no DOM, no three.js) so it
// runs unchanged in a worker, inline on the main thread, and in node tests. See docs/terrain-design.md.
import { MATERIALS, NMAT, ROCK, SHOT } from './materials.js';
const RIP_BREAKOUT = 1; // a tooth breaks rock out to the sides as well as below it: 1 m less deep for each 1 m aside (45°)
const RIP_EFFORT = 6;
const ROCK_SCRAPE = 8; // resistance per m³ of rock an edge meets: very hard going, but the edge rides over it (at `dig` 99 it stopped a dozer dead) // resistance per m³ of rock broken by a ripper, against dig for soil (rock to a blade or bucket is `dig` 99)

export const CHUNK = 32;
const D2R = Math.PI / 180;
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, -1, Math.SQRT2]];

// A blade (a cut with cmd.heap: the height of its top above the cutting edge) pushes what it cuts against its face, and
// while it is there the ground cannot flow through it: the heap slumps forward and round its ends, so windrows form at
// the ends by repose and the walls of a slot hold the load. See docs/blade-soil.md.
const FACE_OFF = 0.2;    // m beyond the lip that cut soil is put: the cells against the blade's face
const FACE_NEAR = 0.6;   // share of it in the cell against the face; the rest goes in the cell beyond
const FRESH_AGE = 30;    // ticks: soil a blade put down more recently than this is its own heap being shoved along, not new cutting
const HEAP_REACH = 1.6;  // × blade height: how far ahead the heap a blade carries can reach (a full straight blade's heap, ISO 9246)
// Pushing is a force, not work done per metre: a loaded blade holds the machine back however slowly it creeps (it fades
// only near a standstill, so a stalled machine is not pushed backwards). Resistance per second:
const LOAD_K = 2;        // per m³ of heap carried (dragging the load: soil on soil)
const FACE_K = 3;        // per m of blade, per m² of soil standing against the face (the wedge driven ahead of it goes as height², FEE)
const CREEP = 0.15;      // m/s: below about this the push fades
const SPILL_RATE = 0.12; // share a tick of the soil standing above the blade's top that moves along it toward the ends
const OVER_TOP = 0.4;    // m above the blade's top that soil may stand against it before it topples over the top
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
    this.wallT = new Int32Array(n);              // tick in which a blade stands over this cell
    this.wallY = new Float32Array(n);            // and the height of its cutting edge there: relaxation fills the cell no higher
    this.pushT = new Int32Array(n).fill(-1e6);   // tick in which a blade's heap last reached this cell
    this.pushB = new Float32Array(n);            // and the ground's height under that heap: what is cut below it is new ground
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
  /** Soil from a blade's heap is about to land on c (in tick t): note where the ground under it was. */
  _heaped(c, t) { if (t - this.pushT[c] >= FRESH_AGE) this.pushB[c] = this.h[c]; this.pushT[c] = t; }
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
    const { h, nl, lm, lt, queue, queued, nx, n, tal, talWet, wet, dist, nbOff, wallT, wallY, pushT, pushB } = this;
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
        // A blade stands over the lower cell: soil may run in under its edge (a hollow it is passing over fills to the
        // edge, which is how it grades), but no higher: above that the blade is in the way
        const room = wallT[lo] === stamp ? wallY[lo] - h[lo] : 1e9; if (room <= 0.002) continue;
        // never let the receiving cell be on the outer ring: that ring is the fixed map edge
        const li = lo % nx, lj = (lo / nx) | 0;
        if (li < 1 || lj < 1 || li >= nx - 1 || lj >= this.nz - 1) continue;
        let mv = ex * 0.22; if (mv > lt[top]) mv = lt[top]; if (mv > room) mv = room;
        if (mv <= 0) continue;
        if (mv >= lt[top]) { nl[hi] = nh - 1; } else lt[top] -= mv;
        if (stamp - pushT[hi] < FRESH_AGE) this._heaped(lo, stamp); // a blade's heap spreading: still its heap
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
   * cmd.heap (a blade: it has no bucket): the height of the blade's top above its edge. A blade puts what it cuts
   * against its face instead, stands as a wall the ground cannot flow through for this step, and holds no more than its
   * own height: soil above that runs along the face and off the nearer end (see _bladeFace). It also reports what it is
   * carrying (load, face) and how much of what it cut was new ground rather than its own heap (fresh); its resistance is
   * the new ground cut, the load dragged and the wedge driven ahead of the face (docs/blade-soil.md).
   * Solid material (rock) is never taken: a bucket or blade cuts only what lies on it, and meets heavy resistance.
   * cmd.rip (a ripper tooth): breaks the rock it sweeps into shot rock where it lies, and takes nothing.
   * Returns { taken: Float64Array(NMAT) m³, pushed, resist, dig (resist from cutting alone), fresh } and for a blade also
   * { load, face, faceL, faceR, spill, width }.
   */
  cut(cmd) {
    const { p0, p1 } = cmd, cell = this.cell, nx = this.nx, area = this.area;
    const taken = new Float64Array(NMAT), vol = this._vol;
    let cap = cmd.capacity || 0, pushed = 0, resist = 0, fresh = 0;
    const H = cmd.heap || 0, blade = H > 0 && !cmd.rip, wall = this.tickNo + 1, now = this.tickNo;
    let mv = 0;
    for (let q = 0; q < 12; q += 3) mv = Math.max(mv, Math.hypot(p1[q] - p0[q], p1[q + 1] - p0[q + 1], p1[q + 2] - p0[q + 2]));
    const steps = Math.max(1, Math.min(10, Math.ceil(mv / (cell * 0.5))));
    const P = new Float64Array(12), ahead = cmd.ahead ?? 0.35;
    let pdx = 0, pdz = 0;
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
      const dlen = Math.sqrt(dl); pdx = vx / dlen; pdz = vz / dlen;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = this.ox + i * cell, z = this.oz + j * cell, rx = x - P[0], rz = z - P[2];
        const a = (rx * ux + rz * uz) / wl, b = (rx * vx + rz * vz) / dl;
        if (a < 0 || a > 1 || b < 0 || b > 1) continue;
        const c = j * nx + i, yf = P[1] - (nxx * rx + nzz * rz) / nyy;
        if (blade) { this.wallT[c] = wall; this.wallY[c] = yf; }
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
        // Of what came off, only what lay below the blade's own heap is new ground: the heap is just being shoved along again
        const newK = blade && now - this.pushT[c] < FRESH_AGE ? Math.max(0, Math.min(got, this.pushB[c] - this.h[c])) / got : 1;
        for (let m = 1; m < NMAT; m++) {
          let v = vol[m] * area; if (v <= 0) continue;
          resist += v * newK * MATERIALS[m].dig; fresh += v * newK;
          const om = MATERIALS[m].loosens || m; // cut clay comes out as loose spoil
          const take = Math.min(v, cap); if (take > 0) { taken[om] += take; cap -= take; v -= take; }
          if (v <= 0) continue;
          const lx = P[6] + (P[9] - P[6]) * a, lz = P[8] + (P[11] - P[8]) * a; // the lip, at this cell's position across it
          if (blade) { // against the face, at the same place across the blade (kept half a cell in from its ends, so it is swept again)
            // Spread over the cell against the face and the one beyond: as the edge crosses a row of cells it sweeps the whole
            // row it was pushing into the next, and in one cell that row would stand up as a ridge for a moment.
            const m0 = cell * 0.5 / Math.sqrt(wl), aa = a < m0 ? m0 : a > 1 - m0 ? 1 - m0 : a, fx0 = P[6] + (P[9] - P[6]) * aa, fz0 = P[8] + (P[11] - P[8]) * aa;
            const t = this.cellAt(fx0 + pdx * FACE_OFF, fz0 + pdz * FACE_OFF), t2 = this.cellAt(fx0 + pdx * (FACE_OFF + cell), fz0 + pdz * (FACE_OFF + cell));
            if (t >= 0 && !this.isBorder(t % nx, (t / nx) | 0)) {
              const two = t2 >= 0 && t2 !== t && !this.isBorder(t2 % nx, (t2 / nx) | 0), k = two ? FACE_NEAR : 1;
              this._heaped(t, now); this.addTop(t, om, v * k / area); this.dist[t] = 255; this.wake(t);
              if (two) { this._heaped(t2, now); this.addTop(t2, om, v * (1 - k) / area); this.dist[t2] = 255; this.wake(t2); }
              pushed += v; continue;
            }
          }
          this.deposit(lx + pdx * ahead, lz + pdz * ahead, om, v); pushed += v; // windrowed ahead of the lip
        }
      }
    }
    if (!blade) return { taken, pushed, resist, fresh, dig: resist };
    const f = this._bladeFace(p1, H, pdx, pdz), dig = resist; // dig: cutting alone (what resists the edge going deeper)
    // pushing: the load it carries and the wedge ahead of its face, while the edge goes forward (one tick is 1/60 s)
    const v = Math.max(0, ((p1[6] + p1[9] - p0[6] - p0[9]) * pdx + (p1[8] + p1[11] - p0[8] - p0[11]) * pdz) / 2) * 60;
    resist += (LOAD_K * f.load + FACE_K * f.width * f.face * f.face) * v / (v + CREEP) / 60;
    return { taken, pushed, resist, dig, fresh, ...f };
  }

  /**
   * After a blade's cut. Soil against its face never stands higher than the blade's top: the surplus runs along the face
   * and off the nearer end, where the ground beside it takes it and relaxation lays it out as a windrow. If the ground
   * beyond that end stands above the blade's top (the wall of a slot) it cannot go: it stays, and the blade is full.
   * Then measure the heap in front: `load` m³ above the cutting edge out to HEAP_REACH × height, `face` the mean height
   * of soil against the face above the edge (faceL / faceR at the ends), `spill` m³ put off the ends, `over` m³ over the top.
   */
  _bladeFace(P, H, pdx, pdz) {
    const cell = this.cell, ux = P[9] - P[6], uz = P[11] - P[8], W = Math.hypot(ux, uz), h = this.h, vol = this._vol;
    const out = { load: 0, face: 0, faceL: 0, faceR: 0, spill: 0, over: 0, width: W };
    if (W < 1e-6 || !(pdx || pdz)) return out;
    const ax = ux / W, az = uz / W, n = Math.max(2, Math.round(W / cell)), cs = [], ys = [];
    // The blade's ends hold the heap in: all it cuts stays in front of it until it stands as high as the blade, and only
    // then spills off the ends (Rubinstein & Shmulevich; spreading along a blade is slow, Sauret et al.). So the strip just
    // beyond each end, from the back of the blade to 0.7 m past its edge (the heap in front moves with it), takes nothing
    // from relaxation this step; the surplus below is put there instead, and runs out from there.
    const back = Math.hypot(P[6] - P[0], P[8] - P[2]);
    for (const side of [-1, 1]) {
      const ex = side < 0 ? P[6] : P[9], ez = side < 0 ? P[8] : P[11];
      for (let s = -back; s <= FACE_OFF + 2 * cell + 1e-6; s += cell * 0.5) for (const w of [cell * 0.5, cell]) {
        const b = this.cellAt(ex + side * ax * w + pdx * s, ez + side * az * w + pdz * s);
        if (b >= 0 && this.wallT[b] !== this.tickNo + 1) { this.wallT[b] = this.tickNo + 1; this.wallY[b] = -1e9; }
      }
    }
    const at = (a, s) => this.cellAt(P[6] + ux * a + pdx * s, P[8] + uz * a + pdz * s);
    for (let k = 0; k < n; k++) { const a = (k + 0.5) / n; cs.push(at(a, FACE_OFF)); ys.push(P[7] + (P[10] - P[7]) * a); }
    // surplus off each end, from the middle outward
    const mid = n >> 1;
    for (const side of [-1, 1]) {
      const idx = []; if (side < 0) for (let k = mid - 1; k >= 0; k--) idx.push(k); else for (let k = mid; k < n; k++) idx.push(k);
      const ex = side < 0 ? P[6] : P[9], ez = side < 0 ? P[8] : P[11], yEnd = (side < 0 ? P[7] : P[10]) + H;
      // beside the end: three cells along it, from the blade's face forward. Ground standing above the blade's top there is
      // a wall only if it still does a metre out (a slot's wall); a narrow ridge is the blade's own windrow, and the spill
      // goes onto it and runs down its far side.
      const beyond = [];
      for (const s of [FACE_OFF - cell, FACE_OFF, FACE_OFF + cell]) {
        const b = this.cellAt(ex + side * ax * cell + pdx * s, ez + side * az * cell + pdz * s);
        if (b < 0 || this.isBorder(b % this.nx, (b / this.nx) | 0) || beyond.includes(b) || (this.wallT[b] === this.tickNo + 1 && this.wallY[b] > -1e8)) continue;
        const far = h[b] > yEnd ? this.cellAt(ex + side * ax * 1.0 + pdx * s, ez + side * az * 1.0 + pdz * s) : -1;
        if (far >= 0 && h[far] > yEnd) continue; // a wall
        beyond.push(b);
      }
      for (let q = 0; q < idx.length; q++) {
        const c = cs[idx[q]]; if (c < 0) continue;
        // (a share of the excess a tick: spreading along a blade is slow, and a cell standing high for a moment, as the edge
        // crosses a row of cells and sweeps the row it was pushing into the next, is relaxed forward before it is spilled)
        const over = Math.min((h[c] - (ys[idx[q]] + H) - 0.05) * SPILL_RATE, this.softAbove(c)); if (over <= 0.0005) continue;
        const off = q + 1 >= idx.length, t = off ? -1 : cs[idx[q + 1]];
        if (!off && (t === c || t < 0)) continue;
        if (off && !beyond.length) break; // walled in: the blade is full and holds it
        vol.fill(0); this.removeTop(c, over, vol); this.wake(c);
        const to = off ? beyond : [t], k = 1 / to.length;
        for (const b of to) { if (!off) this._heaped(b, this.tickNo); for (let m = 1; m < NMAT; m++) if (vol[m] > 0) this.addTop(b, m, vol[m] * k); this.dist[b] = 255; this.wake(b); }
        if (off) out.spill += over * this.area;
      }
    }
    // Soil standing well above the blade's top (it cannot get off the ends fast enough, or a slot's walls hold it in)
    // topples over the top and lands just behind the blade, where the tracks will run over it
    for (let k = 0; k < n; k++) {
      const c = cs[k]; if (c < 0) continue;
      const ex = Math.min((h[c] - (ys[k] + H + OVER_TOP)) * SPILL_RATE, this.softAbove(c)); if (ex <= 0.0005) continue;
      const b = at((k + 0.5) / n, -back - cell); if (b < 0 || b === c || this.isBorder(b % this.nx, (b / this.nx) | 0)) continue;
      vol.fill(0); this.removeTop(c, ex, vol); for (let m = 1; m < NMAT; m++) if (vol[m] > 0) this.addTop(b, m, vol[m]);
      this.dist[b] = 255; this.wake(c); this.wake(b); out.over += ex * this.area;
    }
    // the heap carried: along lines across the blade, from the face forward until the ground is down to the edge
    const strip = W / n * cell; let face = 0;
    for (let k = 0; k < n; k++) {
      const a = (k + 0.5) / n, y = ys[k], f0 = cs[k] >= 0 ? Math.max(0, h[cs[k]] - y) : 0;
      face += f0; if (k === 0) out.faceL = f0; if (k === n - 1) out.faceR = f0;
      for (let s = FACE_OFF; s <= HEAP_REACH * H + 1e-6; s += cell) {
        const c = at(a, s); if (c < 0) break;
        const dh = h[c] - y; if (dh < 0.03) break;
        out.load += dh * strip;
      }
    }
    out.face = face / n;
    return out;
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
