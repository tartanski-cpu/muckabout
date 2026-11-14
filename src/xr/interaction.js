// Connects hands to controls. Ported from SWVR's InteractionSystem.updateXR:
//   1. a hand holding a grab control keeps feeding it while the grip is held;
//   2. otherwise find the nearest control in reach (grip within grabRadius of a grab control, or within
//      touchRadius of a press control);
//   3. grip on a grab control takes it; poking (or trigger on) a press control presses it;
//   4. with nothing in reach, a short pointer ray (the blue laser) picks buttons and switches; trigger presses them.
// A hand that is holding or hovering a grab control is "busy": locomotion must ignore its grip and stick.
// Difference from SWVR: a held control is let go if the real hand strays past `breakAway` (the Muck About
// spec asks for a tolerance; it is generous so normal seated use never trips it).
import * as THREE from 'three';

export const REACH = { grabRadius: 0.12, touchRadius: 0.06, pokeRadius: 0.035, breakAway: 0.45, rayLength: 1.6, rayRadius: 0.045 };
const _p = new THREE.Vector3(), _c = new THREE.Vector3();

export class InteractionSystem {
  constructor(scene) {
    this.controls = []; this.state = {};
    for (const side of ['left', 'right']) {
      // the little blue pointer, as in SWVR: shown only while it is on a button or switch out of arm's reach
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x9fe6ff, transparent: true, opacity: 0.85 }));
      line.visible = false; line.frustumCulled = false; if (scene) scene.add(line);
      this.state[side] = { held: null, hover: null, pressing: null, byRay: false, line };
    }
  }
  add(list) { for (const c of list) this.controls.push(c); }
  remove(list) { this.controls = this.controls.filter((c) => !list.includes(c)); }

  update(hands, dt) {
    for (const side of ['left', 'right']) {
      const h = hands[side], s = this.state[side];
      h.busy = false; h.holding = s.held; h.pointing = false; s.line.visible = false;
      if (!h.tracked) { this._drop(h, s); continue; }
      if (s.held) {
        const c = s.held;
        if (!h.gripDown || !c.enabled || c.grabPoint(_p).distanceTo(h.pos) > REACH.breakAway) { c.grabEnd(h); s.held = null; h.holding = null; if (h.gripDown) h.pulse(0.5, 50); }
        else { c.grabMove(h); h.busy = true; continue; }
      }
      if (s.pressing && !h.triggerDown && (s.byRay || s.pressing.distanceTo(h.tip) > REACH.pokeRadius * 1.6)) { s.pressing.release(h); s.pressing = null; }
      // what is the hand on?
      let best = null, score = 1, byRay = false;
      for (const c of this.controls) {
        if (!c.enabled || !c.root.visible) continue;
        if (c.kind === 'grab') { if (c.held && !c.multi) continue; const d = (c.distanceTo(h.pos) - (c.reachBonus || 0)) / REACH.grabRadius; if (d < score) { best = c; score = d; } }
        else { const d = c.distanceTo(h.tip) / REACH.touchRadius; if (d < score) { best = c; score = d; } }
      }
      if (!best && h.hasRay) { // nothing in reach: the pointer ray picks buttons and switches (never levers or the wheel)
        let bt = REACH.rayLength;
        for (const c of this.controls) {
          if (c.kind !== 'press' || !c.enabled || !c.root.visible) continue;
          c.pressPoint(_c); const t = _c.sub(h.tip).dot(h.dir); if (t < 0.05 || t > bt) continue;
          if (_c.addScaledVector(h.dir, -t).lengthSq() < REACH.rayRadius * REACH.rayRadius) { best = c; bt = t; byRay = true; }
        }
        if (byRay) { const pos = s.line.geometry.attributes.position; pos.setXYZ(0, h.tip.x, h.tip.y, h.tip.z); pos.setXYZ(1, h.tip.x + h.dir.x * bt, h.tip.y + h.dir.y * bt, h.tip.z + h.dir.z * bt); pos.needsUpdate = true; s.line.visible = true; h.pointing = true; }
      }
      if (best !== s.hover) { if (s.hover && !this._hoveredElsewhere(s.hover, side)) s.hover.setHover(false); if (best) { best.setHover(true); h.pulse(0.12, 10); } s.hover = best; }
      if (!best) continue;
      if (best.kind === 'grab') {
        h.busy = true;
        if (h.gripPressed) { best.grabStart(h); s.held = best; h.holding = best; h.pulse(0.4, 25); }
      } else if (!s.pressing && (h.triggerPressed || (!byRay && best.distanceTo(h.tip) < REACH.pokeRadius))) { best.press(h); s.pressing = best; s.byRay = byRay; }
    }
    for (const c of this.controls) c.tick(dt);
  }
  _hoveredElsewhere(c, side) { return this.state[side === 'left' ? 'right' : 'left'].hover === c; }
  _drop(h, s) {
    if (s.held) { s.held.grabEnd(h); s.held = null; } if (s.pressing) { s.pressing.release(h); s.pressing = null; }
    if (s.hover) { s.hover.setHover(false); s.hover = null; } h.holding = null; s.line.visible = false;
  }
  releaseAll(hands) { for (const side of ['left', 'right']) this._drop(hands[side], this.state[side]); }
}
