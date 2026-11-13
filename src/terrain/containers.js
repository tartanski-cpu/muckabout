// A container (bucket, dumper bed, hopper) is a small heightfield in its own frame.
// Local frame: x across, z along, y up from the floor; cells are centred on a grid around the origin.
// It relaxes against world-up expressed in the local frame, so tilting it makes material run downhill
// and over whichever edge is lowest. Material that leaves is reported through `emit` and becomes clods.
import { MATERIALS } from './materials.js';

const D2R = Math.PI / 180;

export class ContainerField {
  /**
   * @param {{name?:string, nx:number, nz:number, cs:number, capacity:number,
   *          walls?:{xn?:number,xp?:number,zn?:number,zp?:number}}} o
   *   walls: height of each side in metres (0 = open edge, default 10 = effectively closed)
   */
  constructor(o) {
    this.name = o.name || 'container';
    this.nx = o.nx; this.nz = o.nz; this.cs = o.cs; this.capacity = o.capacity;
    this.walls = { xn: 10, xp: 10, zn: 10, zp: 10, ...(o.walls || {}) };
    this.fill = new Float32Array(o.nx * o.nz); this.mat = new Uint8Array(o.nx * o.nz);
    this.area = o.cs * o.cs; this.hx = o.nx * o.cs / 2; this.hz = o.nz * o.cs / 2;
    this.dirty = true;
  }
  cx(i) { return (i + 0.5) * this.cs - this.hx; }
  cz(j) { return (j + 0.5) * this.cs - this.hz; }
  volume() { let s = 0; for (let k = 0; k < this.fill.length; k++) s += this.fill[k]; return s * this.area; }
  free() { return Math.max(0, this.capacity - this.volume()); }
  _put(k, mat, dh) {
    if (this.fill[k] < dh || this.mat[k] === 0) this.mat[k] = mat; // the bigger share names the cell
    this.fill[k] += dh; this.dirty = true;
  }
  /** Spread a volume evenly over the floor (soil rolling into a bucket). */
  add(mat, vol) {
    if (vol <= 0) return;
    const dh = vol / (this.fill.length * this.area);
    for (let k = 0; k < this.fill.length; k++) this._put(k, mat, dh);
  }
  /** Is local point (lx, lz) over the floor? */
  contains(lx, lz) { return lx > -this.hx && lx < this.hx && lz > -this.hz && lz < this.hz; }
  cellAt(lx, lz) {
    const i = Math.min(this.nx - 1, Math.max(0, Math.floor((lx + this.hx) / this.cs)));
    const j = Math.min(this.nz - 1, Math.max(0, Math.floor((lz + this.hz) / this.cs)));
    return j * this.nx + i;
  }
  surfaceAt(lx, lz) { return this.fill[this.cellAt(lx, lz)]; }
  addAt(lx, lz, mat, vol) { this._put(this.cellAt(lx, lz), mat, vol / this.area); }
  /** Remove everything (returns [{mat, vol}]). */
  clear() {
    const out = new Map();
    for (let k = 0; k < this.fill.length; k++) if (this.fill[k] > 0) { out.set(this.mat[k], (out.get(this.mat[k]) || 0) + this.fill[k] * this.area); this.fill[k] = 0; }
    this.dirty = true;
    return [...out].map(([mat, vol]) => ({ mat, vol }));
  }

  /**
   * One relaxation pass. up = world up in local coordinates (unit vector).
   * emit(lx, ly, lz, dx, dz, mat, vol): material leaving at local position, heading in local direction (dx, dz).
   * Returns volume that left.
   */
  relax(up, emit) {
    const { nx, nz, cs, fill, mat } = this, ux = up[0], uy = up[1], uz = up[2];
    let out = 0;
    if (uy < 0.08) { // on its side or upside down: everything drops out
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i; if (fill[k] <= 0) continue;
        const v = fill[k] * this.area; fill[k] = 0; out += v;
        emit(this.cx(i), 0.05, this.cz(j), 0, 0, mat[k], v);
      }
      if (out > 0) this.dirty = true;
      return out;
    }
    const k1 = Math.max(uy, 0.3);
    const flow = (a, b, dxl, dzl) => { // a, b cell indices; b is at local offset (dxl, dzl) from a
      let d = uy * (fill[a] - fill[b]) - ux * dxl - uz * dzl, hi = a, lo = b;
      if (d < 0) { d = -d; hi = b; lo = a; }
      if (fill[hi] <= 0) return;
      const ex = d - cs * Math.tan(MATERIALS[mat[hi]].repose * D2R) * k1;
      if (ex <= 0.002) return;
      const m = Math.min(ex * 0.25 / k1, fill[hi]);
      fill[hi] -= m; this._put(lo, mat[hi], m);
    };
    const edge = (a, i, j, dxl, dzl, wall) => { // outflow over a side
      if (fill[a] <= 0 || wall >= 5) return;
      const d = uy * (fill[a] - wall) - ux * dxl - uz * dzl;
      const ex = d - cs * Math.tan(MATERIALS[mat[a]].repose * D2R) * k1;
      if (ex <= 0.002) return;
      const m = Math.min(ex * 0.3 / k1, fill[a]);
      fill[a] -= m; const v = m * this.area; out += v; this.dirty = true;
      emit(this.cx(i) + dxl * 0.6, Math.max(fill[a], wall) + 0.03, this.cz(j) + dzl * 0.6, Math.sign(dxl), Math.sign(dzl), mat[a], v);
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * nx + i;
      if (i + 1 < nx) flow(a, a + 1, cs, 0);
      if (j + 1 < nz) flow(a, a + nx, 0, cs);
      if (i === 0) edge(a, i, j, -cs, 0, this.walls.xn);
      if (i === nx - 1) edge(a, i, j, cs, 0, this.walls.xp);
      if (j === 0) edge(a, i, j, 0, -cs, this.walls.zn);
      if (j === nz - 1) edge(a, i, j, 0, cs, this.walls.zp);
    }
    return out;
  }
}
