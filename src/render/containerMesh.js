import * as THREE from 'three';
import { MATERIALS } from '../terrain/materials.js';

/** Visible contents of a ContainerField: a small grid in the container's local frame. */
export class ContainerMesh {
  constructor(field) {
    this.field = field;
    const { nx, nz, cs } = field;
    const g = this.geo = new THREE.PlaneGeometry((nx - 1) * cs, (nz - 1) * cs, nx - 1, nz - 1).rotateX(-Math.PI / 2);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(nx * nz * 3), 3));
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    this.mesh.scale.set(nx / (nx - 1), 1, nz / (nz - 1)); // stretch so the pile reaches the walls
    this.mesh.frustumCulled = false; this.mesh.visible = false;
  }
  update() {
    const f = this.field; if (!f.dirty) return; f.dirty = false; f.rev = (f.rev || 0) + 1; // rev: what the co-op host watches to know a container changed
    const pos = this.geo.attributes.position, col = this.geo.attributes.color; let any = false;
    for (let k = 0; k < f.fill.length; k++) {
      const h = f.fill[k]; if (h > 0.004) any = true;
      pos.setY(k, h > 0.004 ? h : -0.02);
      const c = MATERIALS[f.mat[k] || 1].color, j = 0.85 + 0.25 * ((k * 53) % 7) / 6;
      col.setXYZ(k, c[0] * j, c[1] * j, c[2] * j);
    }
    pos.needsUpdate = true; col.needsUpdate = true; this.mesh.visible = any;
  }
}
