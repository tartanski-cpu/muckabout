// The heap being shoved along ahead of a blade or a full bucket, drawn as a bed of tumbling granules.
//
// The soil itself is already in the ground: the terrain windrows what a tool cannot take just ahead of its edge, and
// that heap is what the machine pushes against and what the volume audit counts. This layer only dresses it. While a
// tool is pushing, granules ride on the heap's surface in the tool's own frame, so they travel with the edge, roll
// forward down the face as it advances and come round again at the blade. When the pushing stops they sink into the
// surface over a couple of seconds and what is left is the ordinary ground, the same heap. One draw call for all tools.
import * as THREE from 'three';
import { MATERIALS } from '../terrain/materials.js';
import { lumpy } from './chips.js';

const PER_TOOL = 1000, TOOLS = 4, DEPTH = 2.8, SETTLE = 2.2;
const _o = new THREE.Object3D(), _l = new THREE.Vector3(), _r = new THREE.Vector3(), _b = new THREE.Vector3();
const hash = (i, k) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };

export class PushHeap {
  constructor(terrain) {
    this.terrain = terrain;
    const geo = lumpy(new THREE.BoxGeometry(0.12, 0.1, 0.11), 0.26, 17);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), PER_TOOL * TOOLS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.tints = MATERIALS.map((m) => new THREE.Color(...m.color));
    this.states = new Map(); // tool → {act, kick, travel, px, pz}
  }

  /** A tool pushed soil this step. */
  kick(tool) {
    let s = this.states.get(tool);
    if (!s) { if (this.states.size >= TOOLS) return; s = { act: 0, kick: 0, travel: 0, px: null, pz: 0 }; this.states.set(tool, s); }
    s.kick = 0.3;
  }

  update(dt) {
    const T = this.terrain, m = this.mesh, col = m.instanceColor.array; let n = 0;
    for (const [tool, s] of this.states) {
      s.kick -= dt;
      s.act = Math.max(0, Math.min(1, s.act + (s.kick > 0 ? dt / 0.35 : -dt / SETTLE)));
      if (s.act <= 0) { this.states.delete(tool); continue; }
      // the cutting edge in the world: its two lip corners, and which way is ahead
      const C = tool.def.corners, mw = tool.node.matrixWorld;
      _l.fromArray(C[2]).applyMatrix4(mw); _r.fromArray(C[3]).applyMatrix4(mw); _b.fromArray(C[0]).applyMatrix4(mw);
      const cx = (_l.x + _r.x) / 2, cz = (_l.z + _r.z) / 2;
      let ax = _r.x - _l.x, az = _r.z - _l.z; const w = Math.hypot(ax, az) || 1; ax /= w; az /= w;
      let fx = -az, fz = ax; if (fx * (_l.x - _b.x) + fz * (_l.z - _b.z) < 0) { fx = -fx; fz = -fz; }
      if (s.px !== null) s.travel += Math.max(0, (cx - s.px) * fx + (cz - s.pz) * fz);
      s.px = cx; s.pz = cz;
      const hw = w / 2 + 0.3, floor = T.heightAt(cx - fx * 0.3, cz - fz * 0.3), count = Math.min(PER_TOOL, Math.round(PER_TOOL * hw / 2));
      const grow = Math.sqrt(s.act), sink = (1 - s.act) * 0.16;
      for (let i = 0; i < count; i++) {
        const u = (hash(i, 1) * 2 - 1) * hw, speed = 0.25 + 0.3 * hash(i, 2);
        const d = -0.2 + ((hash(i, 3) * DEPTH + s.travel * speed) % DEPTH);                 // rolls forward down the face, then comes round again at the edge
        const x = cx + ax * u + fx * d, z = cz + az * u + fz * d, h = T.heightAt(x, z), over = h - floor;
        if (over < 0.07) continue;                                                           // no heap here
        const sc = Math.min(1, over / 0.22) * grow * (0.7 + 0.45 * hash(i, 4)), roll = s.travel * (1.2 + 2 * hash(i, 5));
        _o.position.set(x, h + 0.03 * sc - sink + 0.03 * Math.sin(roll * 2 + i), z);
        _o.rotation.set(hash(i, 6) * 6.3 + roll, hash(i, 7) * 6.3, hash(i, 8) * 6.3 + roll * 0.6);
        _o.scale.set(sc * (0.8 + 0.4 * hash(i, 9)), sc * (0.8 + 0.3 * hash(i, 10)), sc * (0.8 + 0.4 * hash(i, 11)));
        _o.updateMatrix(); m.setMatrixAt(n, _o.matrix);
        const t = this.tints[T.materialAt(x, z) || 1], k = 0.78 + 0.34 * hash(i, 12);
        col[n * 3] = t.r * k; col[n * 3 + 1] = t.g * k; col[n * 3 + 2] = t.b * k; n++;
      }
    }
    m.count = n;
    if (n) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }
}
