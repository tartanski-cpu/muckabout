// The hands, brought across from SWVR (src/player/handShapes.ts, 4 Nov 2026): chunky, faceted, low-poly hands with
// real fingers. Same shapes, joint angles and proportions; only the plumbing differs (this project's vertex-colour
// helper, plain JS). One merged geometry per pose: no animation, a gesture swaps the whole shape.
//
// Frame: -z forward (where the index finger points), +y up, the controller's handle running up and down through the
// fist at the origin, the back of the hand out to the side (+x for the right hand, side +1; -x for the left), wrist +z.
// The whole hand is then pitched 40° to sit right on a Quest controller (SWVR's CONFIG.avatar.handTurn).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint } from './controls/index.js';

const D = Math.PI / 180;
export const HAND_TURN = { pitchDeg: 40, rollDeg: 0, yawDeg: 0 };
/** The fingers, index to little: knuckle height, segment lengths (base, middle, tip), thickness (radius). Metres. */
const FINGERS = [
  { y: 0.0305, len: [0.036, 0.022, 0.019], r: 0.0118 },
  { y: 0.0095, len: [0.039, 0.025, 0.02], r: 0.0122 },
  { y: -0.0115, len: [0.036, 0.023, 0.019], r: 0.0116 },
  { y: -0.0315, len: [0.029, 0.018, 0.016], r: 0.0104 },
];
const KNUCKLE = { x: 0.03, z: -0.031 };
/** Each pose's bend at each finger's three joints (degrees, round the handle toward the palm), index first. */
const CURLS = {
  rest: [[14, 12, 8], [24, 20, 12], [30, 24, 14], [36, 28, 16]],
  fist: [[94, 100, 66], [96, 102, 68], [96, 102, 68], [94, 100, 66]],
  point: [[2, 2, 2], [96, 102, 68], [96, 102, 68], [94, 100, 66]],
};
const THUMB = { root: [0.016, 0.032, 0.012], len: [0.034, 0.028], r: 0.0128 };
const THUMBS = {
  rest: [[0.55, 0.12, -0.83], [0.62, -0.02, -0.78]],
  fist: [[0.3, 0.02, -0.95], [0.8, -0.35, -0.48]],
  point: [[0.3, 0.0, -0.95], [0.82, -0.42, -0.4]],
};
const UP = new THREE.Vector3(0, 1, 0);

/** A faceted capsule from a to b. */
function segment(a, b, r, colour) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 0.6), 2, 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  return paint(g, colour, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** The hand in a pose, for one side (+1 right, -1 left), already turned to sit on the controller. */
export function handShape(colour, cuff, side, pose) {
  const s = side, parts = [];
  parts.push(paint(new RoundedBoxGeometry(0.032, 0.088, 0.074, 1, 0.011), colour, s * 0.03, -0.001, 0.009)); // back of the hand
  FINGERS.forEach((f, i) => {
    const at = new THREE.Vector3(s * KNUCKLE.x, f.y, KNUCKLE.z); let turn = 0;
    const droop = (i - 1.5) * -0.08; // the little finger a shade lower, the index a shade higher at the tip: a fan
    CURLS[pose][i].forEach((bend, j) => {
      turn += bend * D;
      const dir = new THREE.Vector3(-s * Math.sin(turn), droop * (j === 0 ? 0 : 1) * 0.3, -Math.cos(turn)).normalize();
      const to = at.clone().addScaledVector(dir, f.len[j]);
      parts.push(segment(at, to, f.r * (j === 2 ? 0.92 : 1), colour)); at.copy(to);
    });
  });
  const root = new THREE.Vector3(s * THUMB.root[0], THUMB.root[1], THUMB.root[2]);
  parts.push(segment(new THREE.Vector3(s * 0.03, 0.022, 0.03), root, THUMB.r * 1.15, colour)); // the thumb's base, joining it to the hand
  let at = root;
  THUMBS[pose].forEach(([x, y, z], j) => {
    const to = at.clone().addScaledVector(new THREE.Vector3(-s * x, y, z).normalize(), THUMB.len[j]);
    parts.push(segment(at, to, THUMB.r * (j ? 0.92 : 1), colour)); at = to;
  });
  parts.push(paint(new THREE.CylinderGeometry(0.024, 0.026, 0.02, 8).scale(0.8, 1, 1.35).rotateX(Math.PI / 2 + 0.4), cuff, s * 0.03, -0.008, 0.05)); // cuff
  const g = mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p.index ? p.toNonIndexed() : p; }));
  const t = HAND_TURN;
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(t.yawDeg * D).multiply(new THREE.Matrix4().makeRotationZ(t.rollDeg * D)).multiply(new THREE.Matrix4().makeRotationX(-t.pitchDeg * D)));
  g.computeVertexNormals();
  return g;
}
