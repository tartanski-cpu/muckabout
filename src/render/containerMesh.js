import * as THREE from 'three';
import { MATERIALS } from '../terrain/materials.js';
import { lumpy } from './chips.js';
import { hash2 } from '../util/rng.js';

const _o = new THREE.Object3D();
let grainGeo = null;
/**
 * Visible contents of a ContainerField, in the container's own frame: a dark smooth underlay following the fill
 * surface, covered in chunky granules (one or two per cell, sized and tumbled by a hash of the cell and its level),
 * so a load reads as a heap of lumps you can judge the size of, not a smooth slab. One instanced mesh per container.
 */
export class ContainerMesh {
  constructor(field) {
    this.field = field;
    const { nx, nz, cs } = field;
    const g = this.geo = new THREE.PlaneGeometry((nx - 1) * cs, (nz - 1) * cs, nx - 1, nz - 1).rotateX(-Math.PI / 2);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(nx * nz * 3), 3));
    this.mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    this.mesh.scale.set(nx / (nx - 1), 1, nz / (nz - 1)); // stretch so the pile reaches the walls
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    grainGeo ??= lumpy(new THREE.BoxGeometry(1, 0.8, 1), 0.22, 17);
    this.per = cs >= 0.25 ? 1 : 2;                         // granules per cell
    this.grains = new THREE.InstancedMesh(grainGeo, new THREE.MeshLambertMaterial({ flatShading: true }), nx * nz * this.per);
    this.grains.frustumCulled = false; this.grains.count = 0; this.grains.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.add(this.grains); this.grains.scale.set((nx - 1) / nx, 1, (nz - 1) / nz); // undo the underlay's stretch
  }
  update() {
    const f = this.field; if (!f.dirty) return; f.dirty = false; f.rev = (f.rev || 0) + 1; // rev: what the co-op host watches to know a container changed
    const pos = this.geo.attributes.position, col = this.geo.attributes.color, C = this.grains.instanceColor.array; let any = false, n = 0;
    for (let k = 0; k < f.fill.length; k++) {
      const h = f.fill[k], c = MATERIALS[f.mat[k] || 1].color;
      if (h > 0.004) any = true;
      pos.setY(k, h > 0.004 ? h - 0.05 : -0.04);
      col.setXYZ(k, c[0] * 0.55, c[1] * 0.55, c[2] * 0.55);
      if (h < 0.02) continue;
      const i = k % f.nx, j = (k / f.nx) | 0, lvl = Math.floor(h * 12);   // re-tumble a cell's lumps as its level changes
      for (let q = 0; q < this.per; q++) {
        const a = hash2(k, q, 1), b = hash2(k, q, 2), r = hash2(k, lvl, 3 + q), size = f.cs * (0.62 + 0.5 * a) / (this.per > 1 ? 1.25 : 1);
        _o.position.set(f.cx(i) + (a - 0.5) * f.cs * 0.7, Math.max(0.02, h - size * 0.28 - q * size * 0.25), f.cz(j) + (b - 0.5) * f.cs * 0.7);
        _o.rotation.set(r * 6.28, b * 6.28, a * 3.1); _o.scale.set(size, size * (0.7 + 0.5 * b), size * (0.8 + 0.4 * r)); _o.updateMatrix();
        this.grains.setMatrixAt(n, _o.matrix);
        const t = 0.78 + 0.4 * hash2(k, q, 9); C[n * 3] = c[0] * t; C[n * 3 + 1] = c[1] * t; C[n * 3 + 2] = c[2] * t; n++;
      }
    }
    pos.needsUpdate = true; col.needsUpdate = true; this.mesh.visible = any;
    this.grains.count = n; this.grains.instanceMatrix.needsUpdate = true; this.grains.instanceColor.needsUpdate = true;
  }
}
