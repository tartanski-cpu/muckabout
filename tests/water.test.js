import { describe, it, expect } from 'vitest';
import { TerrainCore } from '../src/terrain/core.js';
import { MAPS } from '../src/terrain/maps.js';
import { attachWater } from '../src/terrain/water.js';
import { MUD, GRAVEL } from '../src/terrain/materials.js';

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
