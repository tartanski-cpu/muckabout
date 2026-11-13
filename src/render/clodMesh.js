import * as THREE from 'three';
import { MATERIALS } from '../terrain/materials.js';

const _o = new THREE.Object3D(), _c = new THREE.Color();
/** One instanced mesh for all airborne clods, tinted per material. */
export class ClodMesh {
  constructor(clods) {
    this.clods = clods;
    const geo = new THREE.IcosahedronGeometry(0.13, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), clods.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.tints = MATERIALS.map((m) => new THREE.Color(...m.color));
  }
  update() {
    const p = this.clods, n = p.count, m = this.mesh, col = m.instanceColor.array;
    for (let i = 0; i < n; i++) {
      _o.position.set(p.x[i], p.y[i], p.z[i]); _o.rotation.set(p.r[i], p.r[i] * 0.7, 0); _o.scale.setScalar(p.s[i]);
      _o.updateMatrix(); m.setMatrixAt(i, _o.matrix);
      const t = this.tints[p.mat[i]], k = 0.8 + 0.3 * ((i * 37) % 11) / 10;
      col[i * 3] = t.r * k; col[i * 3 + 1] = t.g * k; col[i * 3 + 2] = t.b * k;
    }
    m.count = n;
    if (n) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }
}
