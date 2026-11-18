// Soil round a dozer blade (docs/blade-soil.md): where the cut soil goes, what the machine feels, and where the granules
// that dress the pushed heap may go. The figures come from engineering sources quoted in that document.
import { describe, it, expect } from 'vitest';
import { rig } from './helpers.js';
import { PushHeap } from '../src/render/pushHeap.js';

const start = (m) => { m.inp.key = 1; m.inp.park = 0; };
const edgeY = (m) => { const t = m.tools[0], e = t.node.matrixWorld.elements, C = t.def.corners[2]; return e[1] * C[0] + e[5] * C[1] + e[9] * C[2] + e[13]; };

/** A dozer at x 15 heading −z, its edge set `cut` m into the ground and held there by AUTO LEVEL. `ground(core)` changes the map first. */
async function dozer(cut, ground) {
  const r = await rig('dozer', { x: 15, z: 18 }); const m = r.m; m.setPhysics('custom');
  if (ground) { ground(r.terrain.core); r.step(30); }
  r.step(60); start(m); m.inp.throttle = 1; r.step(90);
  const g0 = r.terrain.heightAt(15, 15);
  r.step(300, (mm) => { mm.inp.lift = edgeY(mm) > g0 - cut ? -0.4 : 0; }); m.inp.lift = 0; m.inp.grade = 1;
  const h0 = r.terrain.h.slice(), v0 = await r.total();
  // (in the game the lift is read from the controls every frame: AUTO LEVEL's own command must not linger as the operator's)
  const drive = (n, each) => r.step(n, (mm, i) => { mm.inp.left = 0.8; mm.inp.right = 0.8; mm.inp.lift = 0; if (each) each(mm, i); });
  const rise = (x, z) => { const c = r.terrain.core.cellAt(x, z); return r.terrain.h[c] - h0[c]; };
  return { r, m, g0, h0, v0, drive, rise };
}

describe('soil round a dozer blade', () => {
  it('on virgin ground: the soil is pushed against the blade, and what it cannot hold is left as windrows right at its ends', async () => {
    const { r, m, v0, drive, rise } = await dozer(0.15);
    let load = 0, slow = 9; drive(900, (mm, i) => { load = Math.max(load, mm.tools[0].load || 0); if (i > 300) slow = Math.min(slow, mm.speed); });
    let crest = 0, crestAt = 0, beyond = 0;
    for (let z = m.position.z + 6; z < 12; z += 0.5) for (const s of [-1, 1]) for (let dx = 1.0; dx <= 4.5; dx += 0.25) {
      const h = rise(15 + s * dx, z); if (h > crest) { crest = h; crestAt = dx; } if (dx >= 3.0) beyond = Math.max(beyond, h); }
    console.log(`virgin ground, 15 cm cut: carried up to ${load.toFixed(2)} m³ at ${slow.toFixed(2)} m/s; windrow +${crest.toFixed(2)} m, ${crestAt.toFixed(2)} m from the middle (blade ends at 1.7); ground 3 m out +${beyond.toFixed(2)}`);
    expect(load).toBeGreaterThan(1);                 // a heap builds against the blade
    expect(slow).toBeGreaterThan(0.7);               // an ordinary cut does not bog it down
    expect(crestAt).toBeGreaterThanOrEqual(1.7); expect(crestAt).toBeLessThanOrEqual(2.3); // the windrow lies at the blade's end
    expect(crest).toBeLessThan(0.6);                 // and low, not a mound
    expect(beyond).toBeLessThan(0.1);                // nothing thrown out beyond it
    expect(Math.abs(await r.total() - v0) / v0).toBeLessThan(1e-3);
  }, 120000);

  it('in a slot: the walls hold the load, next to nothing goes over them, and the blade carries more than in the open', async () => {
    const open = await dozer(0.15); let free = 0; open.drive(600, (mm) => { free = Math.max(free, mm.tools[0].load || 0); });
    // walls of untouched ground 1.5 m high either side of the path, 3.8 m apart (the blade is 3.4 m)
    const { r, m, v0, drive, rise } = await dozer(0.15, (core) => { for (let x = 9; x <= 21; x += 0.25) for (let z = -6; z <= 16; z += 0.25) if (Math.abs(x - 15) >= 1.9) { const c = core.cellAt(x, z); core.addTop(c, 1, 1.5); core.dist[c] = 0; core.wake(c); } });
    let load = 0; drive(600, (mm) => { load = Math.max(load, mm.tools[0].load || 0); });
    let over = 0; for (let z = m.position.z + 1; z < 12; z += 0.5) for (const s of [-1, 1]) for (let dx = 2.25; dx <= 4.5; dx += 0.25) over = Math.max(over, rise(15 + s * dx, z));
    console.log(`slot: carried up to ${load.toFixed(2)} m³ (open ground ${free.toFixed(2)}); soil on the walls +${over.toFixed(2)} m`);
    expect(over).toBeLessThan(0.1);                  // no windrow on top of the walls: at most a dusting from a blade driven on when full
    expect(load).toBeGreaterThan(free * 1.15);       // slot dozing carries 20–30 % more (FM 5-434, Cat)
    expect(Math.abs(await r.total() - v0) / v0).toBeLessThan(1e-3);
  }, 120000);

  it('into a standing pile: the machine bogs down, and the granules move only the wedge in front of the blade', async () => {
    // a ridge of pushed topsoil across the path, 1.5 m high, at repose: its foot at z 10.7, its crest from z 8.6 to 7.4
    const { r, m, v0, drive } = await dozer(0.1, (core) => { const s = Math.tan(36 * Math.PI / 180);
      for (let x = 9; x <= 21; x += 0.25) for (let z = 2; z <= 14; z += 0.25) { const h = Math.min(1.5, 1.5 - (Math.abs(z - 8) - 0.6) * s, 1.5 - (Math.abs(x - 15) - 3.5) * s); if (h <= 0) continue; const c = core.cellAt(x, z); core.addTop(c, 1, h); core.dist[c] = 255; core.wake(c); } });
    const heap = new PushHeap(r.terrain), tool = m.tools[0];
    let before = 0, against = 9, far = 0, fast = 0, n = 0;
    drive(700, (mm, i) => {
      const lipZ = mm.position.z - 3.0; // the blade's edge is about 3 m ahead of the machine's middle
      if (lipZ > 11.7) before = Math.max(before, mm.speed);            // more than a metre short of the pile
      if (lipZ < 10.2 && lipZ > 9) against = Math.min(against, mm.speed); // half a metre to a metre and a half into it
      for (const ev of mm.events) if (ev.type === 'churn') heap.kick(ev.tool);
      heap.update(1 / 60);
      const s = heap.states.get(tool); if (!s || i % 20) return;
      const e = tool.node.matrixWorld.elements, C = tool.def.corners, lx = (C[2][0] + C[3][0]) / 2, lz = C[2][2], x0 = e[0] * lx + e[8] * lz + e[12], z0 = e[2] * lx + e[10] * lz + e[14];
      for (let k = 0; k < s.p.length; k += 10) if (s.p[k + 9]) { n++; const d = -(s.p[k + 2] - z0); far = Math.max(far, d); if (d > 0.6) fast = Math.max(fast, Math.hypot(s.p[k + 3], s.p[k + 5]) - 1.25 * Math.abs(mm.speed)); }
    });
    console.log(`pile: ${before.toFixed(2)} m/s before it, ${against.toFixed(2)} m/s against it; ${n} granule samples, farthest ${far.toFixed(2)} m ahead of the edge, fastest ${fast.toFixed(2)} m/s beyond 1.25 × the machine's speed`);
    expect(against).toBeLessThan(before * 0.4);      // a pile face engages the whole blade: it bogs down
    expect(n).toBeGreaterThan(1000);
    expect(far).toBeLessThan(1.6 * 1.15 + 0.5);      // the heap moved is the wedge, at most 1.6 × blade height, not the whole pile
    expect(fast).toBeLessThan(0.6);                  // the surface rolls a little faster than the blade and tumbles down the face; nothing is thrown
    expect(Math.abs(await r.total() - v0) / v0).toBeLessThan(1e-3);
  }, 120000);

  it('a blade lifted clear lets go of its load: a machine stalled with a full blade backs off freely', async () => {
    const r = await rig('dozer', { x: 10, z: 16 }); const m = r.m; m.setPhysics('custom'); r.step(60); start(m); m.inp.throttle = 1; r.step(90);
    r.step(110, (mm) => { mm.inp.lift = -1; }); m.inp.lift = 0;
    r.step(900, (mm) => { mm.inp.left = 0.8; mm.inp.right = 0.8; mm.inp.lift = 0; });
    expect(m.tools[0].load).toBeGreaterThan(2);
    r.step(120, (mm) => { mm.inp.left = 0; mm.inp.right = 0; mm.inp.lift = 1; });
    r.step(240, (mm) => { mm.inp.left = -0.8; mm.inp.right = -0.8; mm.inp.lift = 0; });
    expect(m.tools[0].load).toBe(0);                 // nothing is cut once it is clear, so nothing is reported: the load fades
    expect(m.speed).toBeLessThan(-2);                // and it reverses at full speed
  }, 120000);
});
