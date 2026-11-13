// The other player: a head, a body and two gloves, eased toward the poses the network delivers
// (SWVR's remote figures do the same: root lerp dt·15, hands dt·20).
import * as THREE from 'three';

export class Avatar {
  constructor(scene, color = 0x2f8fd0) {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true }), skin = new THREE.MeshLambertMaterial({ color: 0xe0a13a, flatShading: true });
    this.root = new THREE.Group(); scene.add(this.root);
    this.head = new THREE.Group(); this.root.add(this.head);
    this.head.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.22), skin));
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.09, 8), new THREE.MeshLambertMaterial({ color: 0xf0e040 })); hat.position.y = 0.15; this.head.add(hat);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.02), new THREE.MeshLambertMaterial({ color: 0x1c1c1c })); visor.position.set(0, 0.03, -0.115); this.head.add(visor);
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.24), m); this.root.add(this.body);
    this.hands = [0, 1].map(() => { const h = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.12), skin); this.root.add(h); return h; });
    this.first = true; this.t = new THREE.Vector3(); this.q = new THREE.Quaternion();
  }
  /** pose: {h:[x,y,z,qx,qy,qz,qw], l: same|null, r: same|null} in world space. */
  update(pose, dt) {
    if (!pose) { this.root.visible = false; return; }
    this.root.visible = true;
    const k = this.first ? 1 : Math.min(1, dt * 15), kh = this.first ? 1 : Math.min(1, dt * 20); this.first = false;
    this.head.position.lerp(this.t.fromArray(pose.h), k); this.head.quaternion.slerp(this.q.fromArray(pose.h, 3), k);
    this.body.position.set(this.head.position.x, this.head.position.y - 0.48, this.head.position.z);
    const e = new THREE.Euler().setFromQuaternion(this.head.quaternion, 'YXZ'); this.body.rotation.set(0, e.y, 0);
    [pose.l, pose.r].forEach((p, i) => { const h = this.hands[i]; h.visible = !!p; if (p) { h.position.lerp(this.t.fromArray(p), kh); h.quaternion.slerp(this.q.fromArray(p, 3), kh); } });
  }
  dispose() { this.root.removeFromParent(); }
}
