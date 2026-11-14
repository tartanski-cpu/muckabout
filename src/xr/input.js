// Controller input, one snapshot per frame per hand.
// Ported from SWVR (src/player/xrInput.ts, xrControllers.ts): xr-standard button map, grip space for
// grabbing, target-ray space for pointing, haptic pulse helper that is a no-op where unsupported.
// Added here: "fake" hands, so tests and the desktop debug path can drive the same interaction code.
import * as THREE from 'three';

const _q = new THREE.Quaternion();
export const BTN = { trigger: 0, grip: 1, stick: 3, primary: 4, secondary: 5 }; // primary = A / X, secondary = B / Y

function makeHand(name) {
  return { name, tracked: false, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), tip: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), hasRay: false, pointing: false,
    gripDown: false, gripPressed: false, gripReleased: false, triggerDown: false, triggerPressed: false, trigger: 0,
    stick: [0, 0], stickPressed: false, primaryPressed: false, secondaryPressed: false, primaryDown: false, secondaryDown: false,
    busy: false, holding: null, _prev: { grip: false, trig: false, stick: false, a: false, b: false }, gamepad: null,
    pulse(intensity, ms) { const a = this.gamepad?.hapticActuators?.[0]; if (a?.pulse && intensity > 0.02) a.pulse(Math.min(1, intensity), ms); } };
}

export class XRInput {
  constructor(renderer, rig) {
    this.renderer = renderer;
    this.hands = { left: makeHand('left'), right: makeHand('right') };
    this.grips = []; this.fake = { left: null, right: null };
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i), ray = renderer.xr.getController(i);
      grip.userData.side = null;
      grip.addEventListener('connected', (e) => { grip.userData.side = e.data.handedness; grip.userData.src = e.data; });
      grip.addEventListener('disconnected', () => { grip.userData.side = null; grip.userData.src = null; });
      rig.add(grip, ray); this.grips.push({ grip, ray });
    }
  }
  /** Drive a hand without a headset: {pos, quat?, grip, trigger?, stick?, parent?}, or null to clear. pos is in world space, or in `parent`'s frame if given. */
  setFake(side, state) { this.fake[side] = state; }

  update() {
    const presenting = this.renderer.xr.isPresenting;
    for (const side of ['left', 'right']) {
      const h = this.hands[side], f = this.fake[side];
      let grip = false, trig = 0, sx = 0, sy = 0, sc = false, a = false, b = false;
      h.tracked = false; h.gamepad = null;
      if (f) {
        h.tracked = true; h.pos.copy(f.pos); if (f.parent) f.parent.localToWorld(h.pos); if (f.quat) h.quat.copy(f.quat); h.tip.copy(h.pos);
        h.hasRay = !!f.dir; if (f.dir) h.dir.copy(f.dir).normalize(); // fake hands only point when given a direction
        grip = !!f.grip; trig = f.trigger || 0; if (f.stick) [sx, sy] = f.stick; a = !!f.primary; b = !!f.secondary;
      } else if (presenting) {
        const g = this.grips.find((x) => x.grip.userData.side === side);
        const gp = g?.grip.userData.src?.gamepad;
        if (g && gp) {
          h.tracked = true; h.gamepad = gp;
          g.grip.getWorldPosition(h.pos); g.grip.getWorldQuaternion(h.quat); g.ray.getWorldPosition(h.tip);
          h.dir.set(0, 0, -1).applyQuaternion(g.ray.getWorldQuaternion(_q)); h.hasRay = true; // the pointer ray: target-ray space looks down -z
          const bt = gp.buttons;
          grip = !!bt[BTN.grip]?.pressed; trig = bt[BTN.trigger]?.value || 0; sx = gp.axes[2] || 0; sy = gp.axes[3] || 0;
          sc = !!bt[BTN.stick]?.pressed; a = !!bt[BTN.primary]?.pressed; b = !!bt[BTN.secondary]?.pressed;
        }
      }
      const p = h._prev, trigDown = trig > (p.trig ? 0.4 : 0.6); // hysteresis, as in SWVR
      h.gripPressed = grip && !p.grip; h.gripReleased = !grip && p.grip; h.gripDown = grip;
      h.triggerPressed = trigDown && !p.trig; h.triggerDown = trigDown; h.trigger = trig;
      h.stick[0] = sx; h.stick[1] = sy; h.stickPressed = sc && !p.stick;
      h.primaryPressed = a && !p.a; h.secondaryPressed = b && !p.b; h.primaryDown = a; h.secondaryDown = b;
      p.grip = grip; p.trig = trigDown; p.stick = sc; p.a = a; p.b = b;
    }
  }
}
/** Radial dead zone, rescaled to 0..1. Returns [x, forward] (WebXR stick y is negative forward). */
export function stickOf(h, dz = 0.15) {
  const [x, y] = h.stick, r = Math.hypot(x, y);
  if (r <= dz) return [0, 0];
  const k = Math.min(1, (r - dz) / (1 - dz)) / r;
  return [x * k, -y * k];
}
