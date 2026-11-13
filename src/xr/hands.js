// Visible hands. Low-poly gloves in the style of SWVR's (src/player/handShapes.ts): built with fingers along
// -Z, then pitched 40° to sit right on a Quest controller (SWVR's empirical fit, CONFIG.avatar.handTurn).
// "Elastic": while a hand holds a control the glove sits on the control's handle, not on the controller,
// and eases back when released.
import * as THREE from 'three';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion();

function glove(side, fist) {
  const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color: 0xe0a13a, flatShading: true }), s = side === 'left' ? -1 : 1;
  const add = (w, h, d, x, y, z, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; g.add(b); };
  add(0.088, 0.032, 0.074, 0, 0, 0);                                    // back of the hand
  if (fist) add(0.084, 0.05, 0.04, 0, -0.03, -0.045, 0.2); else add(0.084, 0.024, 0.07, 0, 0.002, -0.07); // fingers
  add(0.026, 0.026, 0.06, -s * 0.055, -0.006, fist ? -0.03 : -0.02, 0); // thumb
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.05, 8).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2f5f9e })); cuff.position.z = 0.06; g.add(cuff);
  g.rotation.x = -40 * Math.PI / 180;
  const wrap = new THREE.Group(); wrap.add(g); return wrap;
}

export class Hands {
  constructor(scene) {
    this.h = {};
    for (const side of ['left', 'right']) {
      const root = new THREE.Group(), open = glove(side, false), fist = glove(side, true);
      root.add(open, fist); root.visible = false; scene.add(root);
      this.h[side] = { root, open, fist, snapped: 0 };
    }
  }
  /** After interaction.update: place each glove on its controller, or on the handle it is holding. */
  update(hands, dt) {
    for (const side of ['left', 'right']) {
      const h = hands[side], v = this.h[side];
      v.root.visible = h.tracked; if (!h.tracked) continue;
      v.fist.visible = h.gripDown || !!h.holding; v.open.visible = !v.fist.visible;
      if (h.holding) { h.holding.handlePose(h, _p, _q); v.snapped = 1; v.root.position.copy(_p); v.root.quaternion.copy(_q); }
      else if (v.snapped > 0.01) { // ease back to the controller after letting go
        v.snapped *= Math.max(0, 1 - dt * 14);
        v.root.position.lerp(h.pos, 1 - v.snapped); v.root.quaternion.slerp(h.quat, 1 - v.snapped);
      } else { v.root.position.copy(h.pos); v.root.quaternion.copy(h.quat); }
    }
  }
}
