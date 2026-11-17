import { describe, it, expect } from 'vitest';
import { TerrainCore } from '../src/terrain/core.js';
import { MAPS } from '../src/terrain/maps.js';
import { MATERIALS, SAND, CLAY, GRAVEL, MUD, TOPSOIL, SPOIL, NMAT } from '../src/terrain/materials.js';
import { ContainerField } from '../src/terrain/containers.js';
import { Clods } from '../src/terrain/clods.js';
import { makeRng } from '../src/util/rng.js';

const flat = (mat = SAND, depth = 2, n = 64) => {
  const core = new TerrainCore({ nx: n, nz: n, cell: 0.25, ox: -n / 8, oz: -n / 8 });
  for (let c = 0; c < core.n; c++) core.setColumn(c, -depth, [[mat, depth]]);
  return core;
};
const settle = (core, max = 4000) => { let k = 0; while (core.qLen > 0 && k++ < max) core.relax(); return k; };
// floor rectangle 2 m wide, 1 m deep, lip toward -z, centred at (x, z), floor at height y
const rect = (x, y, z, w = 2, d = 1) => [x - w / 2, y, z + d / 2, x + w / 2, y, z + d / 2, x - w / 2, y, z - d / 2, x + w / 2, y, z - d / 2];
const maxSlopeDeg = (core) => {
  let s = 0;
  for (let j = 2; j < core.nz - 2; j++) for (let i = 2; i < core.nx - 2; i++) {
    const c = j * core.nx + i;
    s = Math.max(s, Math.abs(core.h[c] - core.h[c + 1]), Math.abs(core.h[c] - core.h[c + core.nx]));
  }
  return Math.atan(s / core.cell) * 180 / Math.PI;
};

describe('TerrainCore', () => {
  it('piles settle near each material\'s angle of repose', () => {
    for (const mat of [SAND, MUD, GRAVEL]) {
      const core = flat(CLAY, 1);
      for (let k = 0; k < 400; k++) { core.deposit(0, 0, mat, 0.02); core.relax(); }
      settle(core);
      const peak = core.heightAt(0, 0);
      // measure the flank: height at a quarter of the way out
      let r = 0; while (core.heightAt(r, 0) > 0.02 && r < 7) r += 0.05;
      const deg = Math.atan(peak / r) * 180 / Math.PI;
      expect(deg).toBeGreaterThan(MATERIALS[mat].repose - 9);
      expect(deg).toBeLessThan(MATERIALS[mat].repose + 3);
      expect(maxSlopeDeg(core)).toBeLessThan(MATERIALS[mat].repose + 4);
    }
  });

  it('clay holds a steep cut that sand does not', () => {
    const faces = [CLAY, SAND].map((mat) => {
      const core = flat(mat, 3);
      core.cut({ p0: rect(0, -1.5, 0, 3, 3), p1: rect(0, -1.5, 0, 3, 3), capacity: 1e9 });
      settle(core);
      return maxSlopeDeg(core);
    });
    expect(faces[0]).toBeGreaterThan(50);
    expect(faces[1]).toBeLessThan(MATERIALS[SAND].repose + 4);
  });

  it('wet ground slumps flatter', () => {
    const dry = flat(CLAY, 1), wet = flat(CLAY, 1); wet.wet.fill(1);
    for (const core of [dry, wet]) { for (let k = 0; k < 300; k++) { core.deposit(0, 0, MUD, 0.02); core.relax(); } settle(core); }
    expect(wet.heightAt(0, 0)).toBeLessThan(dry.heightAt(0, 0) * 0.8);
  });

  it('conserves volume through cut, windrow, deposit, compaction and relaxation', () => {
    const core = new TerrainCore(MAPS.test.cfg); MAPS.test.build(core);
    const v0 = core.audit().total; let held = 0;
    for (let k = 0; k < 120; k++) { // drive a bucket floor through the sand heap, 10 cm a step
      const z = 0 - k * 0.1, r = core.cut({ p0: rect(5, 0.1, z + 0.1), p1: rect(5, 0.1, z), capacity: Math.max(0, 2 - held) });
      held += r.taken.reduce((a, b) => a + b, 0);
      core.compact(5 - 1, z + 3, 0.4, 1); core.compact(5 + 1, z + 3, 0.4, 1);
      core.relax();
    }
    expect(held).toBeCloseTo(2, 3);
    for (let k = 0; k < 140; k++) { core.deposit(-3 + (k % 7) * 0.1, 3, SAND, held / 140); core.relax(); }
    settle(core);
    const a = core.audit();
    expect(a.compacted).toBeGreaterThan(0);
    expect(Math.abs(a.total - v0) / v0).toBeLessThan(1e-5);
  });

  it('books material that lands off the map as lost', () => {
    const core = flat();
    const v0 = core.audit().total;
    expect(core.deposit(999, 0, SAND, 0.5)).toBe(false);
    expect(core.audit().lost).toBe(0.5);
    expect(core.audit().total).toBeCloseTo(v0 + 0.5, 6);
  });

  it('a fast swept cut does not tunnel', () => {
    const core = flat(CLAY, 2);
    // the blade jumps 3 m in one step, cutting 0.3 m deep
    const r = core.cut({ p0: rect(0, -0.3, 2, 2, 0.5), p1: rect(0, -0.3, -1, 2, 0.5), capacity: 0 });
    let uncut = 0;
    for (let z = -0.75; z <= 1.75; z += 0.25) if (core.h[core.cellAt(0, z)] > -0.29) uncut++;
    expect(uncut).toBe(0);
    expect(r.pushed).toBeGreaterThan(1.5); // ~2 m × 3 m × 0.3 m, all windrowed
    expect(core.heightAt(0, -1.75)).toBeGreaterThan(0.2); // spoil heaped ahead of the lip
  });

  it('cuts through layers in order and reports materials', () => {
    const core = flat(CLAY, 2);
    for (let c = 0; c < core.n; c++) core.addTop(c, TOPSOIL, 0.3);
    const r = core.cut({ p0: rect(0, -0.5, 0), p1: rect(0, -0.5, 0), capacity: 1e9 });
    expect(r.taken[CLAY]).toBe(0); // dug clay comes out as loose spoil
    expect(r.taken[TOPSOIL] / r.taken[SPOIL]).toBeCloseTo(0.3 / 0.5, 1);
    expect(r.resist).toBeCloseTo(r.taken[TOPSOIL] * 1.0 + r.taken[SPOIL] * 1.8, 5);
  });

  it('is deterministic and sleeps when nothing moves', () => {
    const run = () => {
      const core = new TerrainCore(MAPS.test.cfg); MAPS.test.build(core);
      for (let k = 0; k < 60; k++) core.step([{ k: 'cut', id: 1, p0: rect(5, 0.2, -2 - k * 0.05), p1: rect(5, 0.2, -2.05 - k * 0.05), capacity: 0.01 }, { k: 'deposit', x: -2, z: 2, m: GRAVEL, v: 0.02 }]);
      settle(core);
      return core;
    };
    const a = run(), b = run();
    expect(Buffer.compare(Buffer.from(a.h.buffer), Buffer.from(b.h.buffer))).toBe(0);
    expect(a.qLen).toBe(0);
    a.relax(); expect(a.awakeChunks).toBe(0);
  });

  it('builds the full map with stable banks', () => {
    const core = new TerrainCore(MAPS.dirttown.cfg); MAPS.dirttown.build(core);
    expect(core.heightAt(0, -45)).toBeGreaterThan(8.5);
    expect(core.heightAt(0, 20)).toBeLessThan(-0.7);
    for (let c = 0; c < core.n; c++) core.wake(c);
    const v0 = core.audit().total;
    let moved = 0; for (let k = 0; k < 40; k++) moved += core.relax(core.n);
    expect(moved).toBeLessThan(25); // banks and stockpile barely creep
    expect(core.audit().total).toBeCloseTo(v0, 0);
  });
});

describe('ContainerField + Clods', () => {
  const bucket = () => new ContainerField({ nx: 12, nz: 6, cs: 0.2, capacity: 2, walls: { zn: 0 } }); // lip at -z
  it('holds a load when level and pours over the lip when tipped', () => {
    const b = bucket(); b.add(SAND, 0.8);
    let out = 0; const emit = (lx, ly, lz, dx, dz, m, v) => { out += v; expect(dz).toBe(-1); };
    for (let k = 0; k < 200; k++) b.relax([0, 1, 0], emit);
    expect(out).toBeLessThan(0.25); // some rolls off the open lip until it sits at repose
    const kept = b.volume();
    for (let k = 0; k < 600; k++) b.relax([0, Math.cos(1.0), Math.sin(1.0)], emit); // nose down ~57°
    expect(b.volume()).toBeLessThan(0.02);
    expect(out + b.volume()).toBeCloseTo(0.8, 4);
    expect(kept).toBeGreaterThan(0.5);
  });
  it('dumps everything when inverted', () => {
    const b = bucket(); b.add(GRAVEL, 0.5);
    let out = 0; b.relax([0, -1, 0], (...a) => { out += a[6]; });
    expect(out).toBeCloseTo(0.5, 5); expect(b.volume()).toBe(0);
  });
  it('clods carry volume from one heightfield to another', () => {
    const core = new TerrainCore({ nx: 64, nz: 64, cell: 0.25, ox: -8, oz: -8 });
    for (let c = 0; c < core.n; c++) core.setColumn(c, -1, [[CLAY, 1]]);
    const bed = new ContainerField({ nx: 10, nz: 10, cs: 0.2, capacity: 5, walls: {} });
    // bed floor 1 m above ground at (3, 3): inverse of a pure translation
    const inv = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -3, -1, -3, 1];
    const clods = new Clods({ rng: makeRng(7), max: 200 });
    clods.setTargets(core, [{ field: bed, inv }]);
    const v0 = core.audit().total;
    for (let k = 0; k < 150; k++) clods.pour('a', 3, 3, 3, 0, 1, 0, SAND, 0.01, 0.3);   // over the bed
    for (let k = 0; k < 150; k++) clods.pour('b', -3, 2, -3, 0, 1, 0, GRAVEL, 0.01, 0.3); // over open ground
    for (let k = 0; k < 400; k++) { clods.update(1 / 60); core.relax(); }
    expect(clods.count).toBe(0);
    const total = core.audit().total + bed.volume() + clods.airborne();
    expect(total).toBeCloseTo(v0 + 3.0, 4);
    expect(bed.volume()).toBeGreaterThan(1.3);
    expect(core.audit().byMat[GRAVEL]).toBeGreaterThan(1.4);
  });
});

describe('bog', () => {
  it('a wheel sinks into bog by squeezing it aside: deep rut, ridges, no volume lost', async () => {
    const { TerrainCore } = await import('../src/terrain/core.js'); const { MAPS } = await import('../src/terrain/maps.js'); const { BOG } = await import('../src/terrain/materials.js');
    const core = new TerrainCore(MAPS.test.cfg); MAPS.test.build(core);
    const v0 = core.audit().total, h0 = core.heightAt(14, -14);
    expect(core.topMat(core.cellAt ? core.cellAt(14, -14) : Math.round((-14 + 20) / 0.25) * 160 + Math.round((14 + 20) / 0.25))).toBe(BOG);
    for (let k = 0; k < 120; k++) { core.compact(14, -14, 0.3, 1); core.step([]); }
    const rut = h0 - core.heightAt(14, -14), a = core.audit();
    expect(rut).toBeGreaterThan(0.2); expect(rut).toBeLessThan(1.05);
    expect(Math.abs(a.total - v0) / v0).toBeLessThan(1e-6); expect(a.compacted).toBe(0);   // squeezed aside, not compressed away
    // topsoil under the same wheel only ruts a few centimetres
    const t0 = core.heightAt(10, 10); for (let k = 0; k < 120; k++) { core.compact(10, 10, 0.3, 1); core.step([]); }
    expect(t0 - core.heightAt(10, 10)).toBeLessThan(0.08);
    // left alone, the mud slowly slumps back into the rut
    for (let k = 0; k < 600; k++) core.step([]);
    expect(h0 - core.heightAt(14, -14)).toBeLessThan(rut * 0.95);
  });
});

describe('saving only the worked ground', () => {
  const fresh = () => { const c = new TerrainCore(MAPS.test.cfg); MAPS.test.build(c); c.collectDirty(); return c; };
  const work = (c) => { for (let i = 0; i < 40; i++) c.deposit(3 + (i % 5) * 0.2, -4, SAND, 0.05); for (let k = 0; k < 120; k++) c.step([]); c.collectDirty(); };
  it('a snapshot holds only the chunks changed since the map was built', () => {
    const c = fresh(); expect(c.snapshot().ids.length).toBe(0);
    work(c); const s = c.snapshot();
    expect(s.ids.length).toBeGreaterThan(0); expect(s.ids.length).toBeLessThan(6);
    expect(s.bed.length).toBe(s.ids.length * 32 * 32);
  });
  it('put back on a freshly built map, it gives the same ground and the same volume', () => {
    const a = fresh(); work(a); const s = a.snapshot(), b = fresh();
    expect(b.restore(s)).toBe(true);
    let worst = 0; for (let i = 0; i < a.n; i++) worst = Math.max(worst, Math.abs(a.h[i] - b.h[i]));
    expect(worst).toBeLessThan(1e-5); // (heights are recomputed from the layers: float rounding)
    expect(b.audit().total).toBeCloseTo(a.audit().total, 6);
    expect(b.snapshot().ids).toEqual(s.ids); // and saving again keeps the same chunks
  });
  it('put back on ground already worked, the map is rebuilt first so nothing of the other work is left', () => {
    const a = fresh(); work(a); const s = a.snapshot(), b = fresh();
    for (let i = 0; i < 30; i++) b.deposit(-6, 8, GRAVEL, 0.05); for (let k = 0; k < 60; k++) b.step([]); b.collectDirty();
    expect(b.restore(s)).toBe(false); // without a way to rebuild it, it refuses
    expect(b.restore(s, () => MAPS.test.build(b))).toBe(true);
    expect(Math.abs(b.heightAt(-6, 8) - fresh().heightAt(-6, 8))).toBeLessThan(1e-6);
    expect(Math.abs(b.heightAt(3.4, -4) - a.heightAt(3.4, -4))).toBeLessThan(1e-6);
  });
});

describe('the valley', () => {
  it('has today\'s map unchanged in its middle, joined without a step, and its features where the layout puts them', async () => {
    const { FEATURES } = await import('../src/terrain/valley.js');
    const v = new TerrainCore(MAPS.valley.cfg); MAPS.valley.build(v);
    const d = new TerrainCore(MAPS.dirttown.cfg); MAPS.dirttown.build(d);
    let worst = 0; for (let z = -60; z < 60; z += 0.25) for (let x = -60; x < 60; x += 0.25) worst = Math.max(worst, Math.abs(v.heightAt(x, z) - d.heightAt(x, z)));
    expect(worst).toBeLessThan(1e-4);
    let seam = 0; // the step across the square's edge is no worse than the slope either side of it
    for (let t = -59; t < 59; t += 0.5) for (const [a, b] of [[[-60.25, t], [-60, t]], [[59.75, t], [60, t]], [[t, -60.25], [t, -60]], [[t, 59.75], [t, 60]]]) seam = Math.max(seam, Math.abs(v.heightAt(...a) - v.heightAt(...b)));
    expect(seam).toBeLessThan(0.25);
    expect(FEATURES.map((f) => f.name)).toEqual(expect.arrayContaining(['stream', 'road in', 'old quarry', 'old tip', 'silted pond', 'spoil heaps']));
    expect(v.heightAt(0, -177)).toBeGreaterThan(25);           // the hills at the head
    expect(v.topMat(v.cellAt(-84, -95))).toBe(6);                // the quarry floor is rock
    expect(v.topMat(v.cellAt(90, -103))).toBe(MUD);              // the road in is a rutted mud track
    // the stream's bed never runs uphill, from the spring to the river
    let up = 0, prev = Infinity; const P = [[-50, -150], [-50, -136], [-62, -112], [-72, -96], [-72, -60], [-72, 0], [-72, 22]];
    for (let k = 0; k < P.length - 1; k++) for (let t = 0; t < 1; t += 0.05) { const h = v.heightAt(P[k][0] + (P[k + 1][0] - P[k][0]) * t, P[k][1] + (P[k + 1][1] - P[k][1]) * t); up = Math.max(up, h - prev); prev = h; }
    expect(up).toBeLessThan(0.05);
  }, 60000);
});

describe('rock', () => {
  const ROCKY = { cfg: { nx: 64, nz: 64, cell: 0.25, ox: -8, oz: -8 }, build(core) { for (let c = 0; c < 64 * 64; c++) core.setColumn(c, -3, [[6, 2], [CLAY, 0.4]]); } }; // 2 m of rock under 0.4 m of clay; ground at -0.6
  const rect = (y, x0 = -1, x1 = 1, z0 = -1, z1 = 1) => [x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z0];
  const make = () => { const c = new TerrainCore(ROCKY.cfg); ROCKY.build(c); return c; };
  it('a bucket or blade takes only what lies on the rock, and meets it hard', () => {
    const c = make(), v0 = c.audit().total, r = c.cut({ p0: rect(-1.4), p1: rect(-1.4), capacity: 99 });
    const took = r.taken.reduce((a, b) => a + b, 0);
    expect(Math.abs(c.heightAt(0, 0) - -1.0)).toBeLessThan(1e-3);   // down to the rock's top, not to the edge 0.4 m below it
    expect(took).toBeCloseTo(0.4 * 81 * 0.0625, 3);                  // the clay over the 9 × 9 cells it covers
    expect(r.resist).toBeGreaterThan(took * 20);                     // and it felt the rock
    expect(Math.abs(c.audit().total + took - v0)).toBeLessThan(1e-6);
  });
  it('a ripper breaks rock into shot rock where it lies; then it digs', () => {
    const c = make(), v0 = c.audit().total;
    c.cut({ p0: rect(-1.4), p1: rect(-1.4), capacity: 99 });         // clear the clay off first
    const after = c.audit().total;
    const r = c.cut({ p0: rect(-1.35, -0.15, 0.15), p1: rect(-1.35, -0.15, 0.15), rip: true }); // a tooth 0.35 m into the rock
    expect(r.taken.reduce((a, b) => a + b, 0)).toBe(0);                // it takes nothing
    expect(c.topMat(c.cellAt(0, 0))).toBe(9);                          // shot rock where it went
    expect(c.topMat(c.cellAt(0.8, 0))).toBe(6);                        // solid rock beside its line
    expect(Math.abs(c.audit().total - after)).toBeLessThan(1e-6);     // nothing made or lost: the same volume, broken
    const d = c.cut({ p0: rect(-1.6, -0.15, 0.15), p1: rect(-1.6, -0.15, 0.15), capacity: 99 });
    expect(d.taken[9]).toBeGreaterThan(0.05);                          // a bucket takes the shot rock now
    expect(Math.abs(c.heightAt(0, 0) - -1.35)).toBeLessThan(1e-3);     // down to where the tooth broke it, no deeper
    void v0;
  });
});
