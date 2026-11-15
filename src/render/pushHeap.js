// The heap being shoved along ahead of a blade or a full bucket, drawn as loose granules that flow round it.
//
// The soil itself is already in the ground: the terrain windrows what a tool cannot take just ahead of its edge, and
// that heap is what the machine pushes against and what the volume audit counts. This layer only dresses it, as a
// small simulation of its own. Granules are heavy and stay in the pile: each lies on the heap's surface (at its own
// depth, so they stack) and is dragged toward the speed of the soil where it lies. That flow is fastest at the blade
// face, dies away ahead of it, sooner toward the blade's ends, and is squeezed sideways round the ends: so the
// field is pushed out in a bow, wells up against the blade, and trails off both ends as the windrows. Granules
// are fed in at the foot of the blade as fast as it cuts. When the pushing stops they come to rest and sink into
// the surface over a couple of seconds: what is left is the ordinary ground, the same heap. One draw call.
// Rendering only: not part of the deterministic sim, so Math.random is fine here.
import * as THREE from 'three';
import { MATERIALS } from '../terrain/materials.js';
import { lumpy } from './chips.js';

const PER_TOOL = 2600, TOOLS = 3, SETTLE = 2.4, G = 9.8, R = 0.05;
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
      // per granule: x y z, vx, age (s), vz, spin, size, seconds lying where there is no heap, on (0 = waiting to be fed in)
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
      let cx = s.px === null ? ex : s.px + (ex - s.px) * part, cz = s.px === null ? ez : s.pz + (ez - s.pz) * part;
      let ax = _r.x - _l.x, az = _r.z - _l.z; const w = Math.hypot(ax, az) || 1; ax /= w; az /= w;
      let fx = -az, fz = ax; if (fx * (_l.x - _b.x) + fz * (_l.z - _b.z) < 0) { fx = -fx; fz = -fz; }
      const bvx = s.px === null ? 0 : (ex - s.px) / frame, bvz = s.px === null ? 0 : (ez - s.pz) / frame, bs = Math.max(0, bvx * fx + bvz * fz); // blade speed ahead
      if (draw) { s.px = ex; s.pz = ez; }
      const pushing = s.kick > -0.05 && (bs > 0.06 || s.fresh); // soil is being cut and the edge is travelling
      s.act = Math.max(0, Math.min(1, s.act + (pushing ? dt / 0.35 : -dt / SETTLE)));
      if (s.act <= 0) { this.states.delete(tool); continue; }
      // the terrain heaps the soil a little ahead of the cutting edge: that, not the edge, is the face the granules lie against
      const off = (tool.def.ahead ?? 0.35) * 0.75, fl = T.heightAt(cx - fx * 0.3, cz - fz * 0.3); cx += fx * off; cz += fz * off;
      const hw = w / 2, floor = fl, top = Math.max(floor + 1.3, T.heightAt(cx + fx * 0.4, cz + fz * 0.4) + 0.7), // the blade stands above the heap against it
         count = Math.min(PER_TOOL, Math.round(PER_TOOL * (hw + 0.3) / 2));
      const P = s.p, grow = Math.sqrt(s.act), sink = (1 - s.act) * 0.14, fric = Math.exp(-8 * dt);
      // Granules are heavy: they never leave the pile. Each is dragged toward the speed of the soil where it lies:
      //   at the blade face the soil moves with the blade; the pull dies away with distance ahead, sooner toward the
      //   blade's ends than at its middle, so the heap is pushed out in a bow; and soil near the face is squeezed
      //   sideways, more the nearer the ends, so it flows round them and is left behind as the windrows.
      // They are fed in only at the foot of the blade, as fast as it is cutting, so the field grows from the blade.
      let feed = s.kick > -0.3 ? Math.ceil(count * dt * (0.5 + bs) * 3) : 0; // while soil is being cut, moving or not
      // heap: soil that has been moved (the terrain marks ground it has disturbed) and stands above the floor the edge is cutting.
      // Untouched ground beside a trench is higher than the trench's floor too, but it is not heap.
      const info = T.info, heap = (hx, hz) => T.heightAt(hx, hz) - floor > 0.07 && (!info || info[T.cellAt(hx, hz) * 4 + 1] > 60);
      // how far ahead of the face the heap reaches, down its middle
      let reach = 0.6; for (let a = 0.3; a < 3.4; a += 0.3) if (heap(cx + fx * a, cz + fz * a)) reach = a + 0.3;
      const drag = 1 - Math.exp(-7 * dt);
      for (let i = 0; i < count; i++) {
        const k = i * 10;
        let x = P[k], y = P[k + 1], z = P[k + 2], vx = P[k + 3], vz = P[k + 5];
        let d = (x - cx) * fx + (z - cz) * fz, u = (x - cx) * ax + (z - cz) * az;
        const behind = d < -0.3 && Math.abs(u) < hw;
        const old = P[k + 4] > 3 + 3 * ((i * 17) % 13) / 12; // each is turned under after a few seconds and comes up somewhere else: bare patches fill
        const lost = !P[k + 9] || behind || old || d > 5 || d < -4 || Math.abs(u) > hw + 3 || P[k + 8] > 0.4;
        if (lost) {
          if (feed <= 0) { if (!P[k + 9]) continue; }
          else {
            // a third come up at the foot of the blade; the rest anywhere there is heap to lie on, so the field is the
            // heap's own shape and covers all of it
            feed--;
            if (rnd() < 0.33) { u = (rnd() * 2 - 1) * hw; d = 0.06 + rnd() * 0.3; }
            else {
              u = (rnd() * 2 - 1) * (hw + 1.2); d = -0.6 + rnd() * (reach + 1.0);
              if (d < 0.06 && Math.abs(u) < hw) d = 0.06 + rnd() * 0.3;
              if (!heap(cx + ax * u + fx * d, cz + az * u + fz * d)) { feed++; continue; }
            }
            P[k + 4] = 0;
            x = cx + ax * u + fx * d; z = cz + az * u + fz * d; vx = bvx; vz = bvz;
            const q = rnd();
            P[k + 6] = rnd() * 6.3; P[k + 7] = 0.55 + 1.35 * q * q * q; P[k + 8] = 0; P[k + 9] = 1;
          }
        }
        // the soil's flow here
        const e = Math.min(1.4, Math.abs(u) / hw), inside = e < 1;
        let carry = 0, squeeze = 0;
        if (bs > 0.02 && d > -0.2) {
          // on the heap the surface rolls: it wells up at the face and runs forward over the top and down the front faster
          // than the blade is travelling, comes to rest at the toe, and is overrun and taken up again
          const len = reach * (inside ? 1 - 0.45 * e * e : 0.3), t = Math.max(0, d) / len;
          // (each at its own pace, so they spread over the whole face; one that reaches the toe is rolled under and goes round again)
          carry = (t < 1 ? 1.1 + 0.4 * ((i * 11) % 9) / 8 : Math.exp(-(t - 1) * len / 0.2)) * (inside ? 1 : Math.max(0, 1 - (e - 1) * 4));
          if (pushing && inside && t >= 1) P[k + 8] = 1;
          squeeze = inside ? Math.sign(u) * (0.15 + 0.75 * e * e) * Math.exp(-d / 0.7) : 0;
        }
        const tx = (fx * carry + ax * squeeze * 0.6) * bs, tz = (fz * carry + az * squeeze * 0.6) * bs;
        vx += (tx - vx) * drag; vz += (tz - vz) * drag;
        // the blade itself: nothing passes through it
        if (inside && d < 0.06 && d > -0.3) { x += fx * (0.06 - d); z += fz * (0.06 - d); }
        // steeper than its angle of repose, loose soil runs downhill
        const h0 = T.heightAt(x, z), gx = (T.heightAt(x + 0.2, z) - h0) / 0.2, gz = (T.heightAt(x, z + 0.2) - h0) / 0.2, gm = Math.hypot(gx, gz);
        if (gm > 0.6) { const run = (gm - 0.6) / gm * G * dt * 0.5; vx -= gx * run; vz -= gz * run; }
        let sp = Math.hypot(vx, vz); if (sp < 0.03) { vx = vz = 0; sp = 0; }
        x += vx * dt; z += vz * dt;
        const h = T.heightAt(x, z);
        // each rides at its own depth in the pile, and the pile wells up against the moving blade
        const lie = R * P[k + 7] + ((i * 7) % 10) * 0.016, well = inside && d < 0.7 ? (1 - Math.max(0, d) / 0.7) * 0.22 * Math.min(1, bs * 1.5) * (0.4 + 0.6 * ((i * 13) % 7) / 6) : 0;
        y += (h + lie + well - y) * Math.min(1, dt * 12);
        if (y < h + lie) y = h + lie;
        // lying still where there is no heap: soon fed back in at the blade
        P[k + 8] = heap(x, z) ? 0 : P[k + 8] + dt;
        if (pushing) P[k + 4] += dt;
        P[k + 6] += sp * dt * 6;
        P[k] = x; P[k + 1] = y; P[k + 2] = z; P[k + 3] = vx; P[k + 5] = vz;
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
