// Glue between a moving object and the terrain: cutting edges and containers.
// Matrices are passed as 16-element column-major arrays (THREE.Matrix4.elements) so this stays three-free.

const tp = (m, x, y, z, out, o) => {
  out[o] = m[0] * x + m[4] * y + m[8] * z + m[12]; out[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; out[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
};

/** A floor rectangle that cuts whatever it sweeps through. corners: [backL, backR, lipL, lipR] local xyz. */
export class CutTool {
  /** heap: for a blade, how high (m above the edge) the heap it pushes may stand before the surplus spills round its ends. */
  constructor(id, corners, ahead = 0.35, heap = 0) {
    this.id = id; this.local = corners.flat(); this.ahead = ahead; this.heap = heap;
    this.prev = new Float64Array(12); this.cur = new Float64Array(12); this.has = false;
    this.last = null; this.resist = 0; this.rate = 0;
  }
  /** Queue this step's cut. Returns the previous step's result (or null). */
  step(matrixWorld, terrain, capacity, active = true) {
    const L = this.local;
    for (let q = 0; q < 12; q += 3) tp(matrixWorld, L[q], L[q + 1], L[q + 2], this.cur, q);
    const res = terrain.takeResult(this.id) || null;
    if (active) {
      // skip when the whole floor is well above the ground: nothing to cut
      let low = false;
      for (let q = 0; q < 12; q += 3) if (this.cur[q + 1] < terrain.heightAt(this.cur[q], this.cur[q + 2]) + 0.5) { low = true; break; }
      if (low) terrain.cut(this.id, this.has ? this.prev : this.cur, this.cur, capacity, this.ahead, this.heap);
    }
    this.prev.set(this.cur); this.has = true;
    return res;
  }
  reset() { this.has = false; }
}

/** A ContainerField riding on an object: relaxes against gravity and pours spill out as clods. */
export class ContainerRig {
  constructor(field, key) {
    this.field = field; this.key = key; this.inv = new Float64Array(16); this.world = new Float64Array(16);
    this.prev = new Float64Array(16); this.has = false; this.passes = 2; this.spillRate = 0;
    this._p = [0, 0, 0]; this._q = [0, 0, 0];
    this.shake = 0; this._up = null; this._du = [0, 0, 0]; this._since = 9; this._revs = 0; this._last = 9; // shaking the load loose (see step)
  }
  /** world/inverse: matrixWorld elements and its inverse. */
  setPose(world, inverse) {
    if (this.has) this.prev.set(this.world); this.world.set(world); this.inv.set(inverse);
    if (!this.has) { this.prev.set(world); this.has = true; }
  }
  step(dt, clods) {
    const m = this.world, s = Math.hypot(m[1], m[5], m[9]) || 1;
    const up = [m[1] / s, m[5] / s, m[9] / s]; // world +Y in local coordinates
    // Shaking it out: flick the bucket or body back and forth and what clings in it comes loose. Each quick reversal
    // of the way it is tipping adds to `shake`, which the load then slides on; it dies away in about a second.
    this.shake = Math.max(0, this.shake - dt * 1.1); this._since += dt; this._last += dt;
    if (this._up) {
      const du = [up[0] - this._up[0], up[1] - this._up[1], up[2] - this._up[2]], w = Math.hypot(du[0], du[1], du[2]) / dt;
      if (w > 0.2) { // tipping at more than 0.2 rad/s
        const was = this._du, dot = du[0] * was[0] + du[1] * was[1] + du[2] * was[2];
        if (dot < 0 && this._since < 0.7) { // a reversal. One alone is a bump in the road; two in quick succession is a shake
          this._revs = this._last < 0.9 ? this._revs + 1 : 1; this._last = 0;
          if (this._revs >= 2) this.shake = Math.min(1, this.shake + 0.55);
        }
        this._du = du; this._since = 0;
      }
    }
    this._up = up;
    let out = 0;
    const emit = (lx, ly, lz, dx, dz, mat, vol) => {
      tp(m, lx, ly, lz, this._p, 0); tp(this.prev, lx, ly, lz, this._q, 0);
      const ox = m[0] * dx + m[8] * dz, oy = m[1] * dx + m[9] * dz, oz = m[2] * dx + m[10] * dz; // outward, world
      clods.pour(this.key, this._p[0], this._p[1], this._p[2],
        (this._p[0] - this._q[0]) / dt + ox * 0.9, (this._p[1] - this._q[1]) / dt + oy * 0.9, (this._p[2] - this._q[2]) / dt + oz * 0.9, mat, vol);
    };
    for (let k = 0; k < this.passes; k++) out += this.field.relax(up, emit, this.shake);
    this.spillRate += (out / dt - this.spillRate) * 0.3;
    return out;
  }
}
