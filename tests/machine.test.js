import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Physics } from '../src/vehicles/physics.js';
import { Machine } from '../src/vehicles/machine.js';
import { TerrainClient } from '../src/terrain/client.js';
import { Clods } from '../src/terrain/clods.js';
import { makeRng } from '../src/util/rng.js';

const def = (n) => JSON.parse(readFileSync(new URL(`../machines/${n}.json`, import.meta.url)));

export async function rig(name, at = { x: 0, z: 8 }, map = 'test') {
  const terrain = await new TerrainClient({ map, mode: 'inline' }).init();
  const phys = await Physics.create();
  const m = phys.add(new Machine(def(name), phys, terrain, { id: name, ...at }));
  const clods = new Clods({ rng: makeRng(3) }); const rigs = [...m.rigs];
  clods.setTargets(terrain, rigs);
  const inv = { elements: null };
  const step = (n = 1, fn) => {
    for (let i = 0; i < n; i++) {
      if (fn) fn(m, i);
      phys.step(1 / 60);
      for (const r of rigs) { r.object.updateWorldMatrix(true, false); r.setPose(r.object.matrixWorld.elements, r.object.matrixWorld.clone().invert().elements); r.step(1 / 60, clods); }
      clods.update(1 / 60); terrain.tick();
    }
  };
  const total = async () => (await terrain.audit()).total + rigs.reduce((s, r) => s + r.field.volume(), 0) + clods.airborne() + terrain.inFlight;
  return { terrain, phys, m, clods, step, total };
}
const start = (m) => { m.inp.key = 1; m.inp.park = 0; };

describe('wheel loader', () => {
  let r;
  beforeAll(async () => { r = await rig('loader'); });

  it('settles on its wheels and stays put with the park brake on', () => {
    r.step(180);
    const p = r.m.position;
    expect(r.m.wheels.every((w) => w.grounded)).toBe(true);
    expect(Math.abs(p.x)).toBeLessThan(0.05); expect(Math.abs(p.z - 8)).toBeLessThan(0.05);
    expect(p.y - r.terrain.heightAt(p.x, p.z)).toBeLessThan(0.08);
    expect(Math.abs(r.m.speed)).toBeLessThan(0.02);
  });

  it('starts on the key, drives forward and brakes', () => {
    start(r.m); r.step(90);
    expect(r.m.engine.running).toBe(true);
    r.m.inp.shuttle = 1; r.m.inp.accel = 1; r.step(240);
    expect(r.m.speed).toBeGreaterThan(3); expect(r.m.speed).toBeLessThan(8.5);
    const z1 = r.m.position.z; expect(z1).toBeLessThan(0);
    r.m.inp.accel = 0; r.m.inp.brake = 1; r.step(180);
    expect(Math.abs(r.m.speed)).toBeLessThan(0.05);
    r.m.inp.brake = 0;
  });

  it('steers by articulating', () => {
    r.m.reset(0, 10, 0); r.step(60);
    const h0 = r.m.heading;
    r.m.inp.steer = 1; r.m.inp.shuttle = 1; r.m.inp.accel = 0.5; r.step(300);
    let dh = r.m.heading - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    expect(dh).toBeLessThan(-0.8); // turned right (clockwise from above)
    expect(Math.abs(r.m.joints[0].target)).toBeCloseTo(0.68, 2);
    r.m.inp.steer = 0; r.m.inp.accel = 0; r.step(120);
    for (const b of r.m.bodyList) expect(b.obj.matrixWorld.elements[5]).toBeGreaterThan(0.98); // still upright
  });

  it('digs the sand heap, carries the load and tips it, conserving volume', async () => {
    r.m.reset(5, 4, 0); r.step(60);
    const v0 = await r.total();
    // bucket flat on the ground
    r.m.inp.throttle = 1;
    r.step(200, (m) => { m.inp.boom = m.fn.boom.pos > -0.66 ? -1 : 0; m.inp.bucket = m.fn.bucket.pos > 0.0 ? -1 : m.fn.bucket.pos < -0.03 ? 1 : 0; });
    r.m.inp.boom = 0; r.m.inp.bucket = 0;
    r.m.inp.shuttle = 1; r.m.inp.accel = 0.7;
    r.step(400, (m) => { if (m.payload() > 1.7) m.inp.accel = 0; });
    const got = r.m.payload();
    expect(got).toBeGreaterThan(1.2);
    r.m.inp.accel = 0; r.m.inp.bucket = 1; r.m.inp.boom = 1; r.step(150);   // curl and lift
    r.m.inp.shuttle = -1; r.m.inp.accel = 0.6; r.m.inp.bucket = 0; r.step(200);
    r.m.inp.accel = 0; r.step(60);
    const carried = r.m.payload(); console.log('dug', got.toFixed(2), 'carried', carried.toFixed(2), 'speed', r.m.speed.toFixed(2));
    expect(carried).toBeGreaterThan(got * 0.7);
    r.m.inp.bucket = -1; r.step(240);                                       // tip
    expect(r.m.payload()).toBeLessThan(0.1);
    r.step(240);
    expect(r.clods.count).toBe(0);
    expect(Math.abs(await r.total() - v0) / v0).toBeLessThan(1e-4);
  });

  it('revving speeds the hydraulics', () => {
    const time = (thr) => { r.m.fn.boom.pos = -0.4; r.m.inp.throttle = thr; r.m.inp.boom = 0; r.step(90); r.m.inp.boom = 1; let n = 0; while (r.m.fn.boom.pos < 0.6 && n < 2000) { r.step(1); n++; } r.m.inp.boom = 0; return n; };
    r.m.inp.shuttle = 0; r.m.inp.accel = 0;
    const slow = time(0), fast = time(1);
    expect(fast).toBeLessThan(slow * 0.6);
  });
});
