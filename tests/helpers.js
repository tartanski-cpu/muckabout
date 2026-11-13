// Shared rig for machine tests: one machine on inline terrain with clods and containers stepped as the game does.
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
