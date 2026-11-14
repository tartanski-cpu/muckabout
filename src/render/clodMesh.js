import * as THREE from 'three';
import { MATERIALS } from '../terrain/materials.js';
import { lumpy } from './chips.js';

const _o = new THREE.Object3D(), _c = new THREE.Color();
/** One instanced mesh for all airborne clods, tinted per material. */
export class ClodMesh {
  constructor(clods) {
    this.clods = clods;
    const geo = lumpy(new THREE.BoxGeometry(0.21, 0.17, 0.2), 0.24, 11); // a chunky, knocked-about cube
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), clods.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.tints = MATERIALS.map((m) => new THREE.Color(...m.color));
  }
  update() {
    const p = this.clods, n = p.count, m = this.mesh, col = m.instanceColor.array;
    for (let i = 0; i < n; i++) {
      _o.position.set(p.x[i], p.y[i], p.z[i]); _o.rotation.set(p.r[i], p.r[i] * 0.7, 0); { const s = p.s[i], q = (i * 53) % 7; _o.scale.set(s * (0.8 + q * 0.07), s * (1.15 - q * 0.06), s * (0.85 + ((i * 29) % 5) * 0.08)); } // every clod a different lump
      _o.updateMatrix(); m.setMatrixAt(i, _o.matrix);
      const t = this.tints[p.mat[i]], k = 0.8 + 0.3 * ((i * 37) % 11) / 10;
      col[i * 3] = t.r * k; col[i * 3 + 1] = t.g * k; col[i * 3 + 2] = t.b * k;
    }
    m.count = n;
    if (n) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }
}
