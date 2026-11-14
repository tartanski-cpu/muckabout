// The player rig: on foot (grab the world, smooth move + snap turn, following the ground) or seated in a machine.
// Grab the world is SWVR's default way to get about (src/player/locomotion.ts): squeeze a grip on thin air and pull,
// and the world moves with your hand in all three directions, through anything (nothing on foot collides). Two
// hands: pull and twist to turn. Having pulled yourself somewhere you are "free": the height stays until you walk
// with the stick, which settles you back onto the ground.
// Rig layout and numbers follow SWVR (src/player/locomotion.ts): head-relative smooth move at 1.4 m/s with a
// run ramp, 30° snap turn about the head (fires at 0.7, re-arms at 0.35), and a seat that puts the head on
// the eye point whatever the player's real height or room position.
import * as THREE from 'three';
import { stickOf } from './input.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class Player {
  constructor(game, input) {
    this.game = game; this.input = input; this.rig = game.rig; this.camera = game.camera;
    this.machine = null; this.snapArmed = true; this.yaw = 0; this.feet = new THREE.Vector3();
    this.horizonLock = 0;          // 0 = cab rigid to the machine, 1 = roll/pitch fully damped out
    this.comfort = new THREE.Group(); // sits between the seat and the rig; carries the horizon-lock counter-rotation
    this.walkSpeed = 1.4; this.runMult = 3.0; this.eyeDesktop = 1.65;
    this.anchors = { left: null, right: null }; this.twoHandAngle = 0; this.free = false; this.seatSnap = true;
  }
  get seated() { return !!this.machine; }

  /** Head pose relative to the rig, yaw only. */
  _head(out) { _e.setFromQuaternion(this.camera.quaternion, 'YXZ'); out.yaw = _e.y; out.pos = this.camera.position; return out; }

  sit(machine) {
    if (this.machine) this.machine.driver = null;
    this.machine = machine; machine.driver = 'local';
    machine.seat.add(this.comfort); this.comfort.add(this.rig);
    this.recentre();
  }
  /** Put the head exactly on the seat's eye point, looking forward. */
  recentre() {
    if (!this.machine) return;
    const xr = this.game.renderer.xr.isPresenting, h = this._head({});
    if (!xr) { this.rig.position.set(0, 0, 0); this.rig.rotation.set(0, 0, 0); return; }
    this.rig.rotation.set(0, -h.yaw, 0);
    _v.copy(h.pos).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -h.yaw);
    this.rig.position.copy(_v).negate();
  }
  stand(pos) {
    const m = this.machine; if (!m) return;
    m.driver = null; this.machine = null;
    this.game.scene.add(this.rig); this.comfort.removeFromParent();
    m.bodyList[0].obj.localToWorld(_v.set(-2.6, 0, -0.5)); if (pos) _v.copy(pos);
    this.feet.set(_v.x, this.game.terrain.heightAt(_v.x, _v.z), _v.z); this.yaw = m.heading;
    this.rig.position.copy(this.feet); this.rig.rotation.set(0, this.yaw, 0); this.free = false; this.anchors.left = this.anchors.right = null;
  }
  place(x, z, yaw = 0) { this.free = false; this.feet.set(x, this.game.terrain.heightAt(x, z), z); this.yaw = yaw; this.rig.position.copy(this.feet); this.rig.rotation.set(0, yaw, 0); }

  /** Turn the rig by a about the head: moves `pos` (the rig's position in its parent's frame) so the head stays put. The caller adds a to the yaw. */
  _turnAboutHead(a, pos) {
    _v.copy(this.camera.position).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.rig.rotation.y); const c = Math.cos(a), s = Math.sin(a);
    pos.x += _v.x - (_v.x * c + _v.z * s); pos.z += _v.z - (-_v.x * s + _v.z * c);
  }
  /** Grab the world: a grip squeezed on nothing holds a point of the world; moving the hand moves you the other way. */
  _grabWorld(hands) {
    const A = this.anchors, cur = {};
    for (const k of ['left', 'right']) { const h = hands[k]; cur[k] = h.tracked && h.gripDown && !h.holding ? h.pos : null; }
    if (!!cur.left !== !!A.left || !!cur.right !== !!A.right) { // the set of gripping hands changed: take new holds
      for (const k of ['left', 'right']) A[k] = cur[k] ? cur[k].clone() : null;
      if (cur.left && cur.right) this.twoHandAngle = Math.atan2(cur.right.x - cur.left.x, cur.right.z - cur.left.z);
      return;
    }
    if (cur.left && cur.right) { // two hands: turn about their midpoint so the line between them keeps its heading, then keep the midpoint where it was held
      const turn = this.twoHandAngle - Math.atan2(cur.right.x - cur.left.x, cur.right.z - cur.left.z), mx = (cur.left.x + cur.right.x) / 2, mz = (cur.left.z + cur.right.z) / 2;
      const c = Math.cos(turn), s = Math.sin(turn), dx = this.feet.x - mx, dz = this.feet.z - mz;
      this.feet.x = mx + dx * c + dz * s; this.feet.z = mz - dx * s + dz * c; this.yaw += turn;
      this.feet.x += (A.left.x + A.right.x) / 2 - mx; this.feet.y += (A.left.y + A.right.y) / 2 - (cur.left.y + cur.right.y) / 2; this.feet.z += (A.left.z + A.right.z) / 2 - mz;
      this.free = true;
    } else for (const k of ['left', 'right']) if (cur[k]) { this.feet.x += A[k].x - cur[k].x; this.feet.y += A[k].y - cur[k].y; this.feet.z += A[k].z - cur[k].z; this.free = true; }
  }

  update(dt, hands) {
    if (this.machine) {
      if (this.horizonLock > 0) { // cancel a share of the seat's roll and pitch
        this.machine.seat.getWorldQuaternion(_q); _e.setFromQuaternion(_q, 'YXZ');
        const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, _e.y, 0));
        this.comfort.quaternion.copy(_q).invert().multiply(flat); this.comfort.quaternion.slerp(new THREE.Quaternion(), 1 - this.horizonLock);
      } else this.comfort.quaternion.identity();
      // seated: the left stick pushed sideways snap-turns you in the seat (B recentres)
      const ls = hands.left, x = ls.tracked && !this.noSeatTurn ? ls.stick[0] : 0;
      if (this.seatSnap && Math.abs(x) > 0.7) { this.seatSnap = false; this._turnAboutHead(-Math.sign(x) * Math.PI / 6, this.rig.position); this.rig.rotation.y += -Math.sign(x) * Math.PI / 6; }
      else if (Math.abs(x) < 0.35) this.seatSnap = true;
      return;
    }
    this._grabWorld(hands);
    // on foot
    const l = hands.left, r = hands.right;
    if (l.tracked && !l.busy) {
      const [sx, sy] = stickOf(l), mag = Math.hypot(sx, sy);
      if (mag > 0) {
        this.free = false; // walking puts you back on the ground
        this.camera.getWorldDirection(_f); _f.y = 0; _f.normalize();
        const speed = this.walkSpeed * (mag > 0.8 ? 1 + (this.runMult - 1) * (mag - 0.8) / 0.2 : 1) * dt;
        this.feet.x += (_f.x * sy - _f.z * sx) * speed; this.feet.z += (_f.z * sy + _f.x * sx) * speed;
      }
    }
    if (r.tracked && !r.busy) {
      const x = r.stick[0];
      if (this.snapArmed && Math.abs(x) > 0.7) { // snap turn about the head, not the rig origin
        const a = -Math.sign(x) * Math.PI / 6; this.snapArmed = false;
        this.camera.getWorldPosition(_v); _v.sub(this.rig.position); const c = Math.cos(a), s = Math.sin(a);
        const nx = _v.x * c + _v.z * s, nz = -_v.x * s + _v.z * c;
        this.feet.x += _v.x - nx; this.feet.z += _v.z - nz; this.yaw += a;
      } else if (Math.abs(x) < 0.35) this.snapArmed = true;
    }
    const t = this.game.terrain, half = t.nx * t.cell / 2 - 2;
    this.feet.x = Math.min(t.ox + 2 * half + 0, Math.max(t.ox + 2, this.feet.x)); this.feet.z = Math.min(t.oz + 2 * half, Math.max(t.oz + 2, this.feet.z));
    const g = t.heightAt(this.feet.x, this.feet.z); if (this.free) this.feet.y = Math.max(g, this.feet.y); else this.feet.y += (g - this.feet.y) * Math.min(1, dt / 0.12);
    this.rig.position.copy(this.feet); this.rig.rotation.set(0, this.yaw, 0);
    if (!this.game.renderer.xr.isPresenting) this.camera.position.set(0, this.eyeDesktop, 0);
  }
}
