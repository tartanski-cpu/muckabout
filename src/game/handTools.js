// Hand tools, lying in the yard for whoever picks them up (grip to take hold, as with any control):
//
//   shovel   for small clean-ups. Its blade is a little cutting edge, exactly like a machine's bucket: pushed into the
//            ground it takes soil (up to a shovelful), and turned over, or with the trigger, it throws it off as clods.
//            The soil on it is counted in the volume audit like any other load.
//   stakes   two grading stakes with a string line between them, and droppers hanging from it to the ground every
//            half metre, coloured by how the ground there stands against the grade: green on it, red high (cut),
//            blue low (fill). Level (pink): the grade is the first stake's foot all the way along. Sloped (orange),
//            for ramps and roads: the line runs from the top of one stake to the top of the other, and the grade is
//            the straight line between their feet. The trigger, with a stake in the hand, switches between the two.
//   chain    a tow chain with a hook at each end. Let a hook go at the front or back of a machine and it hitches
//            there. When the chain comes taut between two machines it pulls on both (Machine.tow), so one can drag
//            another out of the bog.
//
// A tool let go of drops to the ground where it is (a stake plants itself upright; the shovel stands in the soil).
//
// Co-op (roadmap 0b): one set of tools, owned by the host. A player on a client who picks one up carries it on their
// own screen at once, and sends where it is to the host (session.js), which moves its copy there: the shovel digs on
// the host, as everything that moves soil does, and a hook let go hitches on the host. The host sends every tool's
// pose and who has it; a tool somebody else has cannot be taken (`remote` names its holder).
import * as THREE from 'three';
import { Control } from '../xr/controls/index.js';
import { CutTool } from '../terrain/tool.js';
import { MATERIALS, NMAT } from '../terrain/materials.js';

const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _o = new THREE.Object3D();
const UP = new THREE.Vector3(0, 1, 0);
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r, len, seg = 7) => new THREE.CylinderGeometry(r, r, len, seg);

/** A thing you carry: follows the hand while held, and is put down where you let go. */
class Carried extends Control {
  constructor(name, game) { super({ name, pos: [0, 0, 0] }); this.game = game; this.reachBonus = 0.06; this.carried = true; this.grip = new THREE.Vector3(); this.remote = null; this.remoteTrigger = 0; }
  /** Held here, or by another player (co-op). */
  get held() { return this.holders.length > 0 || !!this.remote; }
  /** Distance to the part you take hold of: a segment from `grip` up the handle. */
  distanceTo(world) { const p = this.local(world); p.z -= THREE.MathUtils.clamp(p.z, this.gripZ[0], this.gripZ[1]); p.y -= THREE.MathUtils.clamp(p.y, this.gripY[0], this.gripY[1]); return p.length(); }
  grabPoint(out) { return this.root.localToWorld(out.copy(this.grip)); }
  grabStart(hand) { super.grabStart(hand); this.hand = hand; }
  grabMove(hand) { this.root.quaternion.copy(hand.quat).multiply(this.holdQ); this.root.position.copy(hand.pos).sub(_v.copy(this.grip).applyQuaternion(this.root.quaternion)); }
  grabEnd(hand) { super.grabEnd(hand); this.hand = null; this.rest(); }
  handlePose(hand, pos, quat) { pos.copy(hand.pos); quat.copy(hand.quat); }
  ground(x, z) { return this.game.terrain.heightAt(x, z); }
}
Carried.prototype.gripZ = [0, 0]; Carried.prototype.gripY = [0, 0]; Carried.prototype.holdQ = new THREE.Quaternion();

// ------------------------------------------------------------------------------------------------------------ shovel
const SHOVEL_CAP = 0.045; // m³: a heaped shovelful (unrealistically generous, like the buckets)
class Shovel extends Carried {
  constructor(game) {
    super('shovel', game);
    // in its own frame the shaft runs along -z from the hand, dipping, with the blade at the far end
    this.gripZ = [-0.55, 0.12]; this.holdQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, 0, 0));
    this.moving([[cyl(0.018, 1.15).rotateX(Math.PI / 2), 0x9a6b3a, 0, 0, -0.5], [box(0.11, 0.03, 0.03), 0x9a6b3a, 0, 0, 0.08], [box(0.03, 0.03, 0.1), 0x9a6b3a, -0.045, 0, 0.03], [box(0.03, 0.03, 0.1), 0x9a6b3a, 0.045, 0, 0.03],
      [box(0.24, 0.012, 0.3), 0x8a8f96, 0, -0.012, -1.2], [box(0.012, 0.035, 0.3), 0x8a8f96, -0.12, 0, -1.2], [box(0.012, 0.035, 0.3), 0x8a8f96, 0.12, 0, -1.2], [box(0.24, 0.035, 0.012), 0x8a8f96, 0, 0, -1.05]]);
    this.cut = new CutTool('shovel', [[-0.12, -0.02, -1.06], [0.12, -0.02, -1.06], [-0.12, -0.02, -1.35], [0.12, -0.02, -1.35]], 0.12);
    this.load = new Float64Array(NMAT);
    this.heap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13, 0), new THREE.MeshLambertMaterial({ flatShading: true })); this.heap.position.set(0, 0.02, -1.2); this.heap.visible = false; this.root.add(this.heap);
    this.prev = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.cooldown = 0;
  }
  volume() { let s = 0; for (let k = 1; k < NMAT; k++) s += this.load[k]; return s; }
  /** Once per sim step. */
  step(dt, clods) {
    const T = this.game.terrain; this.root.updateMatrixWorld(true);
    const tip = this.root.localToWorld(_a.set(0, 0, -1.2)); this.vel.copy(tip).sub(this.prev).divideScalar(dt); this.prev.copy(tip);
    const res = this.cut.step(this.root.matrixWorld.elements, T, Math.max(0, SHOVEL_CAP - this.volume()), this.held);
    if (res) { let got = 0; for (let k = 1; k < NMAT; k++) if (res.taken[k] > 0) { this.load[k] += res.taken[k]; got += res.taken[k]; } if (got > 0.0005 && this.hand) this.hand.pulse(Math.min(1, 0.3 + got * 60), 25); }
    // throw it off: the blade turned over, or the trigger
    this.cooldown -= dt;
    const over = _b.set(0, 1, 0).applyQuaternion(this.root.quaternion).y < 0.25, vol = this.volume();
    if (vol > 1e-5 && this.held && (over || (this.hand && this.hand.trigger > 0.6) || this.remoteTrigger > 0.6) && this.cooldown <= 0) {
      const sp = this.vel.length() > 6 ? 6 / this.vel.length() : 1;
      for (let k = 1; k < NMAT; k++) if (this.load[k] > 0) { clods.pour('shovel', tip.x, tip.y + 0.05, tip.z, this.vel.x * sp, this.vel.y * sp + 0.6, this.vel.z * sp, k, this.load[k], 0.6); this.load[k] = 0; }
      this.cooldown = 0.3; if (this.hand) this.hand.pulse(0.5, 40);
    }
    if (!this.held && vol > 1e-5) { for (let k = 1; k < NMAT; k++) if (this.load[k] > 0) { clods.pour('shovel', tip.x, tip.y + 0.05, tip.z, 0, 0, 0, k, this.load[k], 0.3); this.load[k] = 0; } } // put down with soil on it: the soil falls off
    const v = this.volume(); this.heap.visible = v > 0.002;
    if (this.heap.visible) { let top = 1; for (let k = 2; k < NMAT; k++) if (this.load[k] > this.load[top]) top = k; this.heap.material.color.setRGB(...MATERIALS[top].color); const s = 0.5 + 0.7 * Math.cbrt(v / SHOVEL_CAP); this.heap.scale.set(s, s * 0.6, s * 1.1); }
  }
  rest() { // stands in the ground where its blade was, shaft leaning back
    this.root.updateMatrixWorld(true); const tip = this.root.localToWorld(_a.set(0, 0, -1.3));
    const e = new THREE.Euler().setFromQuaternion(this.root.quaternion, 'YXZ');
    this.root.quaternion.setFromEuler(new THREE.Euler(-1.25, e.y, 0, 'YXZ'));
    this.root.position.set(tip.x, this.ground(tip.x, tip.z) - 0.1, tip.z).sub(_v.set(0, 0, -1.3).applyQuaternion(this.root.quaternion));
    this.cut.reset();
  }
}

// ------------------------------------------------------------------------------------------------------------ stakes
const STAKE = 1.0; // m of stake above the ground: the line runs at this height above the first stake's foot
class Stake extends Carried {
  constructor(game, colour) {
    super('stake', game); this.gripY = [0.45, STAKE];
    this.moving([[box(0.045, STAKE + 0.3, 0.045), 0xc9a36a, 0, (STAKE - 0.3) / 2, 0], [box(0.05, 0.14, 0.05), colour, 0, STAKE - 0.07, 0], [box(0.055, 0.02, 0.055), 0x1c1c1c, 0, STAKE - 0.16, 0]]);
    this.grip.set(0, 0.75, 0); this.holdQ = new THREE.Quaternion();
  }
  // carried upright; the trigger, while one is in the hand, switches the line between level and sloped
  grabMove(hand) { this.root.quaternion.identity(); this.root.position.copy(hand.pos).sub(this.grip); if (hand.triggerPressed && this.onTrigger) { this.onTrigger(); hand.pulse(0.6, 40); } }
  rest() { const p = this.root.position; p.y = this.ground(p.x, p.z); this.root.quaternion.identity(); }
}
class StringLine {
  constructor(game, a, b) {
    this.game = game; this.a = a; this.b = b; this.t = 0;
    this.slope = false; // level: the line runs at the first stake's height. sloped: from the top of one stake to the top of the other
    this.mat = new THREE.LineBasicMaterial({ color: 0xff4a8a });
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), this.mat); this.line.frustumCulled = false;
    this.drops = new THREE.InstancedMesh(box(0.012, 1, 0.012, 0, -0.5, 0), new THREE.MeshBasicMaterial(), 96); this.drops.frustumCulled = false; this.drops.count = 0;
    this.drops.setColorAt(0, new THREE.Color(1, 1, 1));
    game.scene.add(this.line, this.drops);
    this.report = { length: 0, high: 0, low: 0, onGrade: 0, slope: false, grade: 0 };
    a.onTrigger = b.onTrigger = () => this.setSlope(!this.slope);
  }
  setSlope(on) { this.slope = !!on; this.mat.color.setHex(this.slope ? 0xffa020 : 0xff4a8a); this.t = 0; } // pink: level. orange: sloped
  update(dt) {
    this.t -= dt; if (this.t > 0 && !this.a.held && !this.b.held) return; this.t = 0.2;
    const T = this.game.terrain, A = this.a.root.position, B = this.b.root.position, len = Math.hypot(B.x - A.x, B.z - A.z);
    const show = len > 0.6 && len < 46; this.line.visible = this.drops.visible = show; this.report.length = show ? len : 0; if (!show) return;
    // the grade the ground should be at, at each end: the foot of the first stake, and for a sloped line the foot of the second
    const footA = this.a.held ? T.heightAt(A.x, A.z) : A.y, footB = this.slope ? (this.b.held ? T.heightAt(B.x, B.z) : B.y) : footA;
    const top = STAKE - 0.07, pos = this.line.geometry.attributes.position;
    pos.setXYZ(0, A.x, footA + top, A.z); pos.setXYZ(1, B.x, footB + top, B.z); pos.needsUpdate = true;
    const n = Math.min(95, Math.floor(len / 0.5)), c = new THREE.Color(); let high = 0, low = 0, ok = 0;
    for (let i = 1; i <= n; i++) {
      const k = i / (n + 1), x = A.x + (B.x - A.x) * k, z = A.z + (B.z - A.z) * k, grade = footA + (footB - footA) * k, g = T.heightAt(x, z), d = g - grade, y = grade + top;
      _o.position.set(x, y, z); _o.scale.set(1, Math.max(0.02, y - g), 1); _o.rotation.set(0, 0, 0); _o.updateMatrix(); this.drops.setMatrixAt(i - 1, _o.matrix);
      if (Math.abs(d) < 0.04) { c.setRGB(0.2, 0.9, 0.3); ok++; } else if (d > 0) { c.setRGB(1, 0.25, 0.2); high++; } else { c.setRGB(0.25, 0.5, 1); low++; }
      this.drops.setColorAt(i - 1, c);
    }
    this.drops.count = n; this.drops.instanceMatrix.needsUpdate = true; this.drops.instanceColor.needsUpdate = true;
    Object.assign(this.report, { high, low, onGrade: ok, slope: this.slope, grade: (footB - footA) / len });
  }
}

// ------------------------------------------------------------------------------------------------------------- chain
const CHAIN = 7, LINKS = 34, STIFF = 160000, DAMP = 60000, MAX_PULL = 260000; // m, links drawn, N/m, N s/m, N
class Hook extends Carried {
  constructor(game) {
    super('hook', game); this.gripZ = [-0.05, 0.12];
    this.moving([[new THREE.TorusGeometry(0.06, 0.016, 6, 10, Math.PI * 1.5).rotateY(Math.PI / 2), 0x3a3e44, 0, 0, -0.07], [box(0.03, 0.03, 0.14), 0x3a3e44, 0, 0, 0.05], [box(0.05, 0.05, 0.04), 0xd0a020, 0, 0, 0.12]]);
    this.hitch = null; // {machine, body, local}
  }
  grabStart(hand) { super.grabStart(hand); this.hitch = null; }
  rest() {
    const p = this.root.position; let best = null, bd = 1.3;
    for (const m of this.game.machines) for (const h of hitches(m)) { const d = h.body.obj.localToWorld(_a.copy(h.local)).distanceTo(p); if (d < bd) { bd = d; best = { machine: m, body: h.body, local: h.local.clone() }; } }
    this.hitch = best;
    if (!best) p.y = this.ground(p.x, p.z) + 0.04; else if (this.hand === null && this.game.input) for (const s of ['left', 'right']) this.game.input.hands[s].pulse?.(0.7, 60);
    this.follow();
  }
  follow() { if (this.hitch) { this.hitch.body.obj.localToWorld(this.root.position.copy(this.hitch.local)); this.root.quaternion.copy(this.hitch.body.obj.getWorldQuaternion(_q)); } }
}
/** Where a chain can be hooked on: the middle of the front and of the back of a machine, at axle height. */
function hitches(m) {
  if (!m._hitches) {
    let front = null, rear = null;
    for (const b of m.bodyList) { const c = b.def?.colliders?.[0] || { pos: [0, 1, 0], size: b.def?.size || [2, 1, 4] }; const z0 = c.pos[2] - c.size[2] / 2, z1 = c.pos[2] + c.size[2] / 2;
      if (!front || z0 < front.z) front = { z: z0, body: b }; if (!rear || z1 > rear.z) rear = { z: z1, body: b }; }
    m._hitches = [{ body: front.body, local: new THREE.Vector3(0, 0.9, front.z - 0.15) }, { body: rear.body, local: new THREE.Vector3(0, 0.9, rear.z + 0.15) }];
  }
  return m._hitches;
}
class Chain {
  constructor(game, a, b) {
    this.game = game; this.a = a; this.b = b; this.dist = 0; this.pull = 0;
    this.mesh = new THREE.InstancedMesh(box(0.035, 0.035, CHAIN / LINKS * 0.92), new THREE.MeshLambertMaterial({ color: 0x4a4f56, flatShading: true }), LINKS); this.mesh.frustumCulled = false;
    game.scene.add(this.mesh);
  }
  /** Once per sim step, before the physics: a taut chain pulls on the two machines it joins. */
  step(dt) {
    const A = this.a, B = this.b; A.follow(); B.follow();
    for (const h of [A, B]) if (h.hitch) h.hitch.machine.tow = null;
    const d = A.root.position.distanceTo(B.root.position), rate = (d - this.dist) / dt; this.dist = d; this.pull = 0;
    if (!A.hitch || !B.hitch || A.hitch.machine === B.hitch.machine || d <= CHAIN) return;
    const F = this.pull = Math.min(MAX_PULL, Math.max(0, STIFF * (d - CHAIN) + DAMP * Math.max(0, rate)));
    _v.copy(B.root.position).sub(A.root.position).setY(0).normalize();
    const pa = A.root.position, pb = B.root.position;
    A.hitch.machine.tow = { fx: _v.x * F, fz: _v.z * F, px: pa.x, py: pa.y, pz: pa.z, body: A.hitch.body };
    B.hitch.machine.tow = { fx: -_v.x * F, fz: -_v.z * F, px: pb.x, py: pb.y, pz: pb.z, body: B.hitch.body };
  }
  /** Draw the links: hanging in a curve when slack (never through the ground), straight when taut. */
  draw() {
    const T = this.game.terrain, A = this.a.root.position, B = this.b.root.position, d = A.distanceTo(B), sag = d < CHAIN ? Math.sqrt(CHAIN * CHAIN - d * d) * 0.4 : 0;
    const at = (k, out) => { out.lerpVectors(A, B, k); out.y -= sag * 4 * k * (1 - k); const g = T.heightAt(out.x, out.z) + 0.03; if (out.y < g) out.y = g; return out; };
    for (let i = 0; i < LINKS; i++) {
      at(i / LINKS, _a); at((i + 1) / LINKS, _b);
      _o.position.copy(_a).add(_b).multiplyScalar(0.5); _o.quaternion.setFromUnitVectors(_v.set(0, 0, 1), _b.sub(_a).normalize()); _o.rotateZ(i % 2 ? Math.PI / 4 : -Math.PI / 4);
      _o.scale.set(1, 1, Math.max(0.3, d / CHAIN)); _o.updateMatrix(); this.mesh.setMatrixAt(i, _o.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------------------------------------- the set
export class HandTools {
  /** Lays the tools out on the ground round (x, z). */
  constructor(game, inter, x, z) {
    this.game = game;
    this.shovel = new Shovel(game); this.stakes = [new Stake(game, 0xe03a2a), new Stake(game, 0x2a6ae0)]; this.hooks = [new Hook(game), new Hook(game)];
    this.all = [this.shovel, ...this.stakes, ...this.hooks];
    for (const t of this.all) game.scene.add(t.root);
    const put = (t, dx, dz) => { t.root.position.set(x + dx, game.terrain.heightAt(x + dx, z + dz) + 1, z + dz); t.rest(); };
    put(this.shovel, 0, 0); put(this.stakes[0], 0.7, 0.2); put(this.stakes[1], 1.0, 0.2); put(this.hooks[0], 1.6, 0); put(this.hooks[1], 1.9, 0.3);
    this.line = new StringLine(game, this.stakes[0], this.stakes[1]); this.chain = new Chain(game, this.hooks[0], this.hooks[1]);
    inter.add(this.all);
    const before = game.extraVolume; game.extraVolume = () => (before ? before() : 0) + this.shovel.volume(); // soil on the shovel is still soil
  }
  /** Sim step, before the physics. */
  step(dt) { this.chain.step(dt); this.shovel.step(dt, this.game.clods); }

  // ---- co-op (session.js)
  /** Host → everyone: each tool's pose and holder, the line's mode, and what is on the shovel (to draw it). */
  netState(localId = 'host') {
    const p = [], h = [];
    for (const t of this.all) { const a = t.root.position, q = t.root.quaternion; p.push(a.x, a.y, a.z, q.x, q.y, q.z, q.w); h.push(t.holders.length ? localId : t.remote); }
    const sh = this.shovel; let top = 1; for (let k = 2; k < NMAT; k++) if (sh.load[k] > sh.load[top]) top = k;
    return { p, h, slope: this.line.slope ? 1 : 0, sv: +sh.volume().toFixed(4), sm: top };
  }
  /** Client: take the host's state for every tool this player is not carrying. */
  applyNet(s, me, dt) {
    const k = Math.min(1, dt * 15);
    this.all.forEach((t, i) => {
      const holder = s.h[i]; t.remote = holder && holder !== me ? holder : null;
      if (t.holders.length) return; // in this player's hand: theirs to move
      if (t.putDown) { if (holder === me) return; t.putDown = false; } // just let go here: the host has not heard yet, so its pose is the carried one
      const o = i * 7, P = t.root.position, Q = t.root.quaternion;
      _a.set(s.p[o], s.p[o + 1], s.p[o + 2]); _q.set(s.p[o + 3], s.p[o + 4], s.p[o + 5], s.p[o + 6]);
      if (P.distanceToSquared(_a) > 4) { P.copy(_a); Q.copy(_q); } else { P.lerp(_a, k); Q.slerp(_q, k); }
      if (t.hitch !== undefined) t.hitch = null; // the host hitches hooks; here they just go where it says
    });
    if (performance.now() > (this.line.mineUntil || 0) && !!s.slope !== this.line.slope) this.line.setSlope(!!s.slope); // not straight after switching it here
    const sh = this.shovel; sh.heap.visible = s.sv > 0.002;
    if (sh.heap.visible) { sh.heap.material.color.setRGB(...MATERIALS[s.sm].color); const sc = 0.5 + 0.7 * Math.cbrt(s.sv / SHOVEL_CAP); sh.heap.scale.set(sc, sc * 0.6, sc * 1.1); }
  }
  /** Host: a client carries tool i to pose p (7 numbers), or puts it down there (drop). Refused if someone else has it. */
  remoteMove(i, from, p, { drop = false, trigger = 0 } = {}) {
    const t = this.all[i]; if (!t || t.holders.length || (t.remote && t.remote !== from)) return false;
    if (!t.remote && !drop && t.hitch !== undefined) t.hitch = null; // a hook picked up comes off its machine
    t.root.position.set(p[0], p[1], p[2]); t.root.quaternion.set(p[3], p[4], p[5], p[6]);
    t.remoteTrigger = trigger;
    if (drop) { t.remote = null; t.remoteTrigger = 0; t.hand = undefined; t.rest(); } else t.remote = from; // (hand undefined: not this player's let-go, so no buzz here)
    return true;
  }
  /** Host: a client switched the line between level and sloped (the trigger with a stake in hand). */
  remoteSlope(from, on) { if (this.stakes.some((t) => t.remote === from)) this.line.setSlope(!!on); }
  /** Host: a player has gone; whatever they were carrying is put down where it is. */
  dropAll(from) { for (const t of this.all) if (t.remote === from) { t.remote = null; t.remoteTrigger = 0; t.hand = undefined; t.rest(); } }
  /** Every drawn frame. */
  update(dt) { this.line.update(dt); this.chain.draw(); }
}
