// Physical cab controls: Lever1D, Joystick2D, SteeringWheel, Key, Button, Toggle, Handrail.
// Design ported from SWVR (src/controls/Control.ts, Lever.ts, Wheel.ts, Joystick.ts, ignition.ts):
//   - a control is a small Object3D tree in its machine's frame; all hand maths is done in the control's
//     local frame, so the machine bouncing around cannot jolt it;
//   - 'grab' controls follow the hand's POSITION (never where it points); 'press' controls are poked;
//   - lever = hand travel along the arc / length, with a magnetic detent and a click going in;
//   - wheel = change of hand angle round the axis, so it works multi-turn and hand over hand.
// Differences: each control exposes `value` directly (machines read it every step), detents are a list,
// and `handlePose` tells the hand visual where to sit while holding ("elastic hands").
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp } from '../../util/rng.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Color();
/** Non-indexed copy of a geometry, moved to (x, y, z) and given one vertex colour, ready to merge. */
export function paint(geo, color, x = 0, y = 0, z = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone(); g.translate(x, y, z); g.deleteAttribute('uv');
  _c.setHex(color); const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
const HOVER = 0x335533;

export function labelPlate(text, width = 0.14) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48;
  const g = c.getContext('2d'); g.fillStyle = '#10161a'; g.fillRect(0, 0, 256, 48);
  g.fillStyle = '#ffd25a'; g.font = 'bold 22px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 25, 244);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width * 48 / 256), new THREE.MeshBasicMaterial({ map: t }));
}

export class Control {
  constructor(def) {
    this.def = def; this.name = def.name; this.kind = 'grab';
    this.root = new THREE.Group(); this.root.name = 'control:' + def.name; this.root.position.fromArray(def.pos);
    if (def.rot) this.root.rotation.fromArray(def.rot);
    this.value = def.init ?? 0; this.holders = []; this.enabled = true; this.hovered = false; this.mats = [];
    this.onChange = null;
    this.fixedParts = [];   // geometry that never moves: merged per machine into one mesh (decor.js)
    this.label = def.label ? { text: def.label, width: def.labelWidth ?? 0.13, pos: [0, 0.002, 0.075], rot: [-Math.PI / 2, 0, 0] } : null;
  }
  get held() { return this.holders.length > 0; }
  mat(color) { const m = new THREE.MeshLambertMaterial({ color, flatShading: true }); this.mats.push(m); return m; }
  /** A static part (base, housing): painted geometry in the control's frame, drawn in the machine's merged decor mesh. */
  fixed(geo, color, x = 0, y = 0, z = 0) { this.fixedParts.push(paint(geo, color, x, y, z)); }
  /** The moving part: several painted geometries merged into ONE mesh that glows when hovered. parts: [geo, color, x, y, z][] */
  moving(parts, parent = this.root) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }); this.mats.push(m);
    const mesh = new THREE.Mesh(mergeGeometries(parts.map((p) => paint(...p))), m); parent.add(mesh); return mesh;
  }
  setHover(on) { if (on === this.hovered) return; this.hovered = on; for (const m of this.mats) m.emissive.setHex(on ? HOVER : 0); }
  local(world, out = _v) { return this.root.worldToLocal(out.copy(world)); }
  /** Distance from a world point to the part you'd take hold of. */
  distanceTo(world) { return this.local(world).length(); }
  /** World pose for the hand visual while holding. Default: the grab point, controller orientation. */
  handlePose(hand, pos, quat) { this.grabPoint(pos); quat.copy(hand.quat); }
  grabPoint(out) { return this.root.getWorldPosition(out); }
  grabStart(hand) { this.holders.push(hand); }
  grabMove(_hand) {}
  grabEnd(hand) { const i = this.holders.indexOf(hand); if (i >= 0) this.holders.splice(i, 1); }
  press(_hand) {} release(_hand) {}
  tick(_dt) {}
  /** Set programmatically (keyboard debug path, network). */
  set(v) { this.value = v; this.show(); }
  show() {}
  changed() { if (this.onChange) this.onChange(this); }
}

/** One-axis lever pivoting about local X. value: -1 (pulled back, +z) .. +1 (pushed forward, -z), or range [a, b]. */
export class Lever1D extends Control {
  constructor(def) {
    super(def);
    this.len = def.length ?? 0.18; this.max = def.maxAngle ?? 0.5; this.range = def.range ?? [-1, 1];
    this.detents = def.detents ?? null; this.spring = !!def.spring; this.catch = def.catch ?? 0.14; this.inDetent = true;
    this.fixed(new THREE.BoxGeometry(0.05, 0.02, 0.09), 0x2b2b2b);
    this.arm = new THREE.Group(); this.root.add(this.arm);
    this.moving([[new THREE.CylinderGeometry(0.008, 0.01, this.len, 6), 0x9a9c9e, 0, this.len / 2, 0], [new THREE.SphereGeometry(0.026, 8, 6), def.color ?? 0x1c1c1c, 0, this.len, 0]], this.arm);
    this.knob = new THREE.Object3D(); this.knob.position.y = this.len; this.arm.add(this.knob);
    this.show();
  }
  get theta() { const [a, b] = this.range, t = (this.value - a) / (b - a); return (0.5 - t) * 2 * this.max; }
  show() { this.arm.rotation.x = this.theta; }
  distanceTo(world) { // anywhere along the upper half of the handle counts (SWVR)
    const p = this.local(world), th = this.theta, dy = Math.cos(th), dz = Math.sin(th);
    const t = clamp(p.y * dy + p.z * dz, this.len * 0.4, this.len);
    return Math.hypot(p.x, p.y - dy * t, p.z - dz * t);
  }
  grabPoint(out) { return this.knob.getWorldPosition(out); }
  grabStart(hand) { super.grabStart(hand); this.g0 = this.theta; this.z0 = this.local(hand.pos).z; }
  grabMove(hand) {
    const th = clamp(this.g0 + (this.local(hand.pos).z - this.z0) / this.len, -this.max, this.max);
    const [a, b] = this.range; let v = a + (0.5 - th / (2 * this.max)) * (b - a);
    if (this.detents) { // magnetic notches: easy to find, a little sticky to leave, click going in
      let near = this.detents[0]; for (const d of this.detents) if (Math.abs(d - v) < Math.abs(near - v)) near = d;
      const inD = Math.abs(v - near) < this.catch + (this.inDetent && near === this.lastDetent ? 0.06 : 0);
      if (inD) v = near;
      if (inD && (!this.inDetent || near !== this.lastDetent)) hand.pulse(1, 60); else if (!inD && this.inDetent) hand.pulse(0.4, 25);
      this.inDetent = inD; this.lastDetent = near;
    }
    if (v !== this.value) { this.value = v; this.show(); this.changed(); }
  }
  grabEnd(hand) {
    super.grabEnd(hand);
    if (this.detents && !this.inDetent) { let near = this.detents[0]; for (const d of this.detents) if (Math.abs(d - this.value) < Math.abs(near - this.value)) near = d; this.value = near; this.inDetent = true; this.lastDetent = near; this.show(); this.changed(); }
  }
  tick(dt) { if (this.spring && !this.held && this.value !== 0 && !this.keyed) { this.value = Math.abs(this.value) < 0.02 ? 0 : this.value * Math.max(0, 1 - dt * 12); this.show(); } }
}

/** Two-axis spring-return joystick. value = {x: right +, y: forward +}, each -1..1. */
export class Joystick2D extends Control {
  constructor(def) {
    super(def); this.value = { x: 0, y: 0 }; this.travel = def.travel ?? 0.07; this.h = def.height ?? 0.16; this.keyed = false;
    this.fixed(new THREE.CylinderGeometry(0.035, 0.045, 0.02, 8), 0x2b2b2b);
    this.stick = new THREE.Group(); this.root.add(this.stick);
    this.moving([[new THREE.CylinderGeometry(0.012, 0.016, this.h - 0.02, 6), 0x6d6e70, 0, (this.h - 0.02) / 2, 0], [new THREE.SphereGeometry(0.035, 8, 6), 0x1c1c1c, 0, this.h, 0]], this.stick);
    this.knob = new THREE.Object3D(); this.knob.position.y = this.h; this.stick.add(this.knob);
    this.g = new THREE.Vector3();
  }
  show() { this.stick.rotation.set(-this.value.y * 0.35, 0, -this.value.x * 0.35); }
  distanceTo(world) { return this.local(world).distanceTo(_w.set(0, this.h, 0)); }
  grabPoint(out) { return this.knob.getWorldPosition(out); }
  grabStart(hand) { super.grabStart(hand); this.local(hand.pos, this.g); }
  grabMove(hand) {
    const p = this.local(hand.pos);
    this.value.x = clamp((p.x - this.g.x) / this.travel, -1, 1); this.value.y = clamp(-(p.z - this.g.z) / this.travel, -1, 1);
    this.show(); this.changed();
  }
  grabEnd(hand) { super.grabEnd(hand); if (!this.held) { this.value.x = this.value.y = 0; this.show(); this.changed(); } }
  set(v) { this.value.x = v.x; this.value.y = v.y; this.show(); }
}

/** Multi-turn steering wheel in the local XY plane, axis +Z toward the driver. value: -1 (full left) .. +1 (full right). */
export class SteeringWheel extends Control {
  constructor(def) {
    super(def); this.radius = def.radius ?? 0.19; this.maxAngle = (def.turns ?? 1.4) * Math.PI; this.angle = 0; this.multi = true;
    this.prev = new Map(); this.offs = new Map(); this.click = 0;
    if (def.tilt) this.root.rotation.x = def.tilt;
    this.fixed(new THREE.CylinderGeometry(0.035, 0.045, 0.4, 6).rotateX(Math.PI / 2), 0x3a3a3c, 0, 0, -0.2);
    this.spin = new THREE.Group(); this.root.add(this.spin);
    this.moving([[new THREE.TorusGeometry(this.radius, 0.022, 6, 20), 0x2b2b2b], [new THREE.BoxGeometry(this.radius * 2, 0.03, 0.03), 0x2b2b2b],
      [new THREE.SphereGeometry(0.03, 6, 4), 0xc9381e, this.radius * 0.84, this.radius * 0.47, 0.03]], this.spin);
  }
  show() { this.angle = -this.value * this.maxAngle; this.spin.rotation.z = this.angle; }
  distanceTo(world) { const l = this.local(world); return Math.hypot(Math.hypot(l.x, l.y) - this.radius, l.z); }
  _phi(hand) { const l = this.local(hand.pos); return Math.atan2(l.y, l.x); }
  grabStart(hand) { super.grabStart(hand); const phi = this._phi(hand); this.prev.set(hand, phi); this.offs.set(hand, phi - this.angle); }
  grabMove(hand) {
    const phi = this._phi(hand), before = this.prev.get(hand) ?? phi; this.prev.set(hand, phi);
    let d = phi - before; d = Math.atan2(Math.sin(d), Math.cos(d));
    const next = clamp(this.angle + d / Math.max(1, this.holders.length), -this.maxAngle, this.maxAngle), moved = next - this.angle;
    if (next !== this.angle && Math.abs(next) === this.maxAngle) hand.pulse(0.7, 40);   // hard over
    this.angle = next; this.spin.rotation.z = next; this.value = -next / this.maxAngle;
    this.click += Math.abs(moved); if (this.click > Math.PI / 6) { this.click = 0; hand.pulse(0.2, 12); } // spokes passing
    if (moved) this.changed();
  }
  grabEnd(hand) { super.grabEnd(hand); this.prev.delete(hand); this.offs.delete(hand); }
  handlePose(hand, pos, quat) { // the hand rides the rim where it took hold
    const a = (this.offs.get(hand) ?? 0) + this.angle;
    this.root.localToWorld(pos.set(Math.cos(a) * this.radius, Math.sin(a) * this.radius, 0)); quat.copy(hand.quat);
  }
}

/** Ignition key: take hold and twist clockwise to turn on (or just grab and let go to flip it). value 0 / 1. */
export class Key extends Control {
  constructor(def) {
    super(def);
    this.fixed(new THREE.CylinderGeometry(0.03, 0.034, 0.012, 12), 0xa8acb0, 0, 0.006, 0);
    this.key = new THREE.Group(); this.key.position.y = 0.012; this.root.add(this.key);
    this.moving([[new THREE.BoxGeometry(0.006, 0.03, 0.014), 0xc8b060, 0, 0.025, 0], [new THREE.BoxGeometry(0.008, 0.032, 0.04), 0x202326, 0, 0.055, 0]], this.key);
    this.bow = new THREE.Object3D(); this.bow.position.y = 0.055; this.key.add(this.bow);
    this.show();
  }
  show() { this.key.rotation.y = this.value > 0.5 ? -Math.PI / 2 : 0; }
  distanceTo(world) { return this.local(world).distanceTo(_w.set(0, 0.05, 0)); }
  grabPoint(out) { return this.bow.getWorldPosition(out); }
  _roll(hand) { // hand roll about the key's axis (local Y), from where the hand's X axis points
    _w.set(1, 0, 0).applyQuaternion(hand.quat).applyQuaternion(_q.copy(this.root.getWorldQuaternion(_q)).invert());
    return Math.atan2(-_w.z, _w.x);
  }
  grabStart(hand) { super.grabStart(hand); this.r0 = this._roll(hand); this.twisted = false; this.v0 = this.value; }
  grabMove(hand) {
    let d = this._roll(hand) - this.r0; d = Math.atan2(Math.sin(d), Math.cos(d));
    const want = d < -0.6 ? 1 : d > 0.6 ? 0 : null; // clockwise seen from above = on
    if (want !== null && want !== this.value) { this.value = want; this.twisted = true; this.show(); hand.pulse(0.6, 40); this.changed(); }
    else if (want !== null) this.twisted = true;
    this.key.rotation.y = this.value > 0.5 ? -Math.PI / 2 + clamp(d + 0.6, -0.2, 0.2) * 0 : clamp(d, -1.2, 0.2);
  }
  grabEnd(hand) { super.grabEnd(hand); if (!this.twisted) { this.value = this.v0 > 0.5 ? 0 : 1; hand.pulse(0.6, 40); this.changed(); } this.show(); }
}

/** Momentary push button: poke it, or pull the trigger with the hand on it. value 1 while pressed. */
export class Button extends Control {
  constructor(def) {
    super(def); this.kind = 'press';
    this.fixed(new THREE.CylinderGeometry(0.026, 0.03, 0.012, 10), 0x2b2b2b, 0, 0.006, 0);
    this.cap = this.moving([[new THREE.CylinderGeometry(0.02, 0.02, 0.016, 10), def.color ?? 0xc9381e]]); this.cap.position.y = 0.02;
  }
  show() { this.cap.position.y = this.value > 0.5 ? 0.014 : 0.02; }
  distanceTo(world) { return this.local(world).distanceTo(_w.set(0, 0.02, 0)); }
  press(hand) { if (this.value > 0.5) return; this.value = 1; this.show(); hand?.pulse(0.6, 30); this.changed(); }
  release() { if (this.value < 0.5) return; this.value = 0; this.show(); this.changed(); }
}

/** Two-position rocker: each press flips it. value 0 / 1. */
export class Toggle extends Control {
  constructor(def) {
    super(def); this.kind = 'press';
    this.fixed(new THREE.BoxGeometry(0.05, 0.012, 0.06), 0x2b2b2b, 0, 0.006, 0);
    // the rocker carries its own tell-tale: a green end that shows when it is on
    this.rocker = this.moving([[new THREE.BoxGeometry(0.03, 0.014, 0.05), def.color ?? 0xd9a015], [new THREE.BoxGeometry(0.031, 0.015, 0.012), 0x33dd55, 0, 0, -0.02]]); this.rocker.position.y = 0.018;
    this.show();
  }
  show() { this.rocker.rotation.x = this.value > 0.5 ? -0.35 : 0.35; } // on = pressed down at the far (green) end
  distanceTo(world) { return this.local(world).distanceTo(_w.set(0, 0.02, 0)); }
  press(hand) { this.value = this.value > 0.5 ? 0 : 1; this.show(); hand?.pulse(0.5, 30); this.changed(); }
}

/** A grab handle that triggers an action (climb into the cab). */
export class Handrail extends Control {
  constructor(def) {
    super(def); this.len = def.length ?? 0.5; this.onGrab = null;
    this.moving([[new THREE.CylinderGeometry(0.018, 0.018, this.len, 6), 0xf0e040]]);
    if (this.label) { this.label.rot = [0, -Math.PI / 2, 0]; this.label.pos = [-0.03, this.len / 2 + 0.05, 0]; this.label.width = 0.26; }
  }
  distanceTo(world) { const p = this.local(world), t = clamp(p.y, -this.len / 2, this.len / 2); return Math.hypot(p.x, p.y - t, p.z); }
  grabStart(hand) { super.grabStart(hand); hand.pulse(0.5, 40); if (this.onGrab) this.onGrab(hand, this); }
}

const TYPES = { lever: Lever1D, joystick: Joystick2D, wheel: SteeringWheel, key: Key, button: Button, toggle: Toggle, handrail: Handrail };
export function makeControl(def) { return new TYPES[def.type](def); }
