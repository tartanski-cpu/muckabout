// Terrain stress scene without vehicles: four scripted "ghost" buckets dig the heap, carry and tip,
// plus a clod fountain holding the particle budget full. Exercises cut, containers, clods and relaxation.
import * as THREE from 'three';
import { ContainerField } from '../terrain/containers.js';
import { CutTool, ContainerRig } from '../terrain/tool.js';
import { CLOD_VOL } from '../terrain/clods.js';
import { SAND, NMAT } from '../terrain/materials.js';

export function setup(game, { fountain = true } = {}) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x3a3a3c }), ghosts = [];
  const HW = 1.2, D = 1.2;
  for (let g = 0; g < 4; g++) {
    const obj = new THREE.Group(); game.scene.add(obj);
    const add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); obj.add(m); };
    add(2.4, 0.05, D, 0, -0.03, 0); add(2.4, 0.9, 0.05, 0, 0.45, D / 2); add(0.05, 0.6, D, -HW, 0.3, 0); add(0.05, 0.6, D, HW, 0.3, 0);
    const field = new ContainerField({ name: 'ghost' + g, nx: 12, nz: 6, cs: 0.2, capacity: 2.0, walls: { zn: 0, zp: 0.9, xn: 0.6, xp: 0.6 } });
    const rig = game.addContainer(new ContainerRig(field, 'ghost' + g), obj);
    const tool = new CutTool('ghost' + g, [[-HW, 0, D / 2], [HW, 0, D / 2], [-HW, 0, -D / 2], [HW, 0, -D / 2]]);
    ghosts.push({ obj, field, rig, tool, heading: g * Math.PI / 2 + 0.3, t: g * 2.5, taken: 0 });
  }
  const heap = new THREE.Vector3(5, 0, -8);
  let fountainOn = fountain;
  game.updaters.push((dt) => {
    for (const s of ghosts) {
      s.t += dt; const cyc = s.t % 12, o = s.obj;
      const dx = Math.sin(s.heading), dz = Math.cos(s.heading); // outward direction from the heap
      let r, y, tilt = 0;
      if (cyc < 5) { r = 9 - cyc * 1.5; y = null; }                                   // drive in along the ground
      else if (cyc < 7) { r = 1.5 + (cyc - 5) * 3.5; y = 1 + (cyc - 5) * 1.2; tilt = -0.25; } // back out, lifting, curled
      else if (cyc < 10) { r = 8.5; y = 3.4; tilt = Math.min(1.5, (cyc - 7) * 1.2); }  // tip
      else { r = 8.5 + (cyc - 10) * 0.25; y = 3.4 - (cyc - 10) * 1.2; tilt = 0; }
      const x = heap.x + dx * r, z = heap.z + dz * r;
      o.position.set(x, y === null ? game.terrain.heightAt(heap.x + dx * 9, heap.z + dz * 9) + 0.05 : y, z);
      o.rotation.set(tilt, s.heading, 0, 'YXZ'); // local -z (the lip) points at the heap
      o.updateMatrixWorld(true);
      const res = s.tool.step(o.matrixWorld.elements, game.terrain, s.field.free(), cyc < 5);
      if (res) for (let m = 1; m < NMAT; m++) if (res.taken[m] > 0) { s.field.add(m, res.taken[m]); s.taken += res.taken[m]; }
    }
    if (fountainOn) { // top the clod budget up from the heap (volume-conserving: cut a little, throw it)
      const want = Math.min(game.clods.max - game.clods.count, 30);
      const fy = Math.max(-1.8, game.terrain.heightAt(heap.x, heap.z) - 0.2); for (let q = 1; q < 12; q += 3) FP[q] = fy;
      if (want > 0) game.terrain.command({ k: 'cut', id: 'fountain', p0: FP, p1: FP, capacity: want * CLOD_VOL, ahead: 0 });
      const res = game.terrain.takeResult('fountain');
      if (res) for (let m = 1; m < NMAT; m++) for (let v = res.taken[m]; v > 1e-9; v -= CLOD_VOL) {
        const r = game.rng;
        game.clods.spawn(heap.x + (r() - 0.5) * 2, game.terrain.heightAt(heap.x, heap.z) + 0.4, heap.z + (r() - 0.5) * 2, (r() - 0.5) * 3, 6 + r() * 5, (r() - 0.5) * 3, m, Math.min(v, CLOD_VOL));
      }
    }
  });
  // fountain intake: a 2 m square floor creeping down through the heap
  const FP = [heap.x - 1, 0.6, heap.z + 1, heap.x + 1, 0.6, heap.z + 1, heap.x - 1, 0.6, heap.z - 1, heap.x + 1, 0.6, heap.z - 1];
  game.focus.set(heap.x, 1, heap.z);
  return { ghosts, setFountain: (v) => { fountainOn = v; } };
}
