// The player rig: on foot (smooth move + snap turn, following the ground) or seated in a machine.
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
    this.rig.position.copy(this.feet); this.rig.rotation.set(0, this.yaw, 0);
  }
  place(x, z, yaw = 0) { this.feet.set(x, this.game.terrain.heightAt(x, z), z); this.yaw = yaw; this.rig.position.copy(this.feet); this.rig.rotation.set(0, yaw, 0); }

  update(dt, hands) {
    if (this.machine) {
      if (this.horizonLock > 0) { // cancel a share of the seat's roll and pitch
        this.machine.seat.getWorldQuaternion(_q); _e.setFromQuaternion(_q, 'YXZ');
        const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, _e.y, 0));
        this.comfort.quaternion.copy(_q).invert().multiply(flat); this.comfort.quaternion.slerp(new THREE.Quaternion(), 1 - this.horizonLock);
      } else this.comfort.quaternion.identity();
      return;
    }
    // on foot
    const l = hands.left, r = hands.right;
    if (l.tracked && !l.busy) {
      const [sx, sy] = stickOf(l), mag = Math.hypot(sx, sy);
      if (mag > 0) {
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
    const g = t.heightAt(this.feet.x, this.feet.z); this.feet.y += (g - this.feet.y) * Math.min(1, dt / 0.12);
    this.rig.position.copy(this.feet); this.rig.rotation.set(0, this.yaw, 0);
    if (!this.game.renderer.xr.isPresenting) this.camera.position.set(0, this.eyeDesktop, 0);
  }
}
