// Scripted drivers. They work a machine through the same inputs a player's controls feed (machine.override),
// so the stress scene and the scripted tests exercise the real vehicle, hydraulics and terrain code.
import * as THREE from 'three';
import { clamp } from '../util/rng.js';

const _p = new THREE.Vector3(), _c = new THREE.Vector3();
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Steer and drive toward (x, z). Returns distance left. Works for wheels (steer/accel/shuttle) and tracks (left/right). */
export function driveTo(m, x, z, { speed = 2.5, reverse = false } = {}) {
  const o = m.override, p = m.position, dx = x - p.x, dz = z - p.z, dist = Math.hypot(dx, dz);
  let err = wrap(Math.atan2(-dx, -dz) + (reverse ? Math.PI : 0) - m.headingOf(reverse));
  const sp = Math.abs(m.speed), want = Math.min(speed, 0.6 + dist * 0.9);
  if (m.def.drive.type === 'tracks') {
    const v = clamp(want / m.def.drive.maxSpeed[0], 0, 1) * (reverse ? -1 : 1) * (Math.abs(err) > 0.6 ? 0.2 : 1), turn = clamp(err * 2, -0.5, 0.5);
    o.left = clamp(v - turn, -1, 1); o.right = clamp(v + turn, -1, 1);
  } else {
    o.steer = clamp(-err * 2.5, -1, 1) * (reverse ? -1 : 1);
    o.shuttle = reverse ? -1 : 1; o.accel = sp < want ? 0.6 : 0; o.brake = sp > want + 0.8 ? 0.5 : 0;
  }
  return dist;
}
export function halt(m) { const o = m.override; o.accel = 0; o.brake = 1; o.left = 0; o.right = 0; o.steer = o.steer || 0; }
/** Drive a hydraulic function toward a position. Returns true when there. */
export function setFn(m, name, target, tol = 0.03) {
  const f = m.fn[name], d = target - f.pos, inp = f.input ?? name;
  m.override[inp] = Math.abs(d) < tol ? 0 : Math.sign(d) * (f.sign ?? 1);
  return Math.abs(d) < tol;
}

/** Runs a list of steps; each step is fn(m, t) → true when finished. Loops if asked. */
export class Script {
  constructor(m, steps, { loop = false, timeout = 40 } = {}) { this.m = m; this.steps = steps; this.i = 0; this.t = 0; this.loop = loop; this.timeout = timeout; this.cycles = 0; this.done = false; m.override ??= {}; }
  step(dt) {
    if (this.done) return;
    this.t += dt;
    if (this.steps[this.i](this.m, this.t) || this.t > this.timeout) {
      if (this.log) this.log.push(`step ${this.i} ${this.t > this.timeout ? 'TIMEOUT' : 'ok'} t=${this.t.toFixed(1)} pos ${this.m.position.x.toFixed(1)},${this.m.position.z.toFixed(1)} hdg ${this.m.heading.toFixed(2)} load ${this.m.payload().toFixed(2)}`);
      this.i++; this.t = 0;
      if (this.i >= this.steps.length) { this.cycles++; if (this.loop) this.i = 0; else { this.done = true; halt(this.m); } }
    }
  }
}
export const startUp = (m, t) => { const o = m.override; o.key = 1; o.park = 0; o.throttle = 1; return m.engine.running && t > 0.3; };

/** Loader: dig at `dig` approaching from `from`, then tip into the container `target` (a machine container or a rig). */
export function loaderCycle({ from, dig, stage, target, fill = 1.7 }) {
  const tgt = () => target.obj.getWorldPosition(_c);
  return [
    startUp,
    (m) => { driveTo(m, from[0], from[1], { speed: 3 }); setFn(m, 'boom', -0.3); setFn(m, 'bucket', 0.3); return Math.hypot(m.position.x - from[0], m.position.z - from[1]) < 1.2; },
    (m) => { halt(m); const a = setFn(m, 'boom', -0.68, 0.02), b = setFn(m, 'bucket', -0.02, 0.03); return a && b; },
    (m, t) => { driveTo(m, dig[0], dig[1], { speed: 1.6 }); m.override.brake = 0; m.override.boom = 0; m.override.bucket = 0; return m.payload() > fill || t > 9; },
    (m, t) => { halt(m); setFn(m, 'bucket', 0.6); setFn(m, 'boom', -0.2); return t > 1.2; },
    (m) => { setFn(m, 'boom', 0.2); return driveTo(m, stage[0], stage[1], { speed: 2.5, reverse: true }) < 1.5; },
    (m) => { // nose up to the target with the bucket high
      const c = tgt(); setFn(m, 'boom', 0.92); m.containers.bucket.obj.getWorldPosition(_p);
      const h = m.heading, along = (c.x - _p.x) * -Math.sin(h) + (c.z - _p.z) * -Math.cos(h); // how far ahead of the bucket the target centre is
      const d = Math.hypot(_p.x - c.x, _p.z - c.z); if (m.fn.boom.pos < 0.7 && d < 4.5) { halt(m); return false; }
      // follow the line square to the target's side (its local x axis) rather than aiming straight at the centre,
      // so the machine is already lined up when it arrives
      const e = target.obj.matrixWorld.elements; let ax = e[0], az = e[2]; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      let s = (m.position.x - c.x) * ax + (m.position.z - c.z) * az; if (s < 0) { s = -s; ax = -ax; az = -az; }
      const look = Math.max(0, s - 4.5);
      driveTo(m, c.x + ax * look, c.z + az * look, { speed: along > 3 ? 2 : 0.7 });
      target.obj.worldToLocal(_p); // bucket centre in the target's frame: stop once it is over the floor
      // the pour lands about a metre ahead of the bucket centre, so the centre only has to reach the near wall
      const over = Math.abs(_p.x) < target.field.hx + 0.1 && Math.abs(_p.z) < Math.max(0.4, target.field.hz - 1.0) && along < 1.4;
      // nosed up against the truck and stopped: that is as close as it gets, so tip if the bucket is over the bed at all
      m._stuck = Math.abs(m.speed) < 0.15 && d < 3.5 ? (m._stuck || 0) + 1 / 60 : 0;
      const nosed = m._stuck > 1.2 && Math.abs(_p.x) < target.field.hx + 0.4 && Math.abs(_p.z) < target.field.hz - 0.2;
      if (over || nosed) m._stuck = 0;
      return over || nosed;
    },
    (m, t) => { halt(m); setFn(m, 'bucket', -1.1); return m.payload() < 0.05 || t > 5; },
    (m, t) => { setFn(m, 'bucket', 0.3); driveTo(m, stage[0], stage[1], { speed: 2, reverse: true }); return t > 2.5; },
    (m) => { halt(m); return setFn(m, 'boom', -0.3, 0.05); },
  ];
}

/** Dumper: wait until loaded, haul to `tip` (backing in the last few metres), tip, come back to `park`. */
export function dumperCycle({ park, via, tip, load = 5 }) {
  return [
    startUp,
    (m) => { halt(m); m.override.tip = 0; m.override.park = 1; return m.payload('bed') >= load; }, // park brake on while being loaded
    (m) => { m.override.park = 0; return driveTo(m, tip[0], tip[1], { speed: 5 }) < 2.0; },
    (m, t) => { halt(m); m.override.tip = 1; return m.payload('bed') < 0.1 || t > 9; },
    (m, t) => { m.override.tip = -1; m.override.brake = 0; driveTo(m, m.position.x - Math.sin(m.heading) * 6, m.position.z - Math.cos(m.heading) * 6, { speed: 1.5 }); return t > 2; },
    (m) => { setFn(m, 'tip', 0); return !via || driveTo(m, via[0], via[1], { speed: 5 }) < 2.5; }, // line up for the parking spot
    (m) => { setFn(m, 'tip', 0); return driveTo(m, park[0], park[1], { speed: 3 }) < 1.2; },
    (m, t) => { halt(m); return setFn(m, 'tip', 0) && t > 1; },
  ];
}

/** Dozer: shove back and forth between two points with the blade just below grade going out. */
export function dozerCycle({ a, b, depth = -0.2 }) {
  return [
    startUp,
    (m) => { setFn(m, 'lift', depth, 0.02); return driveTo(m, b[0], b[1], { speed: 1.8 }) < 1.5; },
    (m) => { setFn(m, 'lift', 0.3); return driveTo(m, a[0], a[1], { speed: 2.6, reverse: true }) < 1.5; },
  ];
}

/** Backhoe: legs down, then dig a trench behind the machine in thin bites, swinging each bucketful out to the side. */
export function backhoeCycle({ swing = 1.1, bite = 0.35 } = {}) {
  const teeth = (m) => { m.nodes.hbucket.localToWorld(_p.set(0, 0, 0.75)); return _p.y - m.terrain.heightAt(_p.x, _p.z); };
  const pose = (m, target) => { let ok = true; for (const k in target) ok = setFn(m, k, target[k]) && ok; return ok; };
  const still = (m) => { for (const k of ['slew', 'hoeBoom', 'dipper', 'hoeBucket']) m.override[k] = 0; };
  return [
    startUp,
    (m) => { m.override.park = 1; m.override.swivel = 1; const a = setFn(m, 'stabL', 1.15, 0.02), b = setFn(m, 'stabR', 1.15, 0.02); return a && b; },
    (m) => pose(m, { hoeBoom: 0.5, dipper: 1.0, hoeBucket: 0.6, slew: 0 }),                       // reach out, teeth down
    (m, t) => { still(m); m.override.hoeBoom = -1; if (teeth(m) < -bite || m.fn.hoeBoom.pos <= m.fn.hoeBoom.min + 0.01 || t > 6) { m.override.hoeBoom = 0; return true; } return false; },
    (m) => pose(m, { dipper: 2.2, hoeBucket: 1.2 }),                                               // crowd in, curling
    (m) => pose(m, { hoeBoom: 0.9, hoeBucket: 2.3 }),                                              // lift, cupped
    (m) => pose(m, { slew: swing }),
    (m) => pose(m, { hoeBucket: 0.0, dipper: 1.6 }),                                               // tip
    (m) => pose(m, { slew: 0, hoeBucket: 0.6 }),
  ];
}
