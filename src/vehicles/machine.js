// A machine, built entirely from a definition in machines/*.json:
//   bodies    Rapier rigid bodies (two for articulated machines, joined by a motorised revolute joint)
//   wheels    raycast wheels / track contact points: suspension spring-damper + tyre friction against our terrain
//   functions hydraulic functions with rate limits and end stops; engine rpm sets the available flow
//   nodes     kinematic parts hanging off a body (boom, bucket, blade, bed, legs) posed by functions
//   tools     cutting edges and containers riding on nodes
// The same Object3D tree is used for simulation transforms and for drawing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CutTool, ContainerRig } from '../terrain/tool.js';
import { ContainerField } from '../terrain/containers.js';
import { MATERIALS, NMAT } from '../terrain/materials.js';
import { HydraulicFeel } from '../audio/hydraulicFeel.js';
import { clamp } from '../util/rng.js';

const G = 9.81;
const V = () => new THREE.Vector3();
const _t = V(), _q = new THREE.Quaternion(), _up = V(), _f = V(), _s = V(), _n = V(), _c = V(), _v = V(), _p = V(), _a = V(), _m4 = new THREE.Matrix4(), _m5 = new THREE.Matrix4();
const _na = [0, 1, 0];
const AX = { x: V().set(1, 0, 0), y: V().set(0, 1, 0), z: V().set(0, 0, 1) };

// Draw calls are the main cost on a Quest (each is drawn once per eye), so a machine's boxes are merged into one
// vertex-coloured mesh per moving part instead of one mesh per box.
const COLORS = { yellow: 0xf0b21a, dark: 0x3a3a3c, tyre: 0x1f1f20, hub: 0xd9a015, steel: 0x6d6e70, seat: 0x2b2b2b, red: 0xc9381e, orange: 0xd9541e, green: 0x4f7d3a, white: 0xe8e3d8, blue: 0x2f5f9e, track: 0x26262a };
const PAINT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const GLASS = new THREE.MeshBasicMaterial({ color: 0x9ccbe8, transparent: true, opacity: 0.12, depthWrite: false });
const _mm = new THREE.Matrix4(), _me = new THREE.Euler(), _mc = new THREE.Color();
/** Geometry placed at pos/rot and painted one colour, ready for merging. */
function part(geo, color, pos, rot) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  _mm.makeRotationFromEuler(_me.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0)).setPosition(pos[0], pos[1], pos[2]); g.applyMatrix4(_mm);
  _mc.setHex(COLORS[color] ?? 0xff00ff);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _mc.r; col[i * 3 + 1] = _mc.g; col[i * 3 + 2] = _mc.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
  return g;
}
let wheelGeoCache = new Map();
function wheelMesh(r, w) {
  const key = r + '/' + w; let geo = wheelGeoCache.get(key);
  if (!geo) {
    const parts = [part(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2), 'tyre', [0, 0, 0]), part(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10).rotateZ(Math.PI / 2), 'hub', [0, 0, 0])];
    for (let n = 0; n < 7; n++) { const a = (n / 7) * Math.PI * 2; parts.push(part(new THREE.BoxGeometry(w + 0.04, 0.09, 0.16), 'tyre', [0, Math.cos(a) * r, Math.sin(a) * r], [-a, 0, 0])); } // lugs so you can see it turning
    geo = mergeGeometries(parts); wheelGeoCache.set(key, geo);
  }
  return new THREE.Mesh(geo, PAINT);
}

export class Machine {
  /**
   * @param {object} def machine definition (machines/*.json)
   * @param {import('./physics.js').Physics} phys
   * @param {import('../terrain/client.js').TerrainClient} terrain
   * @param {{x:number, z:number, yaw?:number, id:string}} at
   */
  constructor(def, phys, terrain, at) {
    this.def = def; this.phys = phys; this.terrain = terrain; this.id = at.id; this.name = def.name;
    const R = phys.R, world = phys.world;
    this.root = new THREE.Group(); this.root.name = this.id;
    const yaw = at.yaw || 0, y0 = terrain.heightAt(at.x, at.z) + 0.15;
    const q0 = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    this.spawn = { x: at.x, y: y0, z: at.z, q: q0 };

    // ---- bodies
    this.bodies = {}; this.bodyList = [];
    this.mass = 0;
    for (const b of def.bodies) {
      const [sx, sy, sz] = b.size, m = b.mass;
      const desc = R.RigidBodyDesc.dynamic().setTranslation(at.x, y0, at.z).setRotation(q0).setCanSleep(false).setLinearDamping(0.02).setAngularDamping(0.3)
        .setAdditionalMassProperties(m, { x: b.com[0], y: b.com[1], z: b.com[2] }, { x: m * (sy * sy + sz * sz) / 12, y: m * (sx * sx + sz * sz) / 12, z: m * (sx * sx + sy * sy) / 12 }, { x: 0, y: 0, z: 0, w: 1 });
      const rb = world.createRigidBody(desc), obj = new THREE.Group(); obj.name = b.name;
      this.root.add(obj);
      const body = { name: b.name, rb, obj, mass: m, def: b, wheels: 0 };
      for (const c of b.colliders || []) world.createCollider(R.ColliderDesc.cuboid(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2).setTranslation(c.pos[0], c.pos[1], c.pos[2]).setDensity(0).setFriction(0.4), rb);
      this.bodies[b.name] = body; this.bodyList.push(body); this.mass += m;
    }
    // ---- articulation joints
    this.joints = [];
    for (const j of def.joints || []) {
      const a = this.bodies[j.a], b = this.bodies[j.b], an = { x: j.anchor[0], y: j.anchor[1], z: j.anchor[2] };
      const joint = world.createImpulseJoint(R.JointData.revolute(an, an, { x: j.axis[0], y: j.axis[1], z: j.axis[2] }), a.rb, b.rb, true);
      joint.setContactsEnabled(false); joint.setLimits(j.min, j.max);
      this.joints.push({ def: j, joint, target: 0 });
    }
    // ---- hydraulic functions
    this.fn = {}; this.fnList = [];
    for (const f of def.functions || []) { const s = { ...f, pos: f.init ?? 0, cmd: 0 }; this.fn[f.name] = s; this.fnList.push(s); }
    this.feel = new HydraulicFeel();
    this.feelFns = this.fnList.filter((f) => !f.quiet).map((f) => ({ name: f.name, cmd: 0, pos: f.pos, min: f.min, max: f.max, src: f }));

    // ---- nodes (kinematic parts)
    this.nodes = {};
    for (const b of this.bodyList) this.nodes[b.name] = b.obj;
    this.nodeList = [];
    for (const n of def.nodes || []) {
      const obj = new THREE.Group(); obj.name = n.name; obj.position.fromArray(n.pos);
      if (n.rot) obj.rotation.fromArray(n.rot);
      this.nodes[n.parent].add(obj); this.nodes[n.name] = obj;
      let body = n.parent; while (!this.bodies[body]) body = def.nodes.find((x) => x.name === body).parent;
      const base = obj.quaternion.clone();
      this.nodeList.push({ def: n, obj, base, body: this.bodies[body] });
    }
    // node colliders (bucket, blade...) ride their body and are re-posed every step
    this.nodeColliders = [];
    for (const c of def.nodeColliders || []) {
      const nd = this.nodeList.find((n) => n.def.name === c.node);
      const col = world.createCollider(R.ColliderDesc.cuboid(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2).setDensity(0).setFriction(0.4), nd.body.rb);
      this.nodeColliders.push({ col, node: nd, pos: new THREE.Vector3().fromArray(c.pos) });
    }
    // ---- wheels / track contacts
    this.wheels = [];
    const sus = { ext: 0.06, damp: 0.6, travel: 0.12, ...(def.suspension || {}) };
    for (const w of def.wheels || []) this.bodies[w.body].wheels++;
    for (const w of def.wheels || []) {
      const body = this.bodies[w.body], share = w.load ?? body.mass / body.wheels;
      const k = share * G / sus.ext, c = 2 * sus.damp * Math.sqrt(k * share);
      const mesh = w.hidden ? new THREE.Group() : wheelMesh(w.r, w.w ?? 0.5); mesh.position.fromArray(w.pos); body.obj.add(mesh);
      this.wheels.push({ def: w, body, pos: new THREE.Vector3().fromArray(w.pos), r: w.r, share, k, c, mesh, comp: 0, N: 0, grounded: false, vf: 0, slip: 0, spin: 0, side: w.track || null, steer: 0, gx: 0, gz: 0 });
    }
    this.sus = sus;
    // ---- skid contacts (belly, bucket corners, stabiliser feet): stiff supports with friction
    this.contacts = [];
    for (const c of def.contacts || []) {
      const nd = this.nodeList.find((n) => n.def.name === c.node), body = nd ? nd.body : this.bodies[c.node];
      this.contacts.push({ def: c, node: this.nodes[c.node], body, pos: new THREE.Vector3().fromArray(c.pos), local: V(), k: c.k ?? this.mass * G / 0.08, mu: c.mu ?? 0.5, N: 0 });
    }
    // ---- visuals: one merged mesh per parent node (plus one for its glass)
    const byParent = new Map();
    for (const v of def.visuals || []) {
      const glass = v.mat === 'glass', key = v.parent + (glass ? '|glass' : '');
      const geo = v.box ? new THREE.BoxGeometry(...v.box) : new THREE.CylinderGeometry(v.cyl[0], v.cyl[1], v.cyl[2], v.cyl[3] ?? 8);
      if (!byParent.has(key)) byParent.set(key, { parent: v.parent, glass, parts: [] });
      byParent.get(key).parts.push(part(geo, v.mat || 'yellow', v.pos, v.rot));
    }
    for (const g of byParent.values()) this.nodes[g.parent].add(new THREE.Mesh(mergeGeometries(g.parts), g.glass ? GLASS : PAINT));
    // ---- tools and containers
    this.containers = {}; this.rigs = [];
    for (const c of def.containers || []) {
      const obj = new THREE.Group(); obj.position.fromArray(c.pos); if (c.rot) obj.rotation.fromArray(c.rot);
      this.nodes[c.node].add(obj);
      const field = new ContainerField({ name: `${this.id}.${c.name}`, nx: c.nx, nz: c.nz, cs: c.cs, capacity: c.capacity, walls: c.walls });
      const rig = new ContainerRig(field, `${this.id}.${c.name}`); rig.object = obj; rig.passes = c.passes ?? 2;
      let cb = c.node; while (!this.bodies[cb]) cb = def.nodes.find((x) => x.name === cb).parent;
      this.containers[c.name] = { field, rig, obj, def: c, body: this.bodies[cb], local: V() }; this.rigs.push(rig);
    }
    this.tools = [];
    for (const t of def.tools || []) {
      const nd = this.nodeList.find((n) => n.def.name === t.node);
      this.tools.push({ def: t, cut: new CutTool(`${this.id}.${t.name}`, t.corners, t.ahead ?? 0.35), node: this.nodes[t.node], body: nd.body, container: t.container ? this.containers[t.container] : null, rate: 0, prev: V(), vel: V(), has: false });
    }
    // ---- seat
    const seat = def.seat || { node: this.bodyList[0].name, eye: [0, 2.5, 0] };
    this.seat = new THREE.Group(); this.seat.position.fromArray(seat.eye); this.nodes[seat.node].add(this.seat);
    this.seatDef = seat;

    // ---- state
    this.inp = { steer: 0, accel: 0, brake: 0, shuttle: 0, throttle: 0, park: 1, key: 0, left: 0, right: 0, decel: 0, horn: 0 };
    for (const f of this.fnList) this.inp[f.input ?? f.name] = 0;
    this.engine = { running: false, crank: 0, rpm: 0, load: 0 };
    this.digRate = 0; this.spillRate = 0; this.bump = 0; this.speed = 0; this.tick = 0; this.events = [];
    this.driver = null; // who is in the seat (multiplayer / AI)
    this.sync(); this.poseNodes(); this.root.updateMatrixWorld(true);
  }

  /** Put the machine back where it started (or somewhere else), upright and at rest. */
  reset(x = this.spawn.x, z = this.spawn.z, yaw = null) {
    const y = this.terrain.heightAt(x, z) + 0.15, q = yaw === null ? this.spawn.q : { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    for (const b of this.bodyList) { b.rb.setTranslation({ x, y, z }, true); b.rb.setRotation(q, true); b.rb.setLinvel({ x: 0, y: 0, z: 0 }, true); b.rb.setAngvel({ x: 0, y: 0, z: 0 }, true); }
    for (const t of this.tools) { t.cut.reset(); t.has = false; }
    this.sync(); this.poseNodes(); this.root.updateMatrixWorld(true);
  }

  get position() { return this.bodyList[0].obj.position; }
  get heading() { _f.set(0, 0, -1).applyQuaternion(this.bodyList[0].obj.quaternion); return Math.atan2(-_f.x, -_f.z); }
  /** Heading of the leading half: the front body going forward, the rear body in reverse (articulated machines). */
  headingOf(reverse = false) {
    let best = this.bodyList[0];
    for (const b of this.bodyList) if (reverse ? b.def.com[2] > best.def.com[2] : b.def.com[2] < best.def.com[2]) best = b;
    _f.set(0, 0, -1).applyQuaternion(best.obj.quaternion); return Math.atan2(-_f.x, -_f.z);
  }

  // ------------------------------------------------------------------ per game step (before physics)
  pre(dt) {
    const inp = this.inp, e = this.engine, ed = this.def.engine;
    this.tick++; this.events.length = 0;
    // engine: key → crank → run
    if (inp.key > 0.5 && !e.running) { e.crank += dt; if (e.crank > 0.9) { e.running = true; e.rpm = ed.idleRpm * 0.7; this.events.push({ type: 'start' }); } } else if (inp.key <= 0.5) { if (e.running) this.events.push({ type: 'stop' }); e.running = false; e.crank = 0; }
    const demand = e.running ? clamp(Math.max(inp.throttle, this.def.drive.type === 'tracks' ? 1 - inp.decel : inp.accel), 0, 1) : 0;
    const want = e.running ? ed.idleRpm + (ed.maxRpm - ed.idleRpm) * (this.def.drive.type === 'tracks' ? Math.max(0.25, inp.throttle) * (1 - 0.8 * inp.decel) : demand) : 0;
    const target = want - e.load * 170;
    e.rpm += (target - e.rpm) * Math.min(1, dt * (target > e.rpm ? 2.4 : 1.6));
    const flow = e.running ? 0.4 + 0.6 * clamp((e.rpm - ed.idleRpm) / (ed.maxRpm - ed.idleRpm), 0, 1) : 0;
    this.flow = flow; this.demand = demand;

    // hydraulic functions
    for (const f of this.fnList) {
      const cmd = clamp(inp[f.input ?? f.name] || 0, -1, 1) * (f.sign ?? 1);
      f.cmd = cmd;
      let rate = f.manual ? f.rate : f.rate * flow; // a seat swivels by hand; everything else needs oil flow
      if (f.loadSlows && cmd * f.loadSlows > 0) rate /= 1 + this.digRate * 1.5; // forcing the tool into the ground is slower
      f.pos = clamp(f.pos + cmd * rate * dt, f.min, f.max);
    }
    for (const ff of this.feelFns) { ff.cmd = e.running ? ff.src.cmd : 0; ff.pos = ff.src.pos; }
    for (const ev of this.feel.update(dt, this.feelFns)) { this.events.push(ev); this.bump = Math.max(this.bump, ev.type === 'clank' ? 0.3 + 0.4 * ev.strength : 0.12 * ev.strength); }
    // articulation: rate-limited hydraulic steer
    for (const j of this.joints) {
      const d = j.def, goal = clamp(-(inp[d.input] || 0), -1, 1) * d.max;
      j.target += clamp(goal - j.target, -d.rate * flow * dt, d.rate * flow * dt);
      j.joint.configureMotorPosition(j.target, d.stiffness ?? 6e6, d.damping ?? 9e5);
    }
    // steered wheels (rigid-frame machines)
    for (const w of this.wheels) if (w.def.steer) w.steer += clamp(-(inp.steer || 0) * w.def.steer - w.steer, -1.2 * dt, 1.2 * dt);

    this.poseNodes();
    // skid contacts and node colliders in their body's frame for the substeps
    for (const b of this.bodyList) b.obj.updateMatrixWorld(true);
    for (const c of this.contacts) { c.node.localToWorld(_p.copy(c.pos)); c.body.obj.worldToLocal(c.local.copy(_p)); }
    for (const k in this.containers) { const c = this.containers[k]; c.obj.getWorldPosition(_p); c.body.obj.worldToLocal(c.local.copy(_p)); c.weight = c.field.volume() * 1600 * G; }
    for (const nc of this.nodeColliders) {
      _m4.copy(nc.node.body.obj.matrixWorld).invert().multiply(nc.node.obj.matrixWorld);
      _p.copy(nc.pos).applyMatrix4(_m4); _q.setFromRotationMatrix(_m4);
      nc.col.setTranslationWrtParent({ x: _p.x, y: _p.y, z: _p.z }); nc.col.setRotationWrtParent({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    }

    // drive demand
    const dr = this.def.drive, sp = this.speed;
    this.tractive = 0; this.trackTarget = null;
    if (e.running && dr.type === 'wheels') {
      const dir = inp.shuttle > 0.5 ? 1 : inp.shuttle < -0.5 ? -1 : 0, vmax = dir >= 0 ? dr.maxSpeed[0] : dr.maxSpeed[1], along = sp * dir;
      this.tractive = dir * inp.accel * Math.min(dr.maxForce, dr.power / Math.max(Math.abs(sp), 1)) * clamp((vmax - along) / (vmax * 0.15), 0, 1);
      this.gear = dir;
    } else if (e.running && dr.type === 'tracks') {
      const k = dr.maxSpeed[0] * (0.35 + 0.65 * flow);
      this.trackTarget = { L: clamp(inp.left, -1, 1) * k, R: clamp(inp.right, -1, 1) * k };
      this.gear = Math.sign(inp.left + inp.right);
    } else this.gear = 0;
    // brakes: pedal, park brake, and a light automatic hold when the accelerator is released
    this.brake = dr.type === 'wheels' ? Math.max(inp.brake, inp.park > 0.5 ? 1 : 0, inp.accel < 0.05 || this.gear === 0 ? 0.35 : 0) : (inp.park > 0.5 || !e.running ? 1 : inp.brake);
    // engine load for the next step: driving, hydraulics, digging
    e.load = clamp(inp.accel * 0.3 * Math.abs(this.gear || 0) + this.feel.demand * 0.3 + this.feel.relief * 0.45 + Math.min(1, this.digRate) * 0.6 + (this.trackTarget ? (Math.abs(inp.left) + Math.abs(inp.right)) * 0.15 : 0), 0, 1);
  }

  poseNodes() {
    for (const n of this.nodeList) {
      const d = n.def; if (!d.angle) continue;
      let a = d.offset ?? 0; for (const [fn, k] of d.angle) a += this.fn[fn].pos * k;
      if (d.slide) { n.obj.position.fromArray(d.pos).addScaledVector(AX[d.axis], a); }
      else n.obj.quaternion.copy(n.base).multiply(_q.setFromAxisAngle(AX[d.axis], a));
    }
  }

  // ------------------------------------------------------------------ per physics substep
  applyForces(h) {
    const terrain = this.terrain, dr = this.def.drive;
    for (const b of this.bodyList) { b.rb.resetForces(true); b.rb.resetTorques(true); }
    let driven = 0; for (const w of this.wheels) if (w.grounded && w.def.driven !== false) driven++;
    const perWheel = driven ? this.tractive / driven : 0;
    for (const w of this.wheels) {
      const rb = w.body.rb, t = rb.translation(), r = rb.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _c.copy(w.pos).applyQuaternion(_q); _c.x += t.x; _c.y += t.y; _c.z += t.z;      // wheel centre at rest length
      _f.set(0, 0, -1); if (w.steer) _f.applyAxisAngle(AX.y, w.steer); _f.applyQuaternion(_q);
      // ground under the wheel: sample ahead and behind too so it climbs steps instead of sinking into them
      const reach = w.r * 0.55;
      let g = terrain.heightAt(_c.x, _c.z);
      if (!w.side) g = Math.max(g, terrain.heightAt(_c.x + _f.x * reach, _c.z + _f.z * reach) - 0.12 * w.r, terrain.heightAt(_c.x - _f.x * reach, _c.z - _f.z * reach) - 0.12 * w.r);
      const x = g - (_c.y - this.sus.ext - w.r); // compression of the spring
      if (x <= 0) { w.grounded = false; w.comp = -this.sus.ext; w.N = 0; continue; }
      _p.set(_c.x, g, _c.z);
      const v = rb.velocityAtPoint(_p);
      terrain.normalAt(_c.x, _c.z, _na); _n.set(_na[0], _na[1], _na[2]);
      const vn = v.x * _n.x + v.y * _n.y + v.z * _n.z;
      let N = w.k * x - w.c * vn;
      const over = x - (this.sus.ext + this.sus.travel); if (over > 0) N += w.k * 6 * over; // bump stop
      if (N < 0) N = 0;
      w.grounded = true; w.N = N; w.comp = Math.min(x, this.sus.ext + this.sus.travel) - this.sus.ext; w.gx = _c.x; w.gz = _c.z;
      // tyre frame on the ground plane
      _f.addScaledVector(_n, -_f.dot(_n)).normalize(); _s.crossVectors(_f, _n);
      const vf = v.x * _f.x + v.y * _f.y + v.z * _f.z, vs = v.x * _s.x + v.y * _s.y + v.z * _s.z;
      w.vf = vf;
      const matId = terrain.materialAt(_c.x, _c.z), mu = terrain.gripAt(_c.x, _c.z) * (w.side ? 1.35 : 1), soft = MATERIALS[matId].compaction; // grousers bite
      const kill = w.share / h * 0.5; // force that would stop this wheel's share of the mass in ~2 substeps
      let Fl, Fs = -vs * kill * (w.side ? 0.55 : 1);
      if (w.side) { // track contact: hydrostatic drive holds a target speed
        const tv = this.trackTarget ? this.trackTarget[w.side] : 0, fmax = dr.maxForce / (this.wheels.length / 2);
        Fl = this.trackTarget && !(this.brake > 0.5) ? clamp((tv - vf) * kill * 0.6, -fmax, fmax) : clamp(-vf * kill, -fmax * 1.5, fmax * 1.5);
        w.spin += (this.trackTarget ? tv : vf) * h / w.r;
      } else {
        Fl = w.def.driven !== false ? perWheel : 0;
        const bmax = this.brake * dr.brake / this.wheels.length + N * (0.02 + 0.22 * soft); // brakes + rolling resistance (soft ground drags)
        Fl += clamp(-vf * kill, -bmax, bmax);
        w.spin += vf * h / w.r;
      }
      const lim = mu * N, tot = Math.hypot(Fl, Fs);
      w.slip = tot > lim ? 1 - lim / tot : 0;
      if (tot > lim && tot > 0) { const sc = lim / tot; Fl *= sc; Fs *= sc; }
      _a.copy(_n).multiplyScalar(N).addScaledVector(_f, Fl).addScaledVector(_s, Fs);
      rb.addForceAtPoint({ x: _a.x, y: _a.y, z: _a.z }, { x: _p.x, y: _p.y, z: _p.z }, true);
    }
    for (const c of this.contacts) {
      const rb = c.body.rb, t = rb.translation(), r = rb.rotation();
      _p.copy(c.local).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)); _p.x += t.x; _p.y += t.y; _p.z += t.z;
      const x = terrain.heightAt(_p.x, _p.z) - _p.y;
      if (x <= 0) { c.N = 0; continue; }
      const v = rb.velocityAtPoint(_p), kc = 2 * Math.sqrt(c.k * this.mass) * 0.5;
      const N = Math.max(0, c.k * Math.min(x, 0.4) - kc * v.y); c.N = N;
      const kill = this.mass / this.contacts.length / h * 0.4, lim = c.mu * N;
      let fx = -v.x * kill, fz = -v.z * kill; const tot = Math.hypot(fx, fz);
      if (tot > lim && tot > 0) { fx *= lim / tot; fz *= lim / tot; }
      rb.addForceAtPoint({ x: fx, y: N, z: fz }, { x: _p.x, y: _p.y, z: _p.z }, true);
    }
    // payload weight bears down where the container is
    for (const k in this.containers) {
      const c = this.containers[k]; if (!(c.weight > 1)) continue;
      const rb = c.body.rb, t = rb.translation(), r = rb.rotation();
      _p.copy(c.local).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)); _p.x += t.x; _p.y += t.y; _p.z += t.z;
      rb.addForceAtPoint({ x: 0, y: -c.weight, z: 0 }, { x: _p.x, y: _p.y, z: _p.z }, true);
    }
    // digging resistance pushes back on the body carrying the tool
    for (const t of this.tools) {
      if (t.rate <= 1e-4) continue;
      const sp = Math.hypot(t.vel.x, t.vel.z); if (sp < 0.05) continue;
      const F = Math.min(t.rate * this.mass * 2.2, t.def.maxForce ?? this.mass * 7);
      t.body.rb.addForce({ x: -t.vel.x / sp * F, y: 0, z: -t.vel.z / sp * F }, true);
    }
    // soft fence at the edge of the map
    const T = terrain, x0 = T.ox + 3, x1 = T.ox + (T.nx - 1) * T.cell - 3, z0 = T.oz + 3, z1 = T.oz + (T.nz - 1) * T.cell - 3;
    for (const b of this.bodyList) {
      const t = b.rb.translation(), fx = t.x < x0 ? x0 - t.x : t.x > x1 ? x1 - t.x : 0, fz = t.z < z0 ? z0 - t.z : t.z > z1 ? z1 - t.z : 0;
      if (fx || fz) { const lv = b.rb.linvel(); b.rb.addForce({ x: (fx * 10 - lv.x * 2) * b.mass, y: 0, z: (fz * 10 - lv.z * 2) * b.mass }, true); }
    }
    // deep water drags
    const p0 = this.bodyList[0].rb.translation(), wd = terrain.waterDepthAt(p0.x, p0.z);
    if (wd > 0.5) for (const b of this.bodyList) { const lv = b.rb.linvel(), k = b.mass * (wd - 0.5) * 1.5; b.rb.addForce({ x: -lv.x * k, y: 0, z: -lv.z * k }, true); }
  }

  // ------------------------------------------------------------------ per game step (after physics)
  sync() {
    for (const b of this.bodyList) { const t = b.rb.translation(), r = b.rb.rotation(); b.obj.position.set(t.x, t.y, t.z); b.obj.quaternion.set(r.x, r.y, r.z, r.w); }
  }
  post(dt) {
    this.sync();
    const b0 = this.bodyList[0], lv = b0.rb.linvel();
    _f.set(0, 0, -1).applyQuaternion(b0.obj.quaternion);
    this.speed = lv.x * _f.x + lv.y * _f.y + lv.z * _f.z;
    this.root.updateMatrixWorld(true);
    for (const w of this.wheels) { w.mesh.position.y = w.pos.y + (w.grounded ? w.comp : -this.sus.ext); w.mesh.rotation.set(-w.spin, w.steer, 0, 'YXZ'); }
    // tools: cut what the edge swept, feed the container, remember resistance
    let dig = 0;
    for (const t of this.tools) {
      const c = t.container, m = t.node.matrixWorld;
      // a container only takes soil while it is the right way up
      const ce = c ? c.obj.matrixWorld.elements : m.elements; _up.set(ce[4], ce[5], ce[6]).normalize();
      const cap = c && _up.y > 0.2 ? c.field.free() : 0;
      t.node.getWorldPosition(_p);
      if (t.has) t.vel.copy(_p).sub(t.prev).divideScalar(dt); t.prev.copy(_p); t.has = true;
      const res = t.cut.step(m.elements, this.terrain, cap, true);
      let moved = 0, resist = 0;
      if (res) {
        for (let k = 1; k < NMAT; k++) if (res.taken[k] > 0) { if (c) c.field.add(k, res.taken[k]); moved += res.taken[k]; }
        moved += res.pushed; resist = res.resist;
      }
      t.rate += (resist / dt - t.rate) * 0.3; t.moved = moved; dig += t.rate;
    }
    this.digRate = dig;
    let spill = 0; for (const r of this.rigs) spill += r.spillRate; this.spillRate = spill;
    // ruts
    if (this.tick % 4 === 0) for (const w of this.wheels) if (w.grounded && Math.abs(w.vf) > 0.2) this.terrain.compact(w.gx, w.gz, (w.def.w ?? 0.5) * 0.6, clamp(w.N / (w.share * G), 0, 1));
    this.bump *= 0.8;
  }

  /** Volume held in this machine's containers (m³). */
  payload(name) { return name ? this.containers[name].field.volume() : this.rigs.reduce((s, r) => s + r.field.volume(), 0); }
  /** What the sound and haptics need. */
  audioState() {
    return { running: this.engine.running, cranking: !this.engine.running && this.engine.crank > 0, rpm: this.engine.rpm, load: this.engine.load, demand: this.feel.demand, relief: this.feel.relief, dig: Math.min(1, this.digRate), spill: Math.min(1, this.spillRate),
      tracks: this.def.drive.type === 'tracks' ? Math.abs(this.speed) : 0, reverse: this.gear < 0 && this.engine.running };
  }
}
