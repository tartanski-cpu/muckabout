// River: shallow water on a coarse grid (2×2 terrain cells) using the virtual-pipes scheme, with a fixed
// inflow at the upstream edge and a free outflow downstream. Flowing water erodes the top material of the
// ground under it at a rate set by the material's erosion factor and carries it downstream; what reaches
// the outflow is booked as `washed`. Lives beside TerrainCore (same thread) and reads/writes its columns.
import { MATERIALS, NMAT } from './materials.js';

const G = 9.81;

export class Water {
  /** @param {import('./core.js').TerrainCore} core @param {object} map map definition with .river */
  constructor(core, map) {
    this.core = core; const r = this.river = map.river;
    const k = this.k = 2, cell = this.cell = core.cell * k;        // water cell = k×k terrain cells
    this.i0 = 0; this.nx = Math.floor(core.nx / k);
    const zc = r.z, band = r.band ?? 13;
    this.j0 = Math.max(0, Math.floor((zc - band - core.oz) / cell)); this.nz = Math.min(Math.floor(core.nz / k) - this.j0, Math.ceil(2 * band / cell));
    this.ox = core.ox; this.oz = core.oz + this.j0 * cell;
    const n = this.n = this.nx * this.nz;
    this.d = new Float32Array(n); this.b = new Float32Array(n);
    this.fl = new Float32Array(n); this.fr = new Float32Array(n); this.fu = new Float32Array(n); this.fd = new Float32Array(n);
    this.vx = new Float32Array(n); this.vz = new Float32Array(n);
    this.inflow = r.inflow ?? 3.0;          // m³/s
    this.erodeK = r.erodeK ?? 0.0016;       // m of mud per second per m/s of flow
    this.tick = 0; this.washed = 0; this._vol = new Float64Array(NMAT);
    this.sampleBed();
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const c = j * this.nx + i, x = this.ox + (i + 0.5) * cell, z = this.oz + (j + 0.5) * cell;
      if (Math.abs(z - map.riverZ(x)) < 8) this.d[c] = Math.max(0, r.level - this.b[c]);
    }
    this.markWet();
  }
  sampleBed() {
    const { core, k, nx, nz, b } = this, cnx = core.nx, h = core.h;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const t = (this.j0 + j) * k * cnx + i * k;
      b[j * nx + i] = (h[t] + h[t + 1] + h[t + cnx] + h[t + cnx + 1]) * 0.25;
    }
  }
  markWet() {
    const { core, k, nx, nz, d } = this, cnx = core.nx;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const w = d[j * nx + i] > 0.06 ? 1 : 0, t = (this.j0 + j) * k * cnx + i * k;
      for (const c of [t, t + 1, t + cnx, t + cnx + 1]) if (core.wet[c] !== w) { core.wet[c] = w; core.chunkDirty[core.chunkOf(c)] = 1; core.wake(c); }
    }
  }
  volume() { let s = 0; for (let c = 0; c < this.n; c++) s += this.d[c]; return s * this.cell * this.cell; }

  step(dt) {
    const { nx, nz, d, b, fl, fr, fu, fd, cell } = this, n = this.n, a2 = cell * cell, r = this.river;
    this.tick++;
    this.sampleBed();
    // inflow: spread over the wet cells of the first column
    let wetIn = 0; for (let j = 0; j < nz; j++) if (b[j * nx] < r.level) wetIn++;
    if (wetIn) { const add = this.inflow * dt / (wetIn * a2); for (let j = 0; j < nz; j++) if (b[j * nx] < r.level) d[j * nx] += add; }
    // pipes
    const kf = dt * cell * G;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i, hc = b[c] + d[c];
      let L = i > 0 ? Math.max(0, fl[c] + kf * (hc - b[c - 1] - d[c - 1])) : 0;
      let R = i < nx - 1 ? Math.max(0, fr[c] + kf * (hc - b[c + 1] - d[c + 1])) : Math.max(0, fr[c] + kf * Math.max(0, d[c] - 0.02)); // free outflow at the downstream edge
      let U = j > 0 ? Math.max(0, fu[c] + kf * (hc - b[c - nx] - d[c - nx])) : 0;
      let D = j < nz - 1 ? Math.max(0, fd[c] + kf * (hc - b[c + nx] - d[c + nx])) : 0;
      const damp = 1 - Math.min(0.5, dt * (0.6 + 0.04 / Math.max(d[c], 0.02))); // bed friction, stronger in shallows
      L *= damp; R *= damp; U *= damp; D *= damp;
      const sum = (L + R + U + D) * dt, avail = d[c] * a2;
      if (sum > avail) { const s = avail / sum; L *= s; R *= s; U *= s; D *= s; }
      fl[c] = L; fr[c] = R; fu[c] = U; fd[c] = D;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const inL = i > 0 ? fr[c - 1] : 0, inR = i < nx - 1 ? fl[c + 1] : 0, inU = j > 0 ? fd[c - nx] : 0, inD = j < nz - 1 ? fu[c + nx] : 0;
      const dn = d[c] + dt * (inL + inR + inU + inD - fl[c] - fr[c] - fu[c] - fd[c]) / a2;
      const dm = Math.max(0.02, (d[c] + Math.max(dn, 0)) * 0.5);
      this.vx[c] = (inL - fl[c] + fr[c] - inR) * 0.5 / (cell * dm);
      this.vz[c] = (inU - fu[c] + fd[c] - inD) * 0.5 / (cell * dm);
      d[c] = dn > 0 ? dn : 0;
    }
    if (this.tick % 4 === 0) { this.erode(dt * 4); this.markWet(); }
  }

  erode(dt) {
    const { core, k, nx, nz, d, vx, vz, cell } = this, cnx = core.nx, vol = this._vol;
    for (let j = 1; j < nz - 1; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i; if (d[c] < 0.04) continue;
      const sp = Math.hypot(vx[c], vz[c]); if (sp < 0.3) continue;
      // carry one water cell downstream (two near the fastest flow)
      const hop = sp > 1.5 ? 2 : 1, ti = i + Math.round(vx[c] / sp) * hop, tj = j + Math.round(vz[c] / sp) * hop;
      const base = (this.j0 + j) * k * cnx + i * k;
      for (const t of [base, base + 1, base + cnx, base + cnx + 1]) {
        if (!core.nl[t]) continue;
        const m = core.topMat(t), dh = MATERIALS[m].erosion * this.erodeK * Math.min(sp, 3) * dt;
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

  /** Snapshot for the main thread (every 6th tick ≈ 10 Hz); null otherwise. */
  pack() {
    if (this.tick % 6 !== 1) return null;
    return { nx: this.nx, nz: this.nz, cell: this.cell, ox: this.ox, oz: this.oz, depth: this.d.slice(), bed: this.b.slice(), vx: this.vx.slice(), vz: this.vz.slice() };
  }
}

export function attachWater(core, map) {
  if (!map.river) return null;
  core.water = new Water(core, map);
  return core.water;
}
