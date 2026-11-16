// The mouse as a hand, for players on a PC (roadmap 0b). It works the cab through the same controls and the same
// InteractionSystem as a VR hand, by driving the right hand as a fake (XRInput.setFake), so nothing in the cab has a
// second, PC-only path to keep in step.
//   point   the control nearest the cursor (within PICK px on screen and REACH m of the eye) lights up, and the cursor
//           turns to a hand. Nothing under the cursor: dragging looks round, as before.
//   drag    on a lever, joystick or key: press and move. The hand moves flat, across and away from you, as your arm
//           would on a lever: mouse up pushes forward, mouse right pushes right (the seat's forward, wherever you look). On the wheel it moves in the screen's
//           plane, so you turn it by dragging round the rim.
//   click   on a button or switch: presses it (held while the button is down).
//   carry   click a hand tool (shovel, stake, hook) and it stays in your hand, with the mouse free again: drag to look,
//           walk with the keys. Look at the ground within reach and the tool goes there: the shovel's blade just into
//           the soil (walk forward to fill it; the mouse wheel digs deeper or shallower), a stake's foot or a hook
//           where it will be put down. Look further off and it is carried in front of you. The right button is the
//           trigger (throws the soil off the shovel, switches the line with a stake in hand). A click without
//           dragging puts it down.
// The hand is held in the camera's frame (setFake's `parent`), so it stays put on screen as the machine moves.
import * as THREE from 'three';

export const MOUSE = { pick: 34, reach: 2.6, metresPerPx: 0.0009, maxReach: 0.32, carry: [0.18, -0.42, -0.35], click: 5, aimReach: 2.4 };
/** The point of each hand tool that goes where you look, in the tool's frame, and how far into the ground. */
const AIM = { shovel: { at: [0, -0.02, -1.2], dig: 0.08 }, stake: { at: [0, 0, 0], dig: 0 }, hook: { at: [0, 0, 0], dig: -0.05 } };
const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Quaternion(), _g = new THREE.Vector3();

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
    this.carry = null;              // hand tool in the hand (stays there until a click puts it down)
    this.trigger = 0; this.clickAt = null; this.reach = 0;
    this.owned = false;             // true while this has the right hand faked (so it never clears a test's fake hand)
    this.enabled = true;
  }
  get active() { return this.enabled && !this.game.renderer.xr.isPresenting; }

  /** Pointer events from the page. Returns true if the mouse is on a control (so the caller does not look round). */
  move(e) {
    const r = this.el.getBoundingClientRect(); this.x = e.clientX - r.left; this.y = e.clientY - r.top;
    if (this.held) { this.dx = this.x - this.x0; this.dy = this.y - this.y0; }
    if (this.clickAt && Math.hypot(e.clientX - this.clickAt[0], e.clientY - this.clickAt[1]) > MOUSE.click) this.clickAt = null; // a drag: looking round, not putting down
  }
  leave() { if (!this.held && !this.pressed) this.x = this.y = -1; }
  down(e) {
    if (!this.active) return false;
    if (this.carry) {
      if (e.button === 2) { this.trigger = 1; return true; }
      if (e.button === 0) this.clickAt = [e.clientX, e.clientY];
      return false; // let the drag look round
    }
    if (e.button !== 0 || !this.target) return false;
    const c = this.target;
    if (c.kind === 'press') { this.pressed = c; c.press(this.input.hands.right); return true; }
    if (c.carried) { this.carry = c; this.dropping = false; this.reach = 0; this.start.copy(this.local); return true; }
    this.held = c; this.dx = this.dy = 0; this.x0 = this.x; this.y0 = this.y; this.depth = 0; this.start.copy(this.local);
    return true;
  }
  up(e) {
    if (this.pressed) { this.pressed.release(this.input.hands.right); this.pressed = null; }
    this.held = null;
    if (this.carry && e?.button === 2) this.trigger = 0;
    if (this.carry && e?.button === 0 && this.clickAt) this.dropping = true; // a click: put it down
    this.clickAt = null;
  }
  wheel(e) { if (!this.carry) return false; this.reach = Math.max(-0.3, Math.min(0.25, this.reach + Math.sign(e.deltaY) * 0.03)); return true; } // wheel towards you: deeper

  /** Each frame, before XRInput.update(). */
  update() {
    const cam = this.game.camera, fake = this.input.fake;
    if (!this.active) { this._clear(); return; }
    if (fake.right && !this.owned) return; // a test is driving this hand
    cam.updateMatrixWorld();
    if (this.carry) {
      const c = this.carry;
      if (this.dropping || (this.taken && !c.holders.includes(this.input.hands.right))) { // put down here, or taken away (co-op: someone else had it)
        this.carry = null; this.taken = false; this.dropping = false; this.trigger = 0; this._fake(false); this.el.style.cursor = ''; return;
      }
      if (c.holders.includes(this.input.hands.right)) this.taken = true;
      // first frame: the hand on the handle, to take hold; then it goes where you look (or is carried ahead)
      if (this.taken) { this._aim(cam, c, _p); this.local.lerp(_p, 0.35); }
      this._fake(true, this.trigger, this._yaw(cam));
      this.el.style.cursor = 'crosshair';
      return;
    }
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
  /** Where the hand goes for a carried tool, in the camera's frame: so that its aim point lands where you look. */
  _aim(cam, c, out) {
    const a = AIM[c.name], T = this.game.terrain;
    cam.getWorldPosition(_u); cam.getWorldDirection(_d);
    let hit = null;
    if (a && _d.y < -0.05) for (let s = 0.3; s <= MOUSE.aimReach + 1.5; s += 0.04) { // march the view ray down to the ground
      const x = _u.x + _d.x * s, y = _u.y + _d.y * s, z = _u.z + _d.z * s;
      if (y <= T.heightAt(x, z)) { if (Math.hypot(x - _u.x, z - _u.z) <= MOUSE.aimReach) hit = _r.set(x, T.heightAt(x, z) - a.dig - this.reach, z); break; }
    }
    if (!hit) { out.fromArray(MOUSE.carry); return out; }
    // the tool's frame: the hand's (level, facing where you look) times the way it is held
    _s.copy(this._yaw(cam)).multiply(c.holdQ);
    _f.fromArray(a.at).applyQuaternion(_s);                 // aim point, from the tool's origin
    _g.copy(c.grip).applyQuaternion(_s);                    // the hand, from the tool's origin
    out.copy(hit).sub(_f).add(_g);                          // hand = where the aim point goes, moved back along the tool
    return cam.worldToLocal(out);
  }
  /** The camera's heading only: a carried tool is held level whichever way you look. */
  _yaw(cam) { cam.getWorldDirection(_f); return (this._yq ??= new THREE.Quaternion()).setFromAxisAngle(_u.set(0, 1, 0), Math.atan2(-_f.x, -_f.z)); }
  _fake(grip, trigger = 0, quat = null) {
    this.input.setFake('right', { pos: this.local, parent: this.game.camera, quat: quat ? quat.clone() : this.game.camera.getWorldQuaternion(new THREE.Quaternion()), grip, trigger });
    this.owned = true;
  }
  _clear() { if (this.owned) { this.input.setFake('right', null); this.owned = false; } if (!this.target) this.el.style.cursor = ''; }
}
