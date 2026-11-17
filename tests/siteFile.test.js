import { describe, it, expect } from 'vitest';
import { encodeSite, decodeSite } from '../src/game/siteFile.js';
import { TerrainCore } from '../src/terrain/core.js';
import { MAPS } from '../src/terrain/maps.js';
import { SAND } from '../src/terrain/materials.js';

describe('site files', () => {
  it('carry a saved site, typed arrays and all, and are small', async () => {
    const c = new TerrainCore(MAPS.test.cfg); MAPS.test.build(c); c.collectDirty();
    for (let i = 0; i < 40; i++) c.deposit(3, -4, SAND, 0.05); for (let k = 0; k < 60; k++) c.step([]);
    const site = { version: 1, map: 'test', when: 123, terrain: c.snapshot(), machines: [{ id: 'loader', fn: [0.1, -0.2] }], rigs: [{ fill: new Float32Array([0.5, 1]), mat: new Uint8Array([4, 4]) }] };
    const bytes = await encodeSite(site, 'Family');
    expect(bytes.length).toBeLessThan(200_000);
    const back = await decodeSite(bytes);
    expect(back.name).toBe('Family');
    expect(back.site.terrain.lt).toBeInstanceOf(Float32Array);
    expect(Array.from(back.site.terrain.lt)).toEqual(Array.from(site.terrain.lt));
    expect(Array.from(back.site.terrain.ids)).toEqual(Array.from(site.terrain.ids));
    expect(back.site.rigs[0].mat).toBeInstanceOf(Uint8Array);
    expect(back.site.machines[0].fn).toEqual([0.1, -0.2]);
    const d = new TerrainCore(MAPS.test.cfg); MAPS.test.build(d); d.collectDirty();
    expect(d.restore(back.site.terrain)).toBe(true);
    expect(Math.abs(d.heightAt(3, -4) - c.heightAt(3, -4))).toBeLessThan(1e-5);
  });
  it('refuse anything else, plainly', async () => {
    await expect(decodeSite(new TextEncoder().encode('hello'))).rejects.toThrow('not a Muck About site file');
  });
});
