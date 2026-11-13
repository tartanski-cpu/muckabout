// Rapier world wrapper. Rapier handles rigid bodies, joints and machine-vs-machine / machine-vs-prop
// contacts. The ground is NOT a Rapier collider (a heightfield collider can't be edited in place):
// wheels, tracks and skid points sample our own terrain and apply forces (see machine.js).
import RAPIER from '@dimforge/rapier3d-compat';

export const SUBSTEPS = 2;
let ready = null;

export class Physics {
  static async create() {
    await (ready ??= RAPIER.init());
    return new Physics();
  }
  constructor() {
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.machines = []; this.statics = []; this.h = 1 / 60 / SUBSTEPS;
    this.world.timestep = this.h;
  }
  add(machine) { this.machines.push(machine); return machine; }
  /** Static box prop (hopper walls etc.). size = full extents. */
  addStaticBox(size, pos, yaw = 0) {
    const R = this.R, b = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
    this.world.createCollider(R.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2), b);
    this.statics.push({ x0: pos[0] - size[0] / 2, x1: pos[0] + size[0] / 2, z0: pos[2] - size[2] / 2, z1: pos[2] + size[2] / 2, y1: pos[1] + size[1] / 2 }); // footprint for the custom model (yaw ignored)
    return b;
  }
  /**
   * Custom-model collision test: would machine m, at the pose in k, overlap another machine or a prop?
   * Each body is a few circles along its length; props are boxes. Crude on purpose (the proof of concept did the same).
   */
  blocked(m, k) {
    const s = Math.sin(k.psi), c = Math.cos(k.psi), ox = k.x - s * k.refZ, oz = k.z - c * k.refZ, mine = this._circles(m, ox, oz, k.psi, k.gamma, this._ca);
    for (const st of this.statics) for (let i = 0; i < mine.length; i += 3) {
      const dx = Math.max(st.x0 - mine[i], 0, mine[i] - st.x1), dz = Math.max(st.z0 - mine[i + 1], 0, mine[i + 1] - st.z1);
      if (dx * dx + dz * dz < mine[i + 2] * mine[i + 2] * 0.5) return true;
    }
    for (const o of this.machines) {
      if (o === m) continue; const p = o.bodyList[0].obj.position;
      if ((p.x - ox) ** 2 + (p.z - oz) ** 2 > 196) continue;
      const theirs = this._circles(o, p.x, p.z, o.heading, o.joints[0] ? o.joints[0].target : 0, this._cb);
      for (let i = 0; i < mine.length; i += 3) for (let j = 0; j < theirs.length; j += 3) { const r = mine[i + 2] + theirs[j + 2]; if ((mine[i] - theirs[j]) ** 2 + (mine[i + 1] - theirs[j + 1]) ** 2 < r * r * 0.72) return true; }
    }
    return false;
  }
  _circles(m, ox, oz, psi, gamma, out) {
    out.length = 0; const j = m.joints[0];
    for (const b of m.bodyList) {
      const front = j && b === m.bodies[j.def.b], a = front ? j.def.anchor : [0, 0, 0], h = psi + (front ? gamma : 0), s = Math.sin(h), c = Math.cos(h);
      const hx = ox + (front ? Math.cos(psi) * a[0] + Math.sin(psi) * a[2] : 0), hz = oz + (front ? -Math.sin(psi) * a[0] + Math.cos(psi) * a[2] : 0); // hinge (or origin)
      const col = b.def.colliders && b.def.colliders[0]; if (!col) continue;
      const r = col.size[0] / 2, len = col.size[2], n = Math.max(1, Math.round(len / (r * 1.4)));
      for (let q = 0; q < n; q++) { const lz = col.pos[2] - len / 2 + r + (n > 1 ? q * (len - 2 * r) / (n - 1) : len / 2 - r) - a[2], lx = col.pos[0] - a[0]; out.push(hx + c * lx + s * lz, hz - s * lx + c * lz, r); }
    }
    return out;
  }
  _ca = []; _cb = [];

  /** One fixed game step (dt = 1/60): machine logic, force substeps, sync. */
  step(dt) {
    for (const m of this.machines) m.pre(dt);
    for (const m of this.machines) if (m.kin.custom) m.customStep(dt);
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const m of this.machines) m.applyForces(this.h);
      this.world.step();
    }
    for (const m of this.machines) m.post(dt);
  }
}
