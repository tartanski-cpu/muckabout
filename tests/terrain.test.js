import { describe, it, expect } from 'vitest';
import { TerrainCore } from '../src/terrain/core.js';
import { MAPS } from '../src/terrain/maps.js';
import { MATERIALS, SAND, CLAY, GRAVEL, MUD, TOPSOIL, NMAT } from '../src/terrain/materials.js';
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
    expect(r.taken[TOPSOIL] / r.taken[CLAY]).toBeCloseTo(0.3 / 0.5, 1);
    expect(r.resist).toBeCloseTo(r.taken[TOPSOIL] * 1.0 + r.taken[CLAY] * 1.8, 5);
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
