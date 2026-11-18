// Where a dozer blade's soil goes, and where the push-heap granules go: flat ground (blade held down, so it dives), a
// trench (blade held down all the way) and a standing ridge of pushed soil. Prints a time series and a summary.
// Usage: node tools/bladeprobe.mjs [flat|trench|pile] [steps]   (headless: no browser, no build)
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

// record every deposit made by a cut, in the blade's frame at that moment
const rec = [], all = []; let inCut = null;
const cut0 = core.cut.bind(core), dep0 = core.deposit.bind(core);
core.cut = (cmd) => { const P = cmd.p1; inCut = { lx: P[6], lz: P[8], rx: P[9], rz: P[11], ly: P[7], bx: P[0], bz: P[2] }; const res = cut0(cmd); inCut = null; return res; };
core.deposit = (x, z, mat, v) => {
  if (inCut && v > 0) { const c = inCut, ax0 = c.rx - c.lx, az0 = c.rz - c.lz, w = Math.hypot(ax0, az0), ax = ax0 / w, az = az0 / w;
    let fx = -az, fz = ax; if (fx * (c.lx - c.bx) + fz * (c.lz - c.bz) < 0) { fx = -fx; fz = -fz; }
    const mx = (c.lx + c.rx) / 2, mz = (c.lz + c.rz) / 2, u = (x - mx) * ax + (z - mz) * az, d = (x - mx) * fx + (z - mz) * fz;
    rec.push({ u, d, v, side: Math.abs(u) > w / 2 + 0.05, out: Math.abs(u) - w / 2 }); }
  return dep0(x, z, mat, v);
};

const heap = new PushHeap(T);
const tool = m.tools[0];
const gran = []; // samples of granule positions in blade frame
const h0 = T.h.slice();
let lift = which === 'pile' ? 40 : 110;
r.step(lift, (mm) => { mm.inp.lift = -1; }); m.inp.lift = 0;
let vmax = 0, vmin = 9, stall = 0;
for (let i = 0; i < STEPS; i++) {
  r.step(1, (mm) => { mm.inp.left = 0.8; mm.inp.right = 0.8; if (which === 'trench') mm.inp.lift = -1; });
  for (const ev of m.events) if (ev.type === 'churn') heap.kick(ev.tool);
  heap.update(1 / 60);
  if (i % 100 === 99) { const win = rec.splice(0); const t = win.reduce((a, x) => a + x.v, 0), sd = win.filter((x) => x.side), sv = sd.reduce((a, x) => a + x.v, 0);
    const e = tool.node.matrixWorld.elements, C = tool.def.corners[2], ey = e[1] * C[0] + e[5] * C[1] + e[9] * C[2] + e[13], ex = e[0]*C[0]+e[4]*C[1]+e[8]*C[2]+e[12], ez = e[2]*C[0]+e[6]*C[1]+e[10]*C[2]+e[14];
    let hp = -9; for (let d = 0.2; d < 3; d += 0.25) hp = Math.max(hp, T.heightAt(at.x, ez - d) - ey);
    win.forEach((x) => all.push(x));
    console.log(`t ${((i + 1) / 60).toFixed(1)} s  v ${m.speed.toFixed(2)}  edge ${(ey - 0.0).toFixed(2)} (ground ${T.heightAt(at.x, at.z).toFixed(2)})  heap above edge ${hp.toFixed(2)}  cut ${t.toFixed(2)} m3  sides ${(100 * sv / (t || 1)).toFixed(0)} %  out ${sd.length ? (sd.reduce((a, x) => a + x.out * x.v, 0) / sv).toFixed(2) : '-'}`); }
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

rec.push(...all);
const q = (arr, p) => { if (!arr.length) return NaN; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const tot = rec.reduce((s, x) => s + x.v, 0), side = rec.filter((x) => x.side), sideV = side.reduce((s, x) => s + x.v, 0);
console.log(`\n== ${which}: travelled ${(at.z - m.position.z).toFixed(1)} m, speed max ${vmax.toFixed(2)} min ${vmin.toFixed(2)}, depth ${(h0[core.cellAt(at.x, at.z)] - m.position.y).toFixed(2)}`);
console.log(`cut deposits ${tot.toFixed(2)} m³, round the ends ${sideV.toFixed(2)} (${(100 * sideV / tot).toFixed(0)} %)`);
const wq = (arr, key, p) => { const a = [...arr].sort((x, y) => x[key] - y[key]); let s = 0; const T = a.reduce((t, x) => t + x.v, 0); for (const x of a) { s += x.v; if (s >= p * T) return x[key]; } return NaN; };
if (side.length) console.log(`  side spill: beyond blade end p10 ${wq(side, 'out', 0.1).toFixed(2)} p50 ${wq(side, 'out', 0.5).toFixed(2)} p90 ${wq(side, 'out', 0.9).toFixed(2)} m; ahead of lip p50 ${wq(side, 'd', 0.5).toFixed(2)}`);
const front = rec.filter((x) => !x.side); if (front.length) console.log(`  in front: ahead of lip p50 ${wq(front, 'd', 0.5).toFixed(2)} m`);
// mounds: height change beside the path, relative to the original ground
let berm = 0, bermX = 0, front2 = 0;
for (let z = m.position.z; z < at.z; z += 0.25) for (let dx = 1.0; dx < 5; dx += 0.25) for (const sg of [-1, 1]) {
  const x = at.x + sg * dx, c = core.cellAt(x, z), dh = T.h[c] - h0[c]; if (dx >= 1.75 && dh > berm) { berm = dh; bermX = dx; } }
console.log(`  tallest mound beside the path: +${berm.toFixed(2)} m at ${bermX.toFixed(2)} m from the centre line (blade half-width 1.7)`);
const gd = gran.map((g) => g.d), go = gran.map((g) => Math.abs(g.u) - g.hw);
console.log(`granules sampled ${gran.length}: ahead p50 ${q(gd, 0.5).toFixed(2)} p90 ${q(gd, 0.9).toFixed(2)} max ${q(gd, 0.999).toFixed(2)} m; beyond ends p90 ${q(go, 0.9).toFixed(2)} max ${q(go, 0.999).toFixed(2)}; share > 2 m ahead ${(100 * gran.filter((g) => g.d > 2).length / gran.length).toFixed(0)} %`);
const gs = gran.filter((g) => g.d > 1.5); if (gs.length) console.log(`  those > 1.5 m ahead: speed p50 ${q(gs.map((g) => g.sp), 0.5).toFixed(2)} vs blade ${q(gs.map((g) => g.bs), 0.5).toFixed(2)}`);
