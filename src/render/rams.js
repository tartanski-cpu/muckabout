// Hydraulic rams that work: each of a machine's links is a barrel fixed at one end and a chrome rod to the other,
// re-aimed every frame, so cylinders extend and swing with the boom, bucket, blade, bed, legs and steering.
// Two instanced meshes for every ram on every machine (two draw calls in all).
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _o = new THREE.Object3D(), UP = new THREE.Vector3(0, 1, 0);
export class Rams {
  constructor(scene, machines, cap = 96) {
    this.machines = machines;
    const mk = (color, seg) => { const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, seg), new THREE.MeshLambertMaterial({ color, flatShading: true }), cap); m.frustumCulled = false; m.count = 0; scene.add(m); return m; };
    this.barrels = mk(0x242427, 8); this.rods = mk(0xc4c8cc, 6);
  }
  _put(mesh, i, from, to, r) {
    _d.subVectors(to, from); const len = _d.length(); if (len < 1e-4) return;
    _o.position.copy(from).addScaledVector(_d, 0.5); _o.quaternion.setFromUnitVectors(UP, _d.divideScalar(len)); _o.scale.set(r, len, r); _o.updateMatrix(); mesh.setMatrixAt(i, _o.matrix);
  }
  update() {
    let n = 0;
    for (const m of this.machines) for (const l of m.links) {
      l.a.localToWorld(_a.copy(l.pa)); l.b.localToWorld(_b.copy(l.pb));
      const len = _a.distanceTo(_b), rest = l.rest ??= len, barrel = Math.min(rest * l.barrel + 0.05, len * 0.92); // barrel length is fixed; the rod makes up the rest
      _d.subVectors(_b, _a).normalize();
      this._put(this.barrels, n, _a, _o.position.copy(_a).addScaledVector(_d, barrel).clone(), l.r);
      this._put(this.rods, n, _a.clone().addScaledVector(_d, barrel * 0.5), _b, l.r * 0.55);
      n++;
    }
    this.barrels.count = this.rods.count = n; this.barrels.instanceMatrix.needsUpdate = this.rods.instanceMatrix.needsUpdate = true;
  }
}
