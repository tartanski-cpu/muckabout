// muckshift — proof of concept: drive a wheel loader from the cab in VR and move dirt.
// Kept as the feel/tuning reference for the MVP rewrite (see docs/mvp-spec.md). Changes from
// the original single-file POC are limited to harness hooks: perf timers, wrist HUD, a
// stress mode, a pause switch and a volume audit for the scripted test.
// Terrain model: heightfield + granular slump (angle of repose) + airborne clods that
// re-deposit into the heightfield when they land. Volume is conserved throughout.
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { PerfMonitor } from '../harness/perf.js';
import { WristHud } from '../harness/wristHud.js';
import { MachineAudio, renderEngine } from '../audio/machineAudio.js';
import { HydraulicFeel } from '../audio/hydraulicFeel.js';

const perf = new PerfMonitor(['input', 'vehicle', 'dig', 'clods', 'relax', 'upload', 'render']);
const wristHud = new WristHud(perf);

// ------------------------------------------------------------------ helpers
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const dz = (v, d = 0.15) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));
let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
renderer.xr.setFoveation(1);
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fcbee);
scene.fog = new THREE.Fog(0x9fcbee, 70, 190);
scene.add(new THREE.HemisphereLight(0xd8ecff, 0x6b5636, 1.6));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.position.set(30, 50, 18);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);

// ------------------------------------------------------------------ terrain (heightfield)
const N = 160, CELL = 0.25, SIZE = N * CELL, HALF = SIZE / 2, V = N + 1, AREA = CELL * CELL;
const H = new Float32Array(V * V);   // current height
const H0 = new Float32Array(V * V);  // original height (for colouring cuts)
const BR = new Float32Array(V * V);  // bedrock floor
const D = new Float32Array(V * V);   // 0 = undisturbed grass, 1 = disturbed dirt
const J = new Float32Array(V * V);   // colour jitter (clumpy look)
const idx = (i, j) => j * V + i;
const TRUCK = { x: -9.5, z: -3.5 };

for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
  const x = -HALF + i * CELL, z = -HALF + j * CELL, k = idx(i, j);
  const edge = Math.min(i, j, N - i, N - j) * CELL;
  let h = (Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.5 + Math.sin(x * 0.07 + 1.3) * Math.sin(z * 0.09 + 0.4) * 0.8 +
    Math.sin((x + z) * 0.33) * 0.1) * 0.35 * smooth(0, 6, edge);
  // flat pad for the truck and the start area
  const pad = Math.max(Math.abs(x - TRUCK.x) - 4.5, Math.abs(z - TRUCK.z) - 2.5, 0);
  h *= smooth(0, 3, pad);
  h *= smooth(1.5, 5, Math.hypot(x, z - 6));
  // the spoil heap
  const r = Math.hypot(x - 5, z + 8);
  let ph = 0;
  if (r < 7) { ph = 3.0 * (1 - r / 7); ph = ph > 2.4 ? 2.4 + (ph - 2.4) * 0.3 : ph; }
  // a second, low windrow
  const w = Math.max(Math.abs(x + 2) - 3, 0) ** 2 + (z + 12) ** 2;
  ph = Math.max(ph, 0.9 - Math.sqrt(w) * 0.5);
  if (ph > 0) h += ph;
  H[k] = H0[k] = h;
  BR[k] = Math.min(h, 0) - 2.5;
  D[k] = ph > 0.04 ? 1 : 0;
  J[k] = 0.86 + rnd() * 0.24;
}

const terrGeo = new THREE.BufferGeometry();
const tPos = new Float32Array(V * V * 3), tCol = new Float32Array(V * V * 3);
for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
  const k = idx(i, j), border = i === 0 || j === 0 || i === N || j === N;
  tPos[k * 3] = -HALF + i * CELL + (border ? 0 : (rnd() - 0.5) * 0.09);
  tPos[k * 3 + 2] = -HALF + j * CELL + (border ? 0 : (rnd() - 0.5) * 0.09);
}
const tIdx = new Uint16Array(N * N * 6);
let ti = 0;
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
  if ((i + j) & 1) { tIdx.set([a, c, b, b, c, d], ti); } else { tIdx.set([a, c, d, a, d, b], ti); }
  ti += 6;
}
terrGeo.setIndex(new THREE.BufferAttribute(tIdx, 1));
const posAttr = new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage);
const colAttr = new THREE.BufferAttribute(tCol, 3).setUsage(THREE.DynamicDrawUsage);
terrGeo.setAttribute('position', posAttr);
terrGeo.setAttribute('color', colAttr);
const terrain = new THREE.Mesh(terrGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
terrain.frustumCulled = false;
scene.add(terrain);

const GRASS = [0.30, 0.50, 0.16], DIRT = [0.62, 0.37, 0.21], CLAY = [0.47, 0.26, 0.14], ROCK = [0.46, 0.44, 0.41];
function writeVertex(k) {
  tPos[k * 3 + 1] = H[k];
  const depth = clamp((H0[k] - H[k]) / 1.6, 0, 1);
  const nearRock = smooth(0.35, 0.05, H[k] - BR[k]);
  const d = D[k], jj = J[k];
  for (let c = 0; c < 3; c++) {
    let dirt = lerp(DIRT[c], CLAY[c], depth);
    dirt = lerp(dirt, ROCK[c], nearRock);
    tCol[k * 3 + c] = lerp(GRASS[c], dirt, d) * jj;
  }
}
let dirtyJ0 = 0, dirtyJ1 = N;
function markRow(j) { if (j < dirtyJ0) dirtyJ0 = j; if (j > dirtyJ1) dirtyJ1 = j; }
function flushTerrain() {
  if (dirtyJ0 > dirtyJ1) return;
  for (let j = dirtyJ0; j <= dirtyJ1; j++) for (let i = 0; i < V; i++) writeVertex(idx(i, j));
  const start = dirtyJ0 * V * 3, count = (dirtyJ1 - dirtyJ0 + 1) * V * 3;
  posAttr.clearUpdateRanges(); colAttr.clearUpdateRanges();
  posAttr.addUpdateRange(start, count); colAttr.addUpdateRange(start, count);
  posAttr.needsUpdate = true; colAttr.needsUpdate = true;
  dirtyJ0 = 1e9; dirtyJ1 = -1;
}
flushTerrain();
terrGeo.computeBoundingSphere();

// ground beyond the patch + trees
const outer = new THREE.Mesh(new THREE.CircleGeometry(260, 48).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: new THREE.Color(...GRASS).multiplyScalar(0.95) }));
outer.position.y = -0.04;
scene.add(outer);
{
  const trunkG = new THREE.CylinderGeometry(0.15, 0.22, 1.6, 5).translate(0, 0.8, 0);
  const crownG = new THREE.ConeGeometry(1.4, 4.5, 6).translate(0, 3.6, 0);
  const NT = 140;
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x5a3a22 }), NT);
  const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: 0x2f6b2c }), NT);
  const o = new THREE.Object3D();
  for (let n = 0; n < NT; n++) {
    const a = rnd() * Math.PI * 2, r = 25 + rnd() * 45, s = 0.8 + rnd() * 0.9;
    o.position.set(Math.cos(a) * r, -0.05, Math.sin(a) * r); o.scale.setScalar(s); o.rotation.y = rnd() * 6;
    o.updateMatrix(); trunks.setMatrixAt(n, o.matrix); crowns.setMatrixAt(n, o.matrix);
    crowns.setColorAt(n, new THREE.Color().setHSL(0.31 + rnd() * 0.05, 0.45, 0.22 + rnd() * 0.1));
  }
  scene.add(trunks, crowns);
}

function heightAt(x, z) {
  const fi = clamp((x + HALF) / CELL, 0, N - 0.0001), fj = clamp((z + HALF) / CELL, 0, N - 0.0001);
  const i = fi | 0, j = fj | 0, tx = fi - i, tz = fj - j, k = idx(i, j);
  return lerp(lerp(H[k], H[k + 1], tx), lerp(H[k + V], H[k + V + 1], tx), tz);
}

// ---------------- granular slump (angle of repose) on an active rectangle
const TALUS = CELL * Math.tan(36 * Math.PI / 180), TALUS_D = TALUS * Math.SQRT2;
let act = null; // {i0,i1,j0,j1}
function activate(i, j, r = 2) {
  const i0 = clamp(i - r, 1, N - 1), i1 = clamp(i + r, 1, N - 1), j0 = clamp(j - r, 1, N - 1), j1 = clamp(j + r, 1, N - 1);
  if (!act) act = { i0, i1, j0, j1 };
  else { act.i0 = Math.min(act.i0, i0); act.i1 = Math.max(act.i1, i1); act.j0 = Math.min(act.j0, j0); act.j1 = Math.max(act.j1, j1); }
}
let bi0, bi1, bj0, bj1;
function pair(a, b, lim, ia, ja, ib, jb) {
  let d = H[a] - H[b];
  let hi = a, lo = b;
  if (d < 0) { d = -d; hi = b; lo = a; }
  if (d <= lim) return;
  let m = Math.min((d - lim) * 0.24, H[hi] - BR[hi]);
  if (m <= 0) return;
  H[hi] -= m; H[lo] += m; D[hi] = 1; D[lo] = 1;
  if (m > 0.0004) {
    const i0 = Math.min(ia, ib), i1 = Math.max(ia, ib), j0 = Math.min(ja, jb), j1 = Math.max(ja, jb);
    if (i0 < bi0) bi0 = i0; if (i1 > bi1) bi1 = i1; if (j0 < bj0) bj0 = j0; if (j1 > bj1) bj1 = j1;
  }
}
function relax(iters) {
  if (!act) return;
  const { i0, i1, j0, j1 } = act;
  bi0 = 1e9; bi1 = -1; bj0 = 1e9; bj1 = -1;
  for (let it = 0; it < iters; it++) {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = idx(i, j);
      if (i + 1 <= N - 1) pair(k, k + 1, TALUS, i, j, i + 1, j);
      if (j + 1 <= N - 1) {
        pair(k, k + V, TALUS, i, j, i, j + 1);
        if (i + 1 <= N - 1) pair(k, k + V + 1, TALUS_D, i, j, i + 1, j + 1);
        if (i - 1 >= 1) pair(k, k + V - 1, TALUS_D, i, j, i - 1, j + 1);
      }
    }
  }
  for (let j = j0; j <= j1; j++) markRow(j);
  act = null;
  if (bi1 >= 0) activate((bi0 + bi1) >> 1, (bj0 + bj1) >> 1, 0), act = {
    i0: clamp(bi0 - 1, 1, N - 1), i1: clamp(bi1 + 1, 1, N - 1), j0: clamp(bj0 - 1, 1, N - 1), j1: clamp(bj1 + 1, 1, N - 1)
  };
}

function deposit(x, z, vol) {
  if (vol <= 0) return true;
  const fi = (x + HALF) / CELL, fj = (z + HALF) / CELL;
  if (fi < 1 || fj < 1 || fi >= N - 2 || fj >= N - 2) return false;
  const i = fi | 0, j = fj | 0, tx = fi - i, tz = fj - j, dh = vol / AREA, k = idx(i, j);
  H[k] += dh * (1 - tx) * (1 - tz); H[k + 1] += dh * tx * (1 - tz);
  H[k + V] += dh * (1 - tx) * tz; H[k + V + 1] += dh * tx * tz;
  D[k] = D[k + 1] = D[k + V] = D[k + V + 1] = 1;
  activate(i, j, 2); markRow(j); markRow(j + 1);
  return true;
}

// ------------------------------------------------------------------ materials / mesh helpers
const M = {
  yellow: new THREE.MeshLambertMaterial({ color: 0xf0b21a }),
  dark: new THREE.MeshLambertMaterial({ color: 0x3a3a3c }),
  tyre: new THREE.MeshLambertMaterial({ color: 0x1f1f20, flatShading: true }),
  hub: new THREE.MeshLambertMaterial({ color: 0xd9a015 }),
  steel: new THREE.MeshLambertMaterial({ color: 0x6d6e70 }),
  seat: new THREE.MeshLambertMaterial({ color: 0x2b2b2b }),
  red: new THREE.MeshLambertMaterial({ color: 0xc9381e }),
  orange: new THREE.MeshLambertMaterial({ color: 0xd9541e }),
  glass: new THREE.MeshBasicMaterial({ color: 0x9ccbe8, transparent: true, opacity: 0.12, depthWrite: false }),
  dirt: new THREE.MeshLambertMaterial({ color: new THREE.Color(...DIRT), flatShading: true }),
  beacon: new THREE.MeshBasicMaterial({ color: 0xff8a00 }),
};
function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); parent.add(m); return m;
}
function wheel(r, w, parent, x, y, z) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2), M.tyre); g.add(t);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10).rotateZ(Math.PI / 2), M.hub); g.add(h);
  for (let n = 0; n < 7; n++) { // tread lugs so you can see it turning
    const a = (n / 7) * Math.PI * 2;
    const lug = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, 0.09, 0.16), M.tyre);
    lug.position.set(0, Math.cos(a) * r, Math.sin(a) * r); lug.rotation.x = -a; g.add(lug);
  }
  return g;
}

// ------------------------------------------------------------------ wheel loader
// root origin = rear axle centre at ground level; forward = -Z
const R = 0.75, TRACK = 2.1, LR = 1.5, LF = 1.5, GMAX = 0.68;
const root = new THREE.Group(); scene.add(root);
const rear = new THREE.Group(); root.add(rear);
box(1.4, 0.6, 3.5, M.dark, 0, 0.95, 0.25, rear);
box(1.7, 1.0, 1.9, M.yellow, 0, 1.75, 1.05, rear);           // engine hood
box(2.1, 0.9, 0.45, M.yellow, 0, 1.45, 2.15, rear);          // counterweight
box(0.6, 0.1, 1.7, M.yellow, -1.05, 1.62, 0.1, rear); box(0.6, 0.1, 1.7, M.yellow, 1.05, 1.62, 0.1, rear);
const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 6), M.dark); exhaust.position.set(0.55, 2.6, 1.5); rear.add(exhaust);
// cab
box(1.6, 0.1, 1.6, M.dark, 0, 1.55, -0.7, rear);
for (const [px, pz] of [[-0.78, -1.47], [0.78, -1.47], [-0.78, 0.07], [0.78, 0.07]]) box(0.08, 1.75, 0.08, M.yellow, px, 2.47, pz, rear);
box(1.75, 0.1, 1.8, M.yellow, 0, 3.38, -0.7, rear);
box(1.5, 0.55, 0.05, M.yellow, 0, 1.87, 0.07, rear);          // low rear wall
box(0.05, 0.08, 1.5, M.yellow, -0.78, 2.4, -0.7, rear); box(0.05, 0.08, 1.5, M.yellow, 0.78, 2.4, -0.7, rear); // door rails
box(1.5, 1.6, 0.02, M.glass, 0, 2.55, -1.47, rear);           // windscreen (faint)
const beacon = box(0.14, 0.14, 0.14, M.beacon, 0.6, 3.5, 0.0, rear);
// dash + steering column
box(1.4, 0.45, 0.28, M.dark, 0, 1.83, -1.32, rear);
const column = new THREE.Group(); column.position.set(0, 2.18, -1.05); column.rotation.x = -0.55; rear.add(column);
const colMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.4, 6).rotateX(Math.PI / 2), M.dark); colMesh.position.z = -0.2; column.add(colMesh);
const steerWheel = new THREE.Group(); column.add(steerWheel);
steerWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 6, 20), M.seat));
box(0.38, 0.03, 0.03, M.seat, 0, 0, 0, steerWheel);
const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), M.red); knob.position.set(0.16, 0.09, 0.03); steerWheel.add(knob);
// seat
box(0.55, 0.12, 0.5, M.seat, 0, 2.06, -0.25, rear);
box(0.55, 0.75, 0.1, M.seat, 0, 2.47, 0.0, rear);
// right console + loader joystick
box(0.16, 0.42, 0.5, M.dark, 0.42, 1.97, -0.35, rear);
const joyBase = new THREE.Group(); joyBase.position.set(0.42, 2.2, -0.48); rear.add(joyBase);
const joy = new THREE.Group(); joyBase.add(joy);
const joyStick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.14, 6), M.steel); joyStick.position.y = 0.07; joy.add(joyStick);
const joyKnob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.seat); joyKnob.position.y = 0.16; joy.add(joyKnob);
// dash display (canvas)
const hudCanvas = document.createElement('canvas'); hudCanvas.width = 256; hudCanvas.height = 128;
const hudCtx = hudCanvas.getContext('2d');
const hudTex = new THREE.CanvasTexture(hudCanvas);
const hud = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshBasicMaterial({ map: hudTex }));
hud.position.set(0.42, 2.12, -1.2); hud.rotation.set(-0.5, -0.25, 0); rear.add(hud);
// rear wheels
const wRL = wheel(R, 0.55, rear, -TRACK / 2, R, 0), wRR = wheel(R, 0.55, rear, TRACK / 2, R, 0);

// front frame — articulates about the hinge
const front = new THREE.Group(); front.position.set(0, 0, -LR); root.add(front);
box(1.2, 0.7, 2.4, M.dark, 0, 1.0, -0.95, front);
box(0.6, 0.1, 1.5, M.yellow, -1.05, 1.62, -1.5, front); box(0.6, 0.1, 1.5, M.yellow, 1.05, 1.62, -1.5, front);
box(0.22, 1.1, 0.5, M.yellow, -0.6, 1.75, -0.35, front); box(0.22, 1.1, 0.5, M.yellow, 0.6, 1.75, -0.35, front);
const wFL = wheel(R, 0.55, front, -TRACK / 2, R, -LF), wFR = wheel(R, 0.55, front, TRACK / 2, R, -LF);
const BOOM_L = 3.2;
const boom = new THREE.Group(); boom.position.set(0, 2.25, -0.35); front.add(boom);
box(0.18, 0.32, BOOM_L, M.yellow, -0.62, 0, -BOOM_L / 2, boom); box(0.18, 0.32, BOOM_L, M.yellow, 0.62, 0, -BOOM_L / 2, boom);
box(1.42, 0.22, 0.22, M.yellow, 0, 0, -BOOM_L * 0.62, boom);
// cosmetic lift cylinders
const bucket = new THREE.Group(); bucket.position.set(0, 0, -BOOM_L); boom.add(bucket);
const FLOOR_Y = -0.275, LIP_Z = -1.15, BACK_Z = 0.15, HALF_W = 1.2;
box(2.4, 0.05, 1.3, M.dark, 0, -0.3, -0.5, bucket);
box(2.4, 0.95, 0.05, M.dark, 0, 0.15, 0.17, bucket);
box(2.4, 0.05, 0.5, M.dark, 0, 0.62, -0.08, bucket);
box(0.05, 0.62, 1.3, M.dark, -1.2, 0.0, -0.5, bucket).geometry.translate(0, 0, 0);
box(0.05, 0.62, 1.3, M.dark, 1.2, 0.0, -0.5, bucket);
box(2.46, 0.06, 0.14, M.steel, 0, -0.29, -1.2, bucket);
box(0.25, 0.4, 0.3, M.yellow, -0.62, 0.05, 0.2, bucket); box(0.25, 0.4, 0.3, M.yellow, 0.62, 0.05, 0.2, bucket);
const fillMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), M.dirt);
fillMesh.position.set(0, FLOOR_Y, -0.48); bucket.add(fillMesh);

// ------------------------------------------------------------------ dump truck (target)
const truck = new THREE.Group(); truck.position.set(TRUCK.x, 0, TRUCK.z); scene.add(truck);
box(7.2, 0.6, 2.2, M.dark, 0, 1.0, 0, truck);
box(1.8, 1.9, 2.4, M.orange, 2.7, 2.15, 0, truck);
box(1.5, 0.8, 2.42, M.glass, 2.85, 2.6, 0, truck);
box(4.4, 0.1, 2.5, M.orange, -1.0, 1.55, 0, truck);
box(4.4, 1.0, 0.08, M.orange, -1.0, 2.1, 1.25, truck); box(4.4, 1.0, 0.08, M.orange, -1.0, 2.1, -1.25, truck);
box(0.08, 1.0, 2.5, M.orange, -3.2, 2.1, 0, truck); box(0.08, 1.3, 2.5, M.orange, 1.2, 2.25, 0, truck);
for (const tx of [-2.6, -1.3, 2.6]) for (const tz of [-1.05, 1.05]) wheel(0.6, 0.45, truck, tx, 0.6, tz).rotation.y = Math.PI / 2;
const BED = { x0: -3.15, x1: 1.15, z0: -1.2, z1: 1.2, floor: 1.6, top: 2.6 };
const bedFill = box(4.3, 1, 2.4, M.dirt, -1.0, 1.6, 0, truck); bedFill.visible = false;
let bedVol = 0;
const truckBox = { x0: TRUCK.x - 3.65, x1: TRUCK.x + 3.65, z0: TRUCK.z - 1.35, z1: TRUCK.z + 1.35 };
// label above truck
const lblCanvas = document.createElement('canvas'); lblCanvas.width = 512; lblCanvas.height = 128;
const lblTex = new THREE.CanvasTexture(lblCanvas);
const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lblTex, depthTest: false }));
label.scale.set(4, 1, 1); label.position.set(-1, 4.6, 0); truck.add(label);
const TARGET = 8;
function drawLabel() {
  const c = lblCanvas.getContext('2d');
  c.clearRect(0, 0, 512, 128);
  c.fillStyle = 'rgba(20,20,20,0.72)'; c.beginPath(); c.roundRect(8, 8, 496, 112, 22); c.fill();
  c.fillStyle = bedVol >= TARGET ? '#8fef7a' : '#ffd25a'; c.font = 'bold 50px system-ui,sans-serif'; c.textAlign = 'center';
  c.fillText(bedVol >= TARGET ? 'LOADED! ' + bedVol.toFixed(1) + ' m³' : 'LOAD ME  ' + bedVol.toFixed(1) + ' / ' + TARGET + ' m³', 256, 82);
  lblTex.needsUpdate = true;
}
drawLabel();

// ------------------------------------------------------------------ particles (airborne clods)
const PMAX = 1500, PVOL = 0.014;
const pGeo = new THREE.IcosahedronGeometry(0.13, 0);
const pMesh = new THREE.InstancedMesh(pGeo, new THREE.MeshLambertMaterial({ flatShading: true }), PMAX);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
pMesh.frustumCulled = false; pMesh.count = 0; scene.add(pMesh);
{ const c = new THREE.Color(); for (let n = 0; n < PMAX; n++) { c.setRGB(...DIRT).multiplyScalar(0.75 + rnd() * 0.4); pMesh.setColorAt(n, c); } }
const P = { x: new Float32Array(PMAX), y: new Float32Array(PMAX), z: new Float32Array(PMAX), vx: new Float32Array(PMAX), vy: new Float32Array(PMAX), vz: new Float32Array(PMAX), vol: new Float32Array(PMAX), s: new Float32Array(PMAX), r: new Float32Array(PMAX) };
let pCount = 0;
function spawn(x, y, z, vx, vy, vz, vol) {
  if (pCount >= PMAX) { if (!deposit(x, z, vol)) lostVol += vol; return; }
  const n = pCount++;
  P.x[n] = x; P.y[n] = y; P.z[n] = z; P.vx[n] = vx; P.vy[n] = vy; P.vz[n] = vz; P.vol[n] = vol;
  P.s[n] = vol > 0 ? 0.8 + rnd() * 0.5 : 0.4 + rnd() * 0.3; P.r[n] = rnd() * 6;
}
let lostVol = 0;
const _o = new THREE.Object3D();
function updateParticles(dt) {
  for (let n = 0; n < pCount; n++) {
    P.vy[n] -= 9.81 * dt;
    P.x[n] += P.vx[n] * dt; P.y[n] += P.vy[n] * dt; P.z[n] += P.vz[n] * dt; P.r[n] += dt * 5;
    const x = P.x[n], y = P.y[n], z = P.z[n];
    let dead = false;
    const lx = x - TRUCK.x, lz = z - TRUCK.z;
    const inBed = lx > BED.x0 && lx < BED.x1 && lz > BED.z0 && lz < BED.z1;
    if (inBed) {
      if (y < BED.floor + bedFillH() + 0.05 && y > 1.0) { bedVol += P.vol[n]; dead = true; bedDirty = true; }
    } else if (x > truckBox.x0 && x < truckBox.x1 && z > truckBox.z0 && z < truckBox.z1 && y < 3.0 && y > 0.8) {
      // hit truck cab/chassis: slide off sideways
      P.vx[n] *= 0.3; P.vz[n] = (lz > 0 ? 1 : -1) * 1.5; P.vy[n] = Math.max(P.vy[n], 0);
    }
    if (!dead && (Math.abs(x) > HALF - 0.6 || Math.abs(z) > HALF - 0.6)) { lostVol += P.vol[n]; dead = true; }
    if (!dead && y - 0.06 < heightAt(x, z)) { if (!deposit(x, z, P.vol[n])) lostVol += P.vol[n]; dead = true; }
    if (dead) {
      const l = --pCount;
      P.x[n] = P.x[l]; P.y[n] = P.y[l]; P.z[n] = P.z[l]; P.vx[n] = P.vx[l]; P.vy[n] = P.vy[l]; P.vz[n] = P.vz[l];
      P.vol[n] = P.vol[l]; P.s[n] = P.s[l]; P.r[n] = P.r[l]; n--;
    }
  }
  for (let n = 0; n < pCount; n++) {
    _o.position.set(P.x[n], P.y[n], P.z[n]); _o.rotation.set(P.r[n], P.r[n] * 0.7, 0); _o.scale.setScalar(P.s[n]);
    _o.updateMatrix(); pMesh.setMatrixAt(n, _o.matrix);
  }
  pMesh.count = pCount; pMesh.instanceMatrix.needsUpdate = true;
}
const bedFillH = () => Math.min(bedVol / ((BED.x1 - BED.x0) * (BED.z1 - BED.z0)), 1.3);
let bedDirty = false;

// ------------------------------------------------------------------ vehicle state & physics
const START = { x: 0, z: 6, psi: 0 };
const veh = { x: START.x, z: START.z, y: 0, vy: 0, psi: START.psi, v: 0, gamma: 0, alpha: -0.62, beta: 0.05, pitch: 0, roll: 0, steerCmd: 0 };
const ALPHA_MIN = -0.715, ALPHA_MAX = 0.95, BETA_MIN = -1.15, BETA_MAX = 0.8, CAP = 2.0;
let fill = 0, resist = 0, digRate = 0, spillRate = 0, bump = 0;

function wheelGround(x, z, fx, fz) {
  return Math.max(heightAt(x, z), heightAt(x + fx * 0.45, z + fz * 0.45), heightAt(x - fx * 0.45, z - fz * 0.45));
}
function updateVehicle(dt, inp) {
  // articulation (hydraulic, rate-limited)
  veh.gamma += clamp(veh.steerCmd * GMAX - veh.gamma, -0.75 * dt, 0.75 * dt);
  // drive
  const t = inp.throttle;
  let a = 0;
  if (Math.abs(t) > 0.04) a = veh.v * t < -0.05 ? Math.sign(t) * 7 : t * 3.6;
  else a = -Math.sign(veh.v) * Math.min(Math.abs(veh.v) / dt, 2.2);
  a -= veh.v * 0.22;
  a -= 9.81 * Math.sin(veh.pitch) * 0.85;
  veh.v += a * dt;
  veh.v -= Math.sign(veh.v) * Math.min(Math.abs(veh.v), resist * dt);
  if (Math.abs(t) < 0.04 && Math.abs(veh.v) < 0.25 && Math.abs(veh.pitch) < 0.45) veh.v = 0; // service brake holds
  veh.v = clamp(veh.v, -3.5, 6.5);
  veh.psi += veh.v * Math.sin(veh.gamma) / (LF + LR * Math.cos(veh.gamma)) * dt;
  const s = Math.sin(veh.psi), c = Math.cos(veh.psi), fx = -s, fz = -c;
  const ds = veh.v * Math.cos(veh.pitch) * dt;
  veh.x = clamp(veh.x + fx * ds, -HALF + 3, HALF - 3); veh.z = clamp(veh.z + fz * ds, -HALF + 3, HALF - 3);
  // wheel contacts
  const rx = (lx, lz) => veh.x + c * lx + s * lz, rz = (lx, lz) => veh.z - s * lx + c * lz;
  const hRL = wheelGround(rx(-TRACK / 2, 0), rz(-TRACK / 2, 0), fx, fz);
  const hRR = wheelGround(rx(TRACK / 2, 0), rz(TRACK / 2, 0), fx, fz);
  const cg = Math.cos(veh.gamma), sg = Math.sin(veh.gamma);
  const fl = (lx) => [lx * cg - LF * sg, -lx * sg - LF * cg - LR];
  const ffx = -Math.sin(veh.psi + veh.gamma), ffz = -Math.cos(veh.psi + veh.gamma);
  const [a1, b1] = fl(-TRACK / 2), [a2, b2] = fl(TRACK / 2);
  const hFL = wheelGround(rx(a1, b1), rz(a1, b1), ffx, ffz);
  const hFR = wheelGround(rx(a2, b2), rz(a2, b2), ffx, ffz);
  const yR = (hRL + hRR) / 2, yF = (hFL + hFR) / 2;
  const tp = Math.atan2(yF - yR, LR + LF), tr = Math.atan2(((hRR - hRL) + (hFR - hFL)) / 2, TRACK);
  // suspension: fall under gravity, rise with a stiff spring
  veh.vy -= 9.81 * dt; veh.y += veh.vy * dt;
  if (veh.y < yR) { if (veh.vy < -2) bump = Math.min(1, -veh.vy * 0.25); veh.y += (yR - veh.y) * Math.min(1, dt * 16); if (veh.vy < 0) veh.vy = 0; }
  veh.pitch += (tp - veh.pitch) * Math.min(1, dt * 6);
  veh.roll += (tr - veh.roll) * Math.min(1, dt * 6);
  // traction limit: too steep and you slide back
  if (Math.abs(veh.pitch) > 0.55) veh.v -= Math.sign(veh.pitch) * 3 * dt;
  // hydraulics
  const load = 1 / (1 + digRate * 1.5);
  veh.alpha = clamp(veh.alpha + inp.boom * 0.55 * dt * (inp.boom < 0 ? load : 1), ALPHA_MIN, ALPHA_MAX);
  veh.beta = clamp(veh.beta + inp.bucket * 1.15 * dt, BETA_MIN, BETA_MAX);
  // wheel spin
  const spin = veh.v / R * dt;
  wRL.rotation.x -= spin; wRR.rotation.x -= spin; wFL.rotation.x -= spin; wFR.rotation.x -= spin;
}
function applyTransforms() {
  root.position.set(veh.x, veh.y, veh.z);
  root.rotation.set(veh.pitch, veh.psi, veh.roll, 'YXZ');
  front.rotation.y = veh.gamma;
  boom.rotation.x = veh.alpha;
  bucket.rotation.x = veh.beta - veh.alpha;  // parallel linkage keeps bucket attitude as boom lifts
  root.updateMatrixWorld(true);
}

// ------------------------------------------------------------------ bucket ↔ terrain
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Vector3(), _inv = new THREE.Matrix4();
const _lip = new THREE.Vector3(), _lipPrev = new THREE.Vector3(), _dir = new THREE.Vector3();
const corners = [[-HALF_W, BACK_Z], [HALF_W, BACK_Z], [-HALF_W, LIP_Z], [HALF_W, LIP_Z]];
function bucketTilt() { // radians the lip points below the horizontal
  _dir.set(0, 0, -1).transformDirection(bucket.matrixWorld);
  return Math.asin(clamp(-_dir.y, -1, 1));
}
function capacityNow() {
  _n.set(0, 1, 0).transformDirection(bucket.matrixWorld);
  if (_n.y < 0.1) return 0;
  return CAP * clamp(1 - (bucketTilt() - 0.12) / 0.85, 0, 1);
}
function digBucket(dt) {
  const m = bucket.matrixWorld;
  _p.set(0, FLOOR_Y, 0).applyMatrix4(m);
  _n.set(0, 1, 0).transformDirection(m);
  if (Math.abs(_n.y) < 0.12) return 0;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9;
  for (const [cx, cz] of corners) {
    _q.set(cx, FLOOR_Y, cz).applyMatrix4(m);
    minX = Math.min(minX, _q.x); maxX = Math.max(maxX, _q.x); minZ = Math.min(minZ, _q.z); maxZ = Math.max(maxZ, _q.z); minY = Math.min(minY, _q.y);
  }
  if (minY > heightAt((minX + maxX) / 2, (minZ + maxZ) / 2) + 2.5) return 0; // way above ground: skip
  const i0 = clamp(Math.floor((minX + HALF) / CELL), 1, N - 1), i1 = clamp(Math.ceil((maxX + HALF) / CELL), 1, N - 1);
  const j0 = clamp(Math.floor((minZ + HALF) / CELL), 1, N - 1), j1 = clamp(Math.ceil((maxZ + HALF) / CELL), 1, N - 1);
  _inv.copy(m).invert();
  const cap = capacityNow(), into = _n.y > 0.2;
  let moved = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const k = idx(i, j), x = -HALF + i * CELL, z = -HALF + j * CELL;
    const yf = _p.y - (_n.x * (x - _p.x) + _n.z * (z - _p.z)) / _n.y;
    if (H[k] <= yf) continue;
    _q.set(x, yf, z).applyMatrix4(_inv);
    if (_q.x < -HALF_W || _q.x > HALF_W || _q.z > BACK_Z || _q.z < LIP_Z) continue;
    const floor = Math.max(yf, BR[k]);
    const amt = H[k] - floor;
    if (amt <= 0) continue;
    H[k] = floor; D[k] = 1; markRow(j); activate(i, j, 2);
    let vol = amt * AREA; moved += vol;
    if (into) { const take = Math.min(vol, Math.max(0, cap - fill)); fill += take; vol -= take; }
    if (vol > 0) { // bucket full / upside down: bulldoze ahead of the cutting edge
      _q.set(_q.x, FLOOR_Y, LIP_Z - 0.35).applyMatrix4(m);
      if (!deposit(_q.x, _q.z, vol)) lostVol += vol;
    }
  }
  if (moved > 0.0005 && rnd() < 0.6) { // cosmetic kick-up at the lip
    _q.set((rnd() - 0.5) * 2.2, FLOOR_Y + 0.1, LIP_Z).applyMatrix4(m);
    spawn(_q.x, _q.y, _q.z, (rnd() - 0.5) * 1.2, 1 + rnd() * 1.5, (rnd() - 0.5) * 1.2, 0);
  }
  return moved;
}
let spillAcc = 0;
function spillBucket(dt) {
  const m = bucket.matrixWorld;
  _lip.set(0, FLOOR_Y, LIP_Z).applyMatrix4(m);
  const lv = _q.copy(_lip).sub(_lipPrev).divideScalar(Math.max(dt, 1e-3));
  _lipPrev.copy(_lip);
  const cap = capacityNow();
  let out = 0;
  if (fill > cap) { out = Math.min(fill - cap, 2.6 * dt); fill -= out; spillAcc += out; }
  _dir.set(0, 0, -1).transformDirection(m);
  const vx = lv.x, vy = lv.y, vz = lv.z;
  while (spillAcc >= PVOL) {
    spillAcc -= PVOL;
    _p.set((rnd() - 0.5) * 2.2, FLOOR_Y + 0.05 + rnd() * 0.2, LIP_Z - 0.05).applyMatrix4(m);
    spawn(_p.x, _p.y, _p.z, vx * 0.8 + _dir.x * 1.4 + (rnd() - 0.5) * 0.6, vy * 0.8 + _dir.y * 1.4, vz * 0.8 + _dir.z * 1.4 + (rnd() - 0.5) * 0.6, PVOL);
  }
  return out;
}

// truck collision (simple: revert the step)
const _t = new THREE.Vector3();
const probesFront = [[-1.05, 0.9, -LF - 0.6], [1.05, 0.9, -LF - 0.6], [0, 1.0, -LF - 0.8]];
const probesBucket = [[-HALF_W, FLOOR_Y, LIP_Z], [HALF_W, FLOOR_Y, LIP_Z], [-HALF_W, FLOOR_Y, BACK_Z], [HALF_W, FLOOR_Y, BACK_Z], [0, 0.6, 0]];
const probesRear = [[-1.0, 1.0, 2.3], [1.0, 1.0, 2.3], [-1.3, 1.0, 0], [1.3, 1.0, 0]];
function hitsTruck() {
  const test = (obj, list) => list.some(([x, y, z]) => {
    _t.set(x, y, z).applyMatrix4(obj.matrixWorld);
    if (_t.x < truckBox.x0 || _t.x > truckBox.x1 || _t.z < truckBox.z0 || _t.z > truckBox.z1) return false;
    const lx = _t.x - TRUCK.x;
    return _t.y < (lx > BED.x1 ? 3.1 : BED.top);
  });
  return test(front, probesFront) || test(bucket, probesBucket) || test(rear, probesRear);
}

// ------------------------------------------------------------------ player rig
const EYE = new THREE.Vector3(0, 2.86, -0.3);
const rig = new THREE.Group(); rig.position.copy(EYE); rear.add(rig); rig.add(camera);
let chase = false, lookYaw = 0, lookPitch = -0.12;
const ctrls = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.12), new THREE.MeshLambertMaterial({ color: 0xe8e3d8, emissive: 0x000000 }));
  hand.position.z = 0.03; c.add(hand); c.userData.hand = hand;
  c.addEventListener('connected', (e) => { c.userData.src = e.data; if (e.data.handedness === 'left') wristHud.attachTo(c); });
  c.addEventListener('disconnected', () => { c.userData.src = null; });
  rig.add(c); return c;
});
let recenterIn = -1;
renderer.xr.addEventListener('sessionstart', () => { recenterIn = 30; chase = false; startAudio(); });
renderer.xr.addEventListener('sessionend', () => { rig.position.copy(EYE); rig.rotation.set(0, 0, 0); camera.position.set(0, 0, 0); });
function recenter() {
  const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
  rig.rotation.set(0, -yaw, 0);
  rig.updateMatrix();
  const off = camera.position.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  rig.position.copy(EYE).sub(off);
}

// grabbable controls
const grab = { wheel: null, joy: null };
let wheelAngle = 0, wheelPrevA = 0, steerSource = 'none';
const joyTilt = { x: 0, z: 0 }; const joyStart = new THREE.Vector3();
const _w = new THREE.Vector3();
function ctrlPosIn(obj, c) { c.getWorldPosition(_w); return obj.worldToLocal(_w); }
const WHEEL_TURNS = 1.4 * Math.PI;

// ------------------------------------------------------------------ input
const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code); startAudio();
  if (e.code === 'KeyV') chase = !chase;
  if (e.code === 'KeyR') resetLoader();
  if (e.code === 'KeyH') horn();
  if (e.code === 'KeyP') wristHud.toggle();
  if (e.code === 'KeyT') setStress(!stress);
});
addEventListener('keyup', (e) => keys.delete(e.code));
let dragging = false;
renderer.domElement.addEventListener('pointerdown', () => { dragging = true; startAudio(); });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  lookYaw -= e.movementX * 0.004; lookPitch = clamp(lookPitch - e.movementY * 0.004, -1.2, 1.2);
});
const prevBtn = {};
function pressed(id, now) { const was = prevBtn[id]; prevBtn[id] = now; return now && !was; }
function resetLoader() { Object.assign(veh, { x: START.x, z: START.z, y: heightAt(START.x, START.z) + 1, vy: 0, psi: START.psi, v: 0, gamma: 0, pitch: 0, roll: 0, steerCmd: 0 }); }

function readInput() {
  const inp = { throttle: 0, boom: 0, bucket: 0 };
  let stickSteer = 0, haveStick = false;
  const k = (c) => keys.has(c) ? 1 : 0;
  inp.throttle = k('KeyW') - k('KeyS');
  stickSteer = k('KeyA') - k('KeyD'); haveStick = stickSteer !== 0;
  inp.boom = k('KeyI') - k('KeyK');
  inp.bucket = k('KeyJ') - k('KeyL');
  const session = renderer.xr.getSession();
  for (const c of ctrls) {
    const src = c.userData.src; c.userData.hand.material.emissive.setHex(0);
    if (!session || !src || !src.gamepad) continue;
    const gp = src.gamepad, hand = src.handedness, ax = gp.axes, b = gp.buttons;
    const sx = dz(ax[2] || 0), sy = dz(ax[3] || 0);
    const squeeze = b[1] && b[1].pressed;
    c.userData.squeeze = squeeze;
    if (hand === 'left') {
      inp.throttle += -sy;
      if (sx !== 0) { stickSteer = -sx; haveStick = true; }
      if (pressed('Y', b[5] && b[5].pressed)) resetLoader();
      if (pressed('X', b[4] && b[4].pressed)) wristHud.toggle();
      if (pressed('LS', b[3] && b[3].pressed)) setStress(!stress);
    } else {
      inp.boom += sy;          // pull back = raise
      inp.bucket += -sx;       // left = curl back, right = dump
      if (pressed('A', b[4] && b[4].pressed)) horn();
      if (pressed('B', b[5] && b[5].pressed)) recenter();
    }
    // --- grabbing
    const pWheel = ctrlPosIn(column, c);
    const pJoy = ctrlPosIn(joyBase, c);
    const nearWheel = Math.abs(Math.hypot(pWheel.x, pWheel.y) - 0.19) < 0.09 && Math.abs(pWheel.z) < 0.1;
    const nearJoy = pJoy.distanceTo(_t.set(0, 0.16, 0)) < 0.1;
    if (!squeeze) { if (grab.wheel === c) grab.wheel = null; if (grab.joy === c) { grab.joy = null; joyTilt.x = joyTilt.z = 0; } }
    if ((nearWheel || nearJoy) && !squeeze) c.userData.hand.material.emissive.setHex(0x333300);
    if (squeeze && !c.userData.held) { // grip just pressed
      if (nearWheel && !grab.wheel) { grab.wheel = c; wheelPrevA = Math.atan2(pWheel.y, pWheel.x); }
      else if (nearJoy && !grab.joy) { grab.joy = c; joyStart.copy(pJoy); }
    }
    c.userData.held = squeeze;
    if (grab.wheel === c) {
      const a = Math.atan2(pWheel.y, pWheel.x);
      let d = a - wheelPrevA; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      wheelPrevA = a; wheelAngle = clamp(wheelAngle + d, -WHEEL_TURNS, WHEEL_TURNS);
      steerSource = 'wheel';
    }
    if (grab.joy === c) {
      joyTilt.x = clamp((pJoy.x - joyStart.x) / 0.07, -1, 1);
      joyTilt.z = clamp((pJoy.z - joyStart.z) / 0.07, -1, 1);
      inp.boom += dz(joyTilt.z, 0.12);
      inp.bucket += -dz(joyTilt.x, 0.12);
    }
  }
  if (haveStick) { veh.steerCmd = stickSteer; steerSource = 'stick'; wheelAngle = veh.steerCmd * WHEEL_TURNS; }
  else if (steerSource === 'wheel') veh.steerCmd = wheelAngle / WHEEL_TURNS;
  else { veh.steerCmd = 0; wheelAngle = 0; }
  if (grab.wheel) veh.steerCmd = wheelAngle / WHEEL_TURNS;
  inp.throttle = clamp(inp.throttle, -1, 1); inp.boom = clamp(inp.boom, -1, 1); inp.bucket = clamp(inp.bucket, -1, 1);
  // visual controls
  steerWheel.rotation.z = wheelAngle;
  if (!grab.joy) { joy.rotation.x = inp.boom * 0.35; joy.rotation.z = inp.bucket * 0.35; }
  else { joy.rotation.x = joyTilt.z * 0.35; joy.rotation.z = -joyTilt.x * 0.35; }
  return inp;
}

function haptic(intensity, ms) {
  const session = renderer.xr.getSession();
  if (!session || intensity < 0.02) return;
  for (const src of session.inputSources) {
    const act = src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
    if (act && act.pulse) act.pulse(clamp(intensity, 0, 1), ms);
  }
}

// ------------------------------------------------------------------ audio + hydraulic feel (src/audio/)
const audio = new MachineAudio({ cylinders: 6, idleRpm: 800, maxRpm: 2200 });
const feel = new HydraulicFeel();
const hydFns = [
  { name: 'boom', cmd: 0, pos: 0, min: ALPHA_MIN, max: ALPHA_MAX },
  { name: 'bucket', cmd: 0, pos: 0, min: BETA_MIN, max: BETA_MAX },
];
let fastForward = false;
function startAudio() { audio.start(); }
function horn() { audio.start(); audio.horn(); }
function hydraulicFeel(dt, inp) { // valve clunks and end-stop clanks: sound + a thump in the hands
  hydFns[0].cmd = inp.boom; hydFns[0].pos = veh.alpha;
  hydFns[1].cmd = inp.bucket; hydFns[1].pos = veh.beta;
  for (const e of feel.update(dt, hydFns)) {
    bump = Math.max(bump, e.type === 'clank' ? 0.3 + 0.4 * e.strength : 0.12 * e.strength);
    if (!fastForward) audio.play(e);
  }
}
function updateAudio(dt, inp) {
  audio.update(dt, { throttle: Math.abs(inp.throttle), demand: feel.demand, relief: feel.relief, dig: Math.min(digRate, 1), spill: Math.min(spillRate, 1) });
}

// ------------------------------------------------------------------ HUD
function drawHud(fps) {
  const c = hudCtx;
  c.fillStyle = '#10161a'; c.fillRect(0, 0, 256, 128);
  c.strokeStyle = '#ffb21a'; c.lineWidth = 3; c.strokeRect(2, 2, 252, 124);
  c.fillStyle = '#ffd25a'; c.font = 'bold 22px monospace';
  c.fillText((Math.abs(veh.v) * 3.6).toFixed(0).padStart(2, ' ') + ' km/h  ' + (veh.v < -0.05 ? 'R' : veh.v > 0.05 ? 'F' : 'N'), 12, 30);
  c.fillText('BKT ' + fill.toFixed(2) + ' m³', 12, 60);
  c.fillStyle = '#2b3a40'; c.fillRect(12, 70, 232, 12);
  c.fillStyle = '#c98a3a'; c.fillRect(12, 70, 232 * clamp(fill / CAP, 0, 1), 12);
  c.fillStyle = '#9fe08a'; c.font = 'bold 18px monospace';
  c.fillText('TRUCK ' + bedVol.toFixed(1) + '/' + TARGET + '  ' + fps + 'fps', 12, 110);
  hudTex.needsUpdate = true;
}
const overlay = document.getElementById('stats');

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
let frames = 0, fpsT = 0, fps = 0, hudT = 0, simTime = 0;
const prev = {};
veh.y = heightAt(veh.x, veh.z);
applyTransforms();
_lipPrev.set(0, FLOOR_Y, LIP_Z).applyMatrix4(bucket.matrixWorld);

// Stress mode: keep the clod budget full by fountaining material out of the spoil heap.
// Volume-conserving (each clod is excavated from a cell), so the audit still holds.
let stress = false;
function setStress(on) { stress = on; wristHud.note = on ? 'STRESS: clod fountain' : ''; }
function stressStep() {
  const want = Math.min(PMAX - pCount, 40), dh = PVOL / AREA;
  for (let n = 0; n < want; n++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 5, x = 5 + Math.cos(a) * r, z = -8 + Math.sin(a) * r;
    const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL), k = idx(i, j);
    if (H[k] - BR[k] < dh) continue;
    H[k] -= dh; D[k] = 1; markRow(j); activate(i, j, 2);
    spawn(-HALF + i * CELL, H[k] + 0.3, -HALF + j * CELL, (rnd() - 0.5) * 5, 5 + rnd() * 5, (rnd() - 0.5) * 5, PVOL);
  }
}

function step(dt, inp) {
  perf.begin('vehicle');
  Object.assign(prev, veh);
  updateVehicle(dt, inp);
  applyTransforms();
  if (hitsTruck()) {
    const v = veh.v; Object.assign(veh, prev); veh.v = -v * 0.15; bump = Math.max(bump, Math.min(1, Math.abs(v) * 0.4 + 0.3));
    applyTransforms();
  }
  hydraulicFeel(dt, inp);
  perf.end('vehicle');
  perf.begin('dig');
  const moved = digBucket(dt);
  digRate = lerp(digRate, moved / dt, 0.3);
  resist = clamp(moved / dt * 3.2, 0, 9);
  spillRate = lerp(spillRate, spillBucket(dt) / dt, 0.3);
  perf.end('dig');
  perf.begin('clods');
  if (stress) stressStep();
  updateParticles(dt);
  perf.end('clods');
  perf.begin('relax');
  activeCells = act ? (act.i1 - act.i0 + 1) * (act.j1 - act.j0 + 1) : 0;
  relax(3);
  perf.end('relax');
}
let activeCells = 0, paused = false;

// Everything that holds soil, for the conservation audit (m³ above bedrock).
function volume() {
  let ground = 0, airborne = 0;
  for (let k = 0; k < H.length; k++) ground += H[k] - BR[k];
  for (let n = 0; n < pCount; n++) airborne += P.vol[n];
  ground *= AREA;
  return { ground, bucket: fill, bed: bedVol, airborne, pending: spillAcc, lost: lostVol, total: ground + fill + bedVol + airborne + spillAcc + lostVol };
}

function loop() {
  const dt = clamp(clock.getDelta(), 1 / 240, 1 / 30);
  simTime += dt; frames++; fpsT += dt;
  if (fpsT > 0.5) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
  perf.begin('input');
  const inp = readInput();
  if (window.__autopilot) window.__autopilot(inp, simTime);
  perf.end('input');
  if (!paused) step(dt, inp);
  if (recenterIn > 0 && --recenterIn === 0) recenter();
  // bucket contents & truck bed visuals
  fillMesh.visible = fill > 0.02;
  if (fillMesh.visible) { const f = clamp(fill / CAP, 0, 1.2); fillMesh.scale.set(1.12, 0.15 + f * 0.75, 0.6); }
  if (bedDirty) { bedDirty = false; const h = bedFillH(); bedFill.visible = h > 0.01; bedFill.scale.y = Math.max(h, 0.01); bedFill.position.y = BED.floor + h / 2; drawLabel(); }
  beacon.visible = (simTime * 2.5) % 1 < 0.5;
  perf.begin('upload');
  flushTerrain();
  perf.end('upload');
  // feel
  haptic(Math.min(1, digRate * 0.5) + bump, 30); bump *= 0.8;
  updateAudio(dt, inp);
  hudT += dt; if (hudT > 0.25) { hudT = 0; drawHud(fps); if (overlay) overlay.textContent = `${fps} fps · bucket ${fill.toFixed(2)} m³ · truck ${bedVol.toFixed(1)} m³ · clods ${pCount}`; }
  // desktop camera
  if (!renderer.xr.isPresenting) {
    if (chase) {
      if (camera.parent !== scene) scene.add(camera);
      const a = veh.psi + lookYaw;
      camera.position.set(veh.x + Math.sin(a) * 11, veh.y + 6 + lookPitch * -6, veh.z + Math.cos(a) * 11);
      camera.lookAt(veh.x - Math.sin(veh.psi) * 2, veh.y + 1.5, veh.z - Math.cos(veh.psi) * 2);
    } else {
      if (camera.parent !== rig) { rig.add(camera); }
      camera.position.set(0, 0, 0); camera.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
    }
  }
  perf.begin('render');
  renderer.render(scene, camera);
  perf.end('render');
  perf.count('clods', pCount);
  perf.count('active', activeCells);
  perf.count('calls', renderer.info.render.calls);
  perf.count('tris', renderer.info.render.triangles);
  perf.frame();
  wristHud.update(dt);
}
renderer.setAnimationLoop(loop);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
window.__game = { sim(n, f) { fastForward = true; for (let i = 0; i < n; i++) { const inp = { throttle: 0, boom: 0, bucket: 0 }; f && f(inp, simTime); simTime += 1 / 72; step(1 / 72, inp); } flushTerrain(); perf.discard(); fastForward = false; }, veh, get fill() { return fill; }, get bedVol() { return bedVol; }, get pCount() { return pCount; }, H, AREA, get lostVol() { return lostVol; }, setChase: (v) => { chase = v; }, setLook: (y, p) => { lookYaw = y; lookPitch = p; },
  volume, perf, wristHud, audio, feel, renderEngine, startAudio, setStress, pause: (v) => { paused = v; } };
