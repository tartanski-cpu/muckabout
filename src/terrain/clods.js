// Transient particles: material only exists as clods while airborne. Ballistic, no clod–clod tests.
// Pure sim (rendering is in src/render/clodMesh.js). Landing either adds to a container or queues a
// ground deposit, so volume is conserved across world ↔ bucket ↔ bed ↔ hopper.
export const CLOD_VOL = 0.014; // m³ per clod, as in the POC

export class Clods {
  /** @param {{max?:number, rng:()=>number}} o */
  constructor(o) {
    const n = this.max = o.max ?? 1500; this.rng = o.rng;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.z = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.vol = new Float32Array(n); this.mat = new Uint8Array(n); this.s = new Float32Array(n); this.r = new Float32Array(n);
    this.count = 0;
    this.pending = new Map(); // key → {mat → leftover volume}: spill smaller than one clod, carried over
    this.pendingVol = 0;
  }
  airborne() { let s = 0; for (let i = 0; i < this.count; i++) s += this.vol[i]; return s + this.pendingVol; }

  /** world: {heightAt, deposit(x,z,mat,vol)}; containers: [{field, inv:number[16] world→local}] */
  setTargets(world, containers) { this.world = world; this.containers = containers; }

  spawn(x, y, z, vx, vy, vz, mat, vol) {
    if (this.count >= this.max) { this._settle(x, y, z, mat, vol, true); return; } // over budget: land it now
    const n = this.count++;
    this.x[n] = x; this.y[n] = y; this.z[n] = z; this.vx[n] = vx; this.vy[n] = vy; this.vz[n] = vz;
    this.vol[n] = vol; this.mat[n] = mat; this.s[n] = 0.8 + this.rng() * 0.5; this.r[n] = this.rng() * 6;
  }

  /** Feed a continuous outflow; emits whole clods and carries the remainder. key identifies the source. */
  pour(key, x, y, z, vx, vy, vz, mat, vol, spread = 0.5) {
    let slot = this.pending.get(key); if (!slot) this.pending.set(key, slot = new Float64Array(8));
    slot[mat] += vol; this.pendingVol += vol;
    while (slot[mat] >= CLOD_VOL) {
      slot[mat] -= CLOD_VOL; this.pendingVol -= CLOD_VOL;
      const r = this.rng;
      this.spawn(x + (r() - 0.5) * 0.2, y + r() * 0.1, z + (r() - 0.5) * 0.2, vx + (r() - 0.5) * spread, vy + (r() - 0.5) * spread * 0.5, vz + (r() - 0.5) * spread, mat, CLOD_VOL);
    }
  }

  _inContainer(x, y, z, anyHeight) {
    const cs = this.containers;
    if (cs) for (let q = 0; q < cs.length; q++) {
      const c = cs[q], m = c.inv, f = c.field;
      const lx = m[0] * x + m[4] * y + m[8] * z + m[12], lz = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (!f.contains(lx, lz)) continue;
      const ly = m[1] * x + m[5] * y + m[9] * z + m[13];
      if (ly < -0.35) continue;
      if (anyHeight ? ly < 6 : ly < f.surfaceAt(lx, lz) + 0.07) { this._hit = c; this._lx = lx; this._lz = lz; return true; }
    }
    return false;
  }
  _settle(x, y, z, mat, vol, anyHeight) {
    if (this._inContainer(x, y, z, anyHeight)) this._hit.field.addAt(this._lx, this._lz, mat, vol);
    else this.world.deposit(x, z, mat, vol);
  }

  update(dt) {
    const { x, y, z, vx, vy, vz, vol, mat, s, r, world } = this;
    for (let n = 0; n < this.count; n++) {
      vy[n] -= 9.81 * dt;
      x[n] += vx[n] * dt; y[n] += vy[n] * dt; z[n] += vz[n] * dt; r[n] += dt * 5;
      let dead = false;
      if (this._inContainer(x[n], y[n], z[n], false)) { this._hit.field.addAt(this._lx, this._lz, mat[n], vol[n]); dead = true; }
      else if (y[n] - 0.06 < world.heightAt(x[n], z[n])) { world.deposit(x[n], z[n], mat[n], vol[n]); dead = true; }
      if (dead) {
        const l = --this.count;
        x[n] = x[l]; y[n] = y[l]; z[n] = z[l]; vx[n] = vx[l]; vy[n] = vy[l]; vz[n] = vz[l]; vol[n] = vol[l]; mat[n] = mat[l]; s[n] = s[l]; r[n] = r[l];
        n--;
      }
    }
  }
}
