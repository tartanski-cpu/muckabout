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
    this.machines = []; this.h = 1 / 60 / SUBSTEPS;
    this.world.timestep = this.h;
  }
  add(machine) { this.machines.push(machine); return machine; }
  /** Static box prop (hopper walls etc.). size = full extents. */
  addStaticBox(size, pos, yaw = 0) {
    const R = this.R, b = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(pos[0], pos[1], pos[2]).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
    this.world.createCollider(R.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2), b);
    return b;
  }
  /** One fixed game step (dt = 1/60): machine logic, force substeps, sync. */
  step(dt) {
    for (const m of this.machines) m.pre(dt);
    for (let s = 0; s < SUBSTEPS; s++) {
      for (const m of this.machines) m.applyForces(this.h);
      this.world.step();
    }
    for (const m of this.machines) m.post(dt);
  }
}
