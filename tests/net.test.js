import { describe, it, expect } from 'vitest';
import { TerrainDeltaWriter, applyTerrainDelta, encodeWater, decodeWater } from '../src/net/terrainDelta.js';
import { SnapshotBuffer, nlerpQuat } from '../src/net/snapshot.js';
import { TerrainClient } from '../src/terrain/client.js';
import { SAND } from '../src/terrain/materials.js';

const mirrorOf = (t) => ({ nx: t.nx, nz: t.nz, h: t.h.slice(), info: t.info.slice() });
const maxErr = (a, b) => { let e = 0; for (let i = 0; i < a.h.length; i++) e = Math.max(e, Math.abs(a.h[i] - b.h[i])); return e; };
const rect = (x, y, z) => [x - 1, y, z + 0.5, x + 1, y, z + 0.5, x - 1, y, z - 0.5, x + 1, y, z - 0.5];

describe('terrain replication', () => {
  it('sends only what changed, and the client ends up within a centimetre', async () => {
    const host = await new TerrainClient({ map: 'test', mode: 'inline' }).init();
    const client = mirrorOf(host);                         // a client builds the same starting map
    const w = new TerrainDeltaWriter(host); host.onChunks((c) => w.markChunks(c));
    expect(w.delta()).toBe(null);
    let bytes = 0, sends = 0;
    for (let k = 0; k < 120; k++) {
      host.cut('t', rect(5, 0.3, -2 - k * 0.05), rect(5, 0.3, -2.05 - k * 0.05), 0.02); host.deposit(-3, 3, SAND, 0.02); host.tick();
      if (k % 6 === 5) { const d = w.delta(); if (d) { bytes += d.length; sends++; applyTerrainDelta(client, d); } }
    }
    for (let k = 0; k < 200; k++) host.tick();
    const d = w.delta(); if (d) { bytes += d.length; applyTerrainDelta(client, d); }
    expect(maxErr(host, client)).toBeLessThanOrEqual(0.0051);
    expect(client.info[host.cellAt(-3, 3) * 4]).toBe(SAND);
    expect(sends).toBeGreaterThan(10);
    expect(bytes / sends).toBeLessThan(6000);              // a few KB per send, against 100 KB for the whole map
  });

  it('brings a latecomer up to date from the starting map', async () => {
    const host = await new TerrainClient({ map: 'test', mode: 'inline' }).init();
    const late = mirrorOf(host), w = new TerrainDeltaWriter(host); host.onChunks((c) => w.markChunks(c));
    for (let k = 0; k < 60; k++) { host.deposit(2, 2, SAND, 0.05); host.tick(); }
    w.delta();                                             // already sent to the players who were there
    const full = w.full(); applyTerrainDelta(late, full);
    expect(maxErr(host, late)).toBeLessThanOrEqual(0.0051);
    expect(full.length).toBeLessThan(20000);
    for (let k = 0; k < 20; k++) { host.deposit(-2, -2, SAND, 0.05); host.tick(); }
    applyTerrainDelta(late, w.delta());                    // and ordinary deltas keep working after it
    expect(maxErr(host, late)).toBeLessThanOrEqual(0.0051);
  });

  it('packs the river into a small message', () => {
    const n = 240 * 52, w = { nx: 240, nz: 52, depth: new Float32Array(n), vx: new Float32Array(n), vz: new Float32Array(n) };
    for (let j = 18; j < 34; j++) for (let i = 0; i < 240; i++) { const k = j * 240 + i; w.depth[k] = 0.3 + (j % 5) * 0.2; w.vx[k] = 0.6 - i * 0.001; w.vz[k] = -0.05; }
    const b = encodeWater(w), out = decodeWater(b, { nx: 240, nz: 52, depth: new Float32Array(n), vx: new Float32Array(n), vz: new Float32Array(n) });
    expect(b.length).toBeLessThan(n * 3 * 0.4);
    for (const k of [0, 18 * 240, 20 * 240 + 100, 33 * 240 + 239, n - 1]) { expect(out.depth[k]).toBeCloseTo(w.depth[k], 2); expect(out.vx[k]).toBeCloseTo(w.vx[k], 1); expect(out.vz[k]).toBeCloseTo(w.vz[k], 1); }
  });
});

describe('snapshot interpolation', () => {
  it('renders 0.12 s behind the host and blends between states', () => {
    const b = new SnapshotBuffer();
    for (let i = 0; i <= 10; i++) b.push(100 + i * 0.05, 5 + i * 0.05, { x: [i] }); // host clock is 95 s ahead; one state every 50 ms
    const r = b.bracket(5.5);                               // host time 100.5 − 0.12 = 100.38 → between states 7 and 8
    expect(r.a.x[0]).toBe(7); expect(r.b.x[0]).toBe(8); expect(r.k).toBeCloseTo(0.6, 5);
    expect(b.bracket(99).k).toBe(0);                        // far past the newest: hold the last state
    expect(b.bracket(99).a.x[0]).toBe(10);
  });
  it('blends quaternions the short way round', () => {
    const out = nlerpQuat([0, 0, 0, 1], [0, -0.0998, 0, -0.995], 0.5, [0, 0, 0, 0]);
    expect(out[1]).toBeCloseTo(0.05, 2); expect(out[3]).toBeCloseTo(0.9987, 3);
  });
});
