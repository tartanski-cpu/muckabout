import { describe, it, expect } from 'vitest';
import { TerrainCore } from '../src/terrain/core.js';
import { MAPS } from '../src/terrain/maps.js';
import { attachWater } from '../src/terrain/water.js';
import { MUD, GRAVEL, CLAY } from '../src/terrain/materials.js';

const river = () => { const core = new TerrainCore(MAPS.dirttown.cfg); MAPS.dirttown.build(core); const w = attachWater(core, MAPS.dirttown); return { core, w }; };
const run = (core, n) => { for (let i = 0; i < n; i++) core.step(); };
const at = (w, x, z) => { const i = Math.floor((x - w.ox) / w.cell), j = Math.floor((z - w.oz) / w.cell); return j * w.nx + i; };
// build a ford across the channel centred on x: fill to `top` metres with material m over a 5 m length of river
function fill(core, x, top, m) {
  for (let px = x - 2.5; px <= x + 2.5; px += 0.25) for (let z = 12; z <= 28; z += 0.25) {
    const c = core.cellAt(px, z), need = top - core.h[c];
    if (need > 0 && core.h[c] < 0.3) { core.addTop(c, m, need); core.wake(c); }
  }
}
const crest = (core, x) => { let lo = 9; for (let z = 17; z <= 23; z += 0.25) lo = Math.min(lo, core.heightAt(x, z + 1.5 * Math.sin(x * 0.08))); return lo; };

describe('river', () => {
  it('fills the channel and flows steadily downstream', () => {
    const { core, w } = river();
    run(core, 300);
    const mid = at(w, 0, 20), v1 = w.volume();
    process.stderr.write('river: ' + [-55, -30, 0, 30, 55].map((x) => `x${x} d ${w.d[at(w, x, MAPS.dirttown.riverZ(x))].toFixed(2)} v ${w.vx[at(w, x, MAPS.dirttown.riverZ(x))].toFixed(2)}`).join(' | ') + '\n');
    expect(w.d[mid]).toBeGreaterThan(0.5); expect(w.d[mid]).toBeLessThan(1.6);
    expect(w.vx[mid]).toBeGreaterThan(0.15);
    expect(w.d[at(w, 0, 9)]).toBe(0);                 // the flats stay dry
    run(core, 900);
    expect(Math.abs(w.volume() - v1) / v1).toBeLessThan(0.12); // inflow ≈ outflow
    expect(core.wet[core.cellAt(0, 20)]).toBe(1);
  }, 60000);

  it('washes out a mud crossing but not a gravel-capped one', () => {
    const results = {};
    for (const kind of ['mud', 'capped']) {
      const { core, w } = river();
      run(core, 300);
      if (kind === 'mud') fill(core, 0, -0.12, MUD); else { fill(core, 0, -0.42, MUD); fill(core, 0, -0.12, GRAVEL); }
      const v0 = core.audit().total, c0 = crest(core, 0);
      run(core, 60 * 120); // two minutes
      results[kind] = { drop: c0 - crest(core, 0), washed: w.washed, depth: w.d[at(w, 0, 20)], drift: Math.abs(core.audit().total - v0) / v0 };
    }
    console.log('ford after 2 min:', JSON.stringify(results));
    expect(results.mud.drop).toBeGreaterThan(0.3);
    expect(results.capped.drop).toBeLessThan(0.05);
    expect(results.mud.drift).toBeLessThan(1e-4); expect(results.capped.drift).toBeLessThan(1e-4);
  }, 180000);
});

describe('water anywhere: springs, ponds, and tiles that sleep', () => {
  // a 40 m slope falling south into a hollow; a spring near the top
  const slope = {
    cfg: { nx: 160, nz: 160, cell: 0.25, ox: -20, oz: -20 },
    springs: [{ x: 0, z: -15, rate: 0.5 }], waterWarmup: 0,
    build(core) {
      const { nx, nz, cell, ox, oz } = core.cfg;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = ox + i * cell, z = oz + j * cell, hollow = Math.max(0, 1 - Math.hypot(x, z - 10) / 7) * 2.5;
        const g = 4 - (z + 20) * 0.08 - hollow + 0.02 * Math.sin(x * 0.7); // a gentle fall south, a hollow 2.5 m deep at (0, 10)
        core.setColumn(j * nx + i, g - 3, [[CLAY, 3]]);
      }
    },
  };
  it('a spring runs downhill, wakes the tiles it reaches, and fills a hollow: none of its water lost', () => {
    const core = new TerrainCore(slope.cfg); slope.build(core); const w = attachWater(core, slope);
    expect(w.list.length).toBe(1); // only the spring's tile is awake
    const T = 60 * 120; run(core, T);
    const inHollow = w.d[at(w, 0, 10)], added = 0.5 * T / 60, held = w.volume();
    process.stderr.write(`spring: ${w.list.length} tiles awake, ${held.toFixed(1)} of ${added.toFixed(1)} m³ held, ${inHollow.toFixed(2)} m deep in the hollow\n`);
    expect(inHollow).toBeGreaterThan(0.3);                      // it has found its way down and is filling the hollow
    expect(Math.abs(held - added) / added).toBeLessThan(0.01);  // every drop accounted for (none can leave this map)
    expect(w.list.length).toBeGreaterThan(3);
    for (const [x, z] of [[-18, -18], [18, -18]]) expect(w.active[w.tileOf(w.cellAt(x, z))]).toBe(0); // the uphill corners, which the water never reaches, stay asleep
    expect(core.wet[core.cellAt(0, 10)]).toBe(1);
  }, 60000);
  it('a pond drained away goes to sleep, and its ground dries', () => {
    const core = new TerrainCore(slope.cfg); slope.build(core);
    const w = attachWater(core, { ...slope, springs: [], ponds: [{ x: 0, z: 10, r: 6, level: 0.5 }] });
    const awake = w.list.length; expect(awake).toBeGreaterThan(0); expect(core.wet[core.cellAt(0, 10)]).toBe(1);
    for (const t of [...w.list]) { const [i0, j0, i1, j1] = w._range(t); for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) w.d[j * w.nx + i] = 0; } // drained (as a culvert would)
    run(core, 300);
    expect(w.list.length).toBe(0);
    expect(core.wet[core.cellAt(0, 10)]).toBe(0);
  }, 60000);
});
