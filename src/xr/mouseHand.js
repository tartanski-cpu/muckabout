// The mouse as a hand, for players on a PC (roadmap 0b). It works the cab through the same controls and the same
// InteractionSystem as a VR hand, by driving the right hand as a fake (XRInput.setFake), so nothing in the cab has a
// second, PC-only path to keep in step.
//   point   the control nearest the cursor (within PICK px on screen and REACH m of the eye) lights up, and the cursor
//           turns to a hand. Nothing under the cursor: dragging looks round, as before.
//   drag    on a lever, joystick or key: press and move. The hand moves flat, across and away from you, as your arm
//           would on a lever: mouse up pushes forward, mouse right pushes right (the seat's forward, wherever you look). On the wheel it moves in the screen's
//           plane, so you turn it by dragging round the rim. A carried hand tool moves in the screen's plane too, and
//           the mouse wheel takes it nearer or further.
//   click   on a button or switch: presses it (held while the button is down).
// The hand is held in the camera's frame (setFake's `parent`), so it stays put on screen as the machine moves.
import * as THREE from 'three';

export const MOUSE = { pick: 34, reach: 2.6, metresPerPx: 0.0009, maxReach: 0.32 };
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Quaternion();

/** Where the mouse takes hold: the grab point, or the top of the rim for the wheel (its grab point is the hub). */
export function handlePoint(c, out) {
  if (c.kind === 'press') return c.pressPoint(out);
  if (c.radius > 0) return c.root.localToWorld(out.set(0, c.radius, 0));
  return c.grabPoint(out);
}

export class MouseHand {
  /** @param {{camera: THREE.Camera, renderer: any}} game  @param {import('./input.js').XRInput} input  @param {import('./interaction.js').InteractionSystem} inter */
  constructor(game, input, inter) {
    this.game = game; this.input = input; this.inter = inter; this.el = game.renderer.domElement;
    this.x = -1; this.y = -1;       // cursor in CSS px, or -1 when off the canvas
    this.target = null;             // control under the cursor
    this.held = null;               // control being worked
    this.pressed = null;            // press control held down
    this.local = new THREE.Vector3(); // hand position in the camera's frame
    this.start = new THREE.Vector3(); this.dx = 0; this.dy = 0; this.depth = 0;
    this.owned = false;             // true while this has the right hand faked (so it never clears a test's fake hand)
    this.enabled = true;
  }
  get active() { return this.enabled && !this.game.renderer.xr.isPresenting; }

  /** Pointer events from the page. Returns true if the mouse is on a control (so the caller does not look round). */
  move(e) { const r = this.el.getBoundingClientRect(); this.x = e.clientX - r.left; this.y = e.clientY - r.top; if (this.held) { this.dx = this.x - this.x0; this.dy = this.y - this.y0; } }
  leave() { if (!this.held && !this.pressed) this.x = this.y = -1; }
  down(e) {
    if (!this.active || e.button !== 0 || !this.target) return false;
    const c = this.target;
    if (c.kind === 'press') { this.pressed = c; c.press(this.input.hands.right); return true; }
    this.held = c; this.dx = this.dy = 0; this.x0 = this.x; this.y0 = this.y; this.depth = 0; this.start.copy(this.local);
    return true;
  }
  up() {
    if (this.pressed) { this.pressed.release(this.input.hands.right); this.pressed = null; }
    this.held = null;
  }
  wheel(e) { if (!this.held?.carried) return false; this.depth += Math.sign(e.deltaY) * 0.05; this.depth = Math.max(-0.4, Math.min(0.6, this.depth)); return true; }

  /** Each frame, before XRInput.update(). */
  update() {
    const cam = this.game.camera, fake = this.input.fake;
    if (!this.active) { this._clear(); return; }
    if (fake.right && !this.owned) return; // a test is driving this hand
    cam.updateMatrixWorld();
    if (this.held) {
      if (!this.held.enabled) { this.held = null; } else {
        // what the drag means, in the camera's frame
        const k = MOUSE.metresPerPx, flat = !this.held.carried && !(this.held.radius > 0); // the wheel has a radius; tools are carried
        cam.getWorldQuaternion(_q);
        _r.set(1, 0, 0).applyQuaternion(_q);
        if (flat) { // forward and right are the seat's (the rig's), not the camera's: a lever off to the side still goes forward when the mouse goes up
          this.game.rig.getWorldQuaternion(_s); _f.set(0, 0, -1).applyQuaternion(_s); _f.y = 0; _f.normalize(); _r.set(1, 0, 0).applyQuaternion(_s); _r.y = 0; _r.normalize();
          _d.copy(_r).multiplyScalar(this.dx * k).addScaledVector(_f, -this.dy * k);
        }
        else { _u.set(0, 1, 0).applyQuaternion(_q); _d.copy(_r).multiplyScalar(this.dx * k).addScaledVector(_u, -this.dy * k); }
        _d.applyQuaternion(_q.invert()); // world → camera frame (a direction: rotation only)
        if (!this.held.carried && _d.length() > MOUSE.maxReach) _d.setLength(MOUSE.maxReach); // stay within the control's break-away
        this.local.copy(this.start).add(_d); this.local.z -= this.depth;
        this._fake(true);
        this.el.style.cursor = 'grabbing';
        return;
      }
    }
    if (this.pressed) { this._fake(false); return; }
    // what is under the cursor?
    const t = this.x < 0 ? null : this._pick(cam);
    if (t !== this.target) { if (this.target?.kind === 'press') this.target.setHover(false); this.target = t; if (t?.kind === 'press') t.setHover(true); }
    this.el.style.cursor = t ? 'pointer' : '';
    if (!t || t.kind === 'press') { this._clear(); return; } // press controls are worked directly: a fake hand beside a button would also be in reach of the levers round it
    handlePoint(t, _p); cam.worldToLocal(this.local.copy(_p));
    this._fake(false);
  }
  _pick(cam) {
    const w = this.el.clientWidth, h = this.el.clientHeight; let best = null, bd = MOUSE.pick;
    cam.getWorldPosition(_u);
    for (const c of this.inter.controls) {
      if (!c.enabled || !c.root.visible || (c.held && !c.multi && !c.holders.includes(this.input.hands.right))) continue;
      handlePoint(c, _p);
      if (_p.distanceTo(_u) > MOUSE.reach) continue;
      _d.copy(_p).project(cam); if (_d.z > 1 || _d.z < -1) continue;
      const d = Math.hypot((_d.x + 1) / 2 * w - this.x, (1 - _d.y) / 2 * h - this.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  _fake(grip) {
    this.input.setFake('right', { pos: this.local, parent: this.game.camera, quat: this.game.camera.getWorldQuaternion(new THREE.Quaternion()), grip });
    this.owned = true;
  }
  _clear() { if (this.owned) { this.input.setFake('right', null); this.owned = false; } if (!this.target) this.el.style.cursor = ''; }
}
