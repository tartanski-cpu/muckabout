// The heap being shoved along ahead of a blade or a full bucket, drawn as loose granules that flow.
//
// The soil itself is already in the ground: the terrain windrows what a tool cannot take just ahead of its edge, and
// that heap is what the machine pushes against and what the volume audit counts. This layer only dresses it, but it
// is a small simulation of its own, so the heap looks like loose material and not a sheet:
//   - every granule is a particle with a position and a velocity, under gravity
//   - the blade is a moving wall: granules it catches are carried forward and boil up its face
//   - they land on the heap (the terrain's surface) and run down its slope, losing speed to friction
//   - so the material turns over: up at the blade, forward over the top, down the front, caught again; at the
//     blade's ends it spills out sideways
//   - a granule left behind, or come to rest off the heap, is fed back in at the blade
// When the pushing stops nothing is fed in, the granules run out and come to rest, and they sink into the surface
// over a couple of seconds: what is left is the ordinary ground, the same heap. One draw call for all tools.
// Rendering only: not part of the deterministic sim, so Math.random is fine here.
import * as THREE from 'three';
import { MATERIALS } from '../terrain/materials.js';
import { lumpy } from './chips.js';

const PER_TOOL = 2600, TOOLS = 3, DEPTH = 2.6, SETTLE = 2.4, G = 9.8, R = 0.05;
const _o = new THREE.Object3D(), _l = new THREE.Vector3(), _r = new THREE.Vector3(), _b = new THREE.Vector3();
const rnd = Math.random;

export class PushHeap {
  constructor(terrain) {
    this.terrain = terrain;
    const geo = lumpy(new THREE.BoxGeometry(0.12, 0.1, 0.11), 0.26, 17);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), PER_TOOL * TOOLS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.tints = MATERIALS.map((m) => new THREE.Color(...m.color));
    this.states = new Map(); // tool → state
  }

  /** A tool pushed soil this step. */
  kick(tool) {
    let s = this.states.get(tool);
    if (!s) {
      if (this.states.size >= TOOLS) return;
      // per granule: x y z, vx vy vz, spin, size, rest (seconds lying still), on (0 = waiting to be fed in)
      s = { act: 0, kick: 0, px: null, pz: 0, p: new Float32Array(PER_TOOL * 10), fresh: 3 }; this.states.set(tool, s);
    }
    s.kick = 0.3;
  }

  update(dt) {
    if (!(dt > 1e-4)) return;
    // several small steps a frame when frames are long, so the granules keep up with the blade at any frame rate
    const frame = Math.min(dt, 0.25), steps = Math.min(8, Math.ceil(frame / 0.02));
    for (let q = 0; q < steps; q++) this._step(frame / steps, (q + 1) / steps, frame);
  }

  /** One small step. `part` is how far through the frame it ends (1 = the last, which also draws); the blade is moved along its path for the frame. */
  _step(dt, part, frame) {
    const draw = part >= 1;
    const T = this.terrain, m = this.mesh, col = m.instanceColor.array; let n = 0;
    for (const [tool, s] of this.states) {
      s.kick -= dt;
      // the cutting edge in the world: its two lip corners, which way is ahead, and how fast it is moving
      const C = tool.def.corners, mw = tool.node.matrixWorld;
      _l.fromArray(C[2]).applyMatrix4(mw); _r.fromArray(C[3]).applyMatrix4(mw); _b.fromArray(C[0]).applyMatrix4(mw);
      const ex = (_l.x + _r.x) / 2, ez = (_l.z + _r.z) / 2;                                 // where the edge is at the end of the frame
      const cx = s.px === null ? ex : s.px + (ex - s.px) * part, cz = s.px === null ? ez : s.pz + (ez - s.pz) * part;
      let ax = _r.x - _l.x, az = _r.z - _l.z; const w = Math.hypot(ax, az) || 1; ax /= w; az /= w;
      let fx = -az, fz = ax; if (fx * (_l.x - _b.x) + fz * (_l.z - _b.z) < 0) { fx = -fx; fz = -fz; }
      const bvx = s.px === null ? 0 : (ex - s.px) / frame, bvz = s.px === null ? 0 : (ez - s.pz) / frame, bs = Math.max(0, bvx * fx + bvz * fz); // blade speed ahead
      if (draw) { s.px = ex; s.pz = ez; }
      const pushing = s.kick > -0.05 && (bs > 0.06 || s.fresh); // soil is being cut and the edge is travelling
      s.act = Math.max(0, Math.min(1, s.act + (pushing ? dt / 0.35 : -dt / SETTLE)));
      if (s.act <= 0) { this.states.delete(tool); continue; }
      const hw = w / 2, floor = T.heightAt(cx - fx * 0.3, cz - fz * 0.3), top = Math.max(floor + 1.3, T.heightAt(cx + fx * 0.4, cz + fz * 0.4) + 0.7), // the blade stands above the heap against it
         count = Math.min(PER_TOOL, Math.round(PER_TOOL * (hw + 0.3) / 2));
      const P = s.p, grow = Math.sqrt(s.act), sink = (1 - s.act) * 0.14, fric = Math.exp(-8 * dt);
      let feed = pushing ? Math.ceil(count * dt * 9) : 0; // how many resting or lost granules may be fed back in this frame
      for (let i = 0; i < count; i++) {
        const k = i * 10;
        let x = P[k], y = P[k + 1], z = P[k + 2], vx = P[k + 3], vy = P[k + 4], vz = P[k + 5];
        let d = (x - cx) * fx + (z - cz) * fz, u = (x - cx) * ax + (z - cz) * az;
        const lost = !P[k + 9] || d > DEPTH + 0.6 || d < -0.35 || Math.abs(u) > hw + 1.5 || P[k + 8] > 0.6;
        if (lost) {
          if (feed <= 0) { if (!P[k + 9]) continue; }
          else { // fed in at the foot of the blade, already moving with it
            feed--; const face = rnd() < 0.72; u = (rnd() * 2 - 1) * (hw + (face ? 0.9 : 0.1)); d = face ? 0.3 + rnd() * (DEPTH - 0.5) : 0.08 + rnd() * 0.3; // most out on the heap's face (it spills past the blade's ends), the rest at the foot of the blade
            x = cx + ax * u + fx * d; z = cz + az * u + fz * d; const hh = T.heightAt(x, z);
            if (face && hh - floor < 0.08) { feed++; continue; }                                        // no heap out there
            y = hh + R + rnd() * 0.2; vx = bvx * (face ? 0.5 : 1); vz = bvz * (face ? 0.5 : 1); vy = 0; P[k + 6] = rnd() * 6.3; { const q = rnd(); P[k + 7] = 0.55 + 1.35 * q * q * q; } P[k + 8] = 0; P[k + 9] = 1; // sizes: mostly small, a few big lumps
          }
        }
        vy -= G * dt;
        // the blade: a wall that carries what it catches forward and boils it up its face
        if (d < 0.07 && d > -1.3 && Math.abs(u) < hw + 0.05 && y < top) {
          x += fx * (0.07 - d); z += fz * (0.07 - d);
          if (bs > 0.05) {
            const along = vx * fx + vz * fz, need = bs * (1.05 + 0.4 * rnd()) - along;
            if (need > 0) { vx += fx * need; vz += fz * need; }
            vy = Math.max(vy, 0.2 + bs * (0.5 + 1.0 * rnd()));                                   // up the face
            const e = Math.abs(u) / hw, side = (e > 0.75 ? Math.sign(u) * (e - 0.75) * 3 : 0) + (rnd() - 0.5) * 0.5; vx += ax * side * bs * 0.5; vz += az * side * bs * 0.5; // and out toward the ends
          }
        }
        x += vx * dt; y += vy * dt; z += vz * dt;
        // the heap: land on it, run down its slope, lose speed to friction
        const h = T.heightAt(x, z);
        const lie = R * P[k + 7] + ((i * 7) % 10) * 0.014;                                 // stacked: each rides at its own depth in the pile
        if (y < h + lie) {
          const gx = (T.heightAt(x + 0.2, z) - h) / 0.2, gz = (T.heightAt(x, z + 0.2) - h) / 0.2;
          y = h + lie; vy = vy < -1.2 ? -vy * 0.18 : 0;
          // loose soil lies still on anything gentler than its angle of repose; steeper, it runs
          const gm = Math.hypot(gx, gz), run = gm > 0.55 ? (gm - 0.55) / gm * G * dt : 0;
          vx = (vx - gx * run) * fric; vz = (vz - gz * run) * fric;
          let sp = Math.hypot(vx, vz); if (sp < 0.06 && !run) { vx = vz = 0; sp = 0; }
          P[k + 8] = sp < 0.15 && h - floor < 0.06 ? P[k + 8] + dt : 0; // lying still off the heap: soon fed back in
          P[k + 6] += sp * dt * 7;                                                         // it rolls
        } else P[k + 6] += dt * 5;                                                         // tumbling in the air
        P[k] = x; P[k + 1] = y; P[k + 2] = z; P[k + 3] = vx; P[k + 4] = vy; P[k + 5] = vz;
        if (!draw) continue;
        const sc = grow * P[k + 7], sp6 = P[k + 6];
        _o.position.set(x, y - sink, z); _o.rotation.set(sp6, i * 1.7, sp6 * 0.6 + i);
        _o.scale.set(sc * 1.1, sc * 0.95, sc * 1.15); _o.updateMatrix(); m.setMatrixAt(n, _o.matrix);
        const t = this.tints[T.materialAt(x, z) || 1], q = 0.78 + 0.34 * ((i * 37) % 11) / 10;
        col[n * 3] = t.r * q; col[n * 3 + 1] = t.g * q; col[n * 3 + 2] = t.b * q; n++;
      }
    }
    if (!draw) return;
    for (const s of this.states.values()) if (s.fresh) s.fresh--; // a new heap gets a few frames to find out how fast its edge is going
    m.count = n;
    if (n) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  }
}
