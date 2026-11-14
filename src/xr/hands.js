// Visible hands: SWVR's faceted low-poly hands (handShapes.js), one mesh per hand whose geometry is swapped per pose:
// open at rest, a fist while gripping, a pointing finger while the laser is on a button.
// "Elastic": while a hand holds a control the hand sits on the control's handle, not on the controller, and eases
// back when released.
import * as THREE from 'three';
import { handShape } from './handShapes.js';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion();
const GLOVE = 0xe0a13a, CUFF = 0x2f5f9e;

export class Hands {
  constructor(scene) {
    this.h = {};
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const side of ['left', 'right']) {
      const s = side === 'left' ? -1 : 1, geo = { rest: handShape(GLOVE, CUFF, s, 'rest'), fist: handShape(GLOVE, CUFF, s, 'fist'), point: handShape(GLOVE, CUFF, s, 'point') };
      const root = new THREE.Mesh(geo.rest, mat); root.visible = false; root.frustumCulled = false; scene.add(root);
      this.h[side] = { root, geo, pose: 'rest', snapped: 0 };
    }
  }
  /** After interaction.update: place each hand on its controller, or on the handle it is holding. */
  update(hands, dt) {
    for (const side of ['left', 'right']) {
      const h = hands[side], v = this.h[side];
      v.root.visible = h.tracked; if (!h.tracked) continue;
      const pose = h.gripDown || h.holding ? 'fist' : h.pointing ? 'point' : 'rest';
      if (pose !== v.pose) { v.pose = pose; v.root.geometry = v.geo[pose]; }
      if (h.holding) { h.holding.handlePose(h, _p, _q); v.snapped = 1; v.root.position.copy(_p); v.root.quaternion.copy(_q); }
      else if (v.snapped > 0.01) { // ease back to the controller after letting go
        v.snapped *= Math.max(0, 1 - dt * 14);
        v.root.position.lerp(h.pos, 1 - v.snapped); v.root.quaternion.slerp(h.quat, 1 - v.snapped);
      } else { v.root.position.copy(h.pos); v.root.quaternion.copy(h.quat); }
    }
  }
}
