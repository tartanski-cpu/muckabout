// Where a dozer blade's soil goes, and where the push-heap granules go: flat ground (blade held down, so it dives), a
// trench (blade held down all the way) and a standing ridge of pushed soil. Prints a time series and a summary.
// Usage: node tools/bladeprobe.mjs [shallow|flat|trench|pile] [steps]   shallow: a 15 cm cut held by AUTO LEVEL   (headless: no browser, no build)
import { rig } from '../tests/helpers.js';
import { PushHeap } from '../src/render/pushHeap.js';

const which = process.argv[2] || 'flat', STEPS = +(process.argv[3] || 900);
const start = (m) => { m.inp.key = 1; m.inp.park = 0; };
const at = which === 'trench' ? { x: 15, z: 22 } : { x: 15, z: 18 };
const r = await rig('dozer', at); const m = r.m, T = r.terrain, core = T.core;
m.setPhysics('custom');
r.step(60); start(m); m.inp.throttle = 1; r.step(90);

if (which === 'pile') { // a standing ridge of pushed topsoil across the path, 1.7 m high, at repose
  const z0 = 8, H = 1.7, s = Math.tan(36 * Math.PI / 180);
  for (let x = 9; x <= 21; x += 0.25) for (let z = 2; z <= 14; z += 0.25) {
    const h = Math.min(H, H - (Math.abs(z - z0) - 0.6) * s, H - (Math.abs(x - 15) - 3.5) * s); if (h <= 0) continue;
    const c = core.cellAt(x, z); core.addTop(c, 1, Math.min(h, H)); core.dist[c] = 255; core.wake(c);
  }
  r.step(30);
}

// what each cut of the blade reports (docs/blade-soil.md): new ground cut, heap carried, face height, spill off the ends, resistance
const rec = { n: 0, fresh: 0, pushed: 0, load: 0, face: 0, spill: 0, resist: 0 }, all = { fresh: 0, pushed: 0, spill: 0 };
const cut0 = core.cut.bind(core);
core.cut = (cmd) => { const res = cut0(cmd); if (cmd.heap && !cmd.rip) { rec.n++; for (const k of ['fresh', 'pushed', 'load', 'face', 'spill', 'resist']) rec[k] += res[k] || 0; } return res; };
const heap = new PushHeap(T);
const tool = m.tools[0];
const gran = []; // samples of granule positions in blade frame
const h0 = T.h.slice();
const edgeY = () => { const e = tool.node.matrixWorld.elements, C = tool.def.corners[2]; return e[1] * C[0] + e[5] * C[1] + e[9] * C[2] + e[13]; };
if (which === 'shallow') { // edge 15 cm into the ground, held there by AUTO LEVEL: an ordinary cut on virgin ground
  const g0 = T.heightAt(at.x, at.z - 3); r.step(300, (mm) => { mm.inp.lift = edgeY() > g0 - 0.15 ? -0.4 : 0; }); m.inp.lift = 0; m.inp.grade = 1;
} else r.step(which === 'pile' ? 40 : 110, (mm) => { mm.inp.lift = -1; });
m.inp.lift = 0;
let vmax = 0, vmin = 9, stall = 0;
for (let i = 0; i < STEPS; i++) {
  r.step(1, (mm) => { mm.inp.left = 0.8; mm.inp.right = 0.8; mm.inp.lift = which === 'trench' ? -1 : 0; }); // (the lift is read from the controls every frame in the game: AUTO LEVEL's own command must not linger as if the operator held it)
  for (const ev of m.events) if (ev.type === 'churn') heap.kick(ev.tool);
  heap.update(1 / 60);
  if (i % 100 === 99) {
    const e = tool.node.matrixWorld.elements, C = tool.def.corners[2], ey = e[1] * C[0] + e[5] * C[1] + e[9] * C[2] + e[13], n = rec.n || 1;
    console.log(`t ${((i + 1) / 60).toFixed(1)} s  v ${m.speed.toFixed(2)}  edge ${ey.toFixed(2)}  new ground ${rec.fresh.toFixed(2)} m³  carried ${(rec.load / n).toFixed(2)} m³  face ${(rec.face / n).toFixed(2)} m  off the ends ${rec.spill.toFixed(2)} m³  digRate ${m.digRate.toFixed(1)}`);
    all.fresh += rec.fresh; all.pushed += rec.pushed; all.spill += rec.spill; for (const k in rec) rec[k] = 0;
  }
  vmax = Math.max(vmax, m.speed); if (i > 120) vmin = Math.min(vmin, m.speed);
  if (i % 30 === 0) {
    const s = heap.states.get(tool); if (!s) continue;
    const C = tool.def.corners, e = tool.node.matrixWorld.elements, tp = (p) => [e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]];
    const L = tp(C[2]), R = tp(C[3]), B = tp(C[0]); let ax = R[0] - L[0], az = R[2] - L[2]; const w = Math.hypot(ax, az); ax /= w; az /= w;
    let fx = -az, fz = ax; if (fx * (L[0] - B[0]) + fz * (L[2] - B[2]) < 0) { fx = -fx; fz = -fz; }
    const mx = (L[0] + R[0]) / 2, mz = (L[2] + R[2]) / 2;
    for (let k = 0; k < s.p.length; k += 10) { if (!s.p[k + 9]) continue; const x = s.p[k], z = s.p[k + 2];
      gran.push({ d: (x - mx) * fx + (z - mz) * fz, u: (x - mx) * ax + (z - mz) * az, hw: w / 2, lift: s.p[k + 1] - T.heightAt(x, z), sp: Math.hypot(s.p[k + 3], s.p[k + 5]), bs: m.speed, i }); }
  }
}

const q = (arr, p) => { if (!arr.length) return NaN; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
console.log(`\n== ${which}: travelled ${(at.z - m.position.z).toFixed(1)} m, speed max ${vmax.toFixed(2)} min ${vmin.toFixed(2)}; new ground cut ${all.fresh.toFixed(1)} m³, put off the blade ends ${all.spill.toFixed(1)} m³`);
// cross-section halfway along the push: height against the ground as it was, across the path
{ const z = (at.z + m.position.z) / 2; let row = ''; for (let dx = -4; dx <= 4.01; dx += 0.5) { const c = core.cellAt(at.x + dx, z); row += (T.h[c] - h0[c] >= 0 ? '+' : '') + (T.h[c] - h0[c]).toFixed(2) + ' '; } console.log(`  across the path at z ${z.toFixed(1)} (x −4 … +4 m, blade ends at ±1.7): ${row}`); }
let berm = 0, bermX = 0;
for (let z = m.position.z + 3; z < at.z; z += 0.25) for (let dx = 1.0; dx < 5; dx += 0.25) for (const sg of [-1, 1]) {
  const x = at.x + sg * dx, c = core.cellAt(x, z), dh = T.h[c] - h0[c]; if (dx >= 1.75 && dh > berm) { berm = dh; bermX = dx; } }
console.log(`  tallest mound beside the path: +${berm.toFixed(2)} m at ${bermX.toFixed(2)} m from the centre line (blade half-width 1.7)`);
const gd = gran.map((g) => g.d), go = gran.map((g) => Math.abs(g.u) - g.hw);
console.log(`granules sampled ${gran.length}: ahead p50 ${q(gd, 0.5).toFixed(2)} p90 ${q(gd, 0.9).toFixed(2)} max ${q(gd, 0.999).toFixed(2)} m; beyond ends p90 ${q(go, 0.9).toFixed(2)} max ${q(go, 0.999).toFixed(2)}; share > 2 m ahead ${(100 * gran.filter((g) => g.d > 2).length / gran.length).toFixed(0)} %`);
const gs = gran.filter((g) => g.d > 1.5); if (gs.length) console.log(`  those > 1.5 m ahead: speed p50 ${q(gs.map((g) => g.sp), 0.5).toFixed(2)} vs blade ${q(gs.map((g) => g.bs), 0.5).toFixed(2)}`);
