// Main-thread face of the terrain: queues commands, steps the core (in a worker, or inline for tests and
// fast-forward), and keeps a mirror of surface heights + per-cell info for queries and rendering.
import { TerrainCore, CHUNK } from './core.js';
import { MAPS } from './maps.js';
import { MATERIALS, ROCK } from './materials.js';
import { applyTerrainDelta, decodeWater } from '../net/terrainDelta.js';

export class TerrainClient {
  /** @param {{map:string, mode?:'inline'|'worker', water?:boolean}} o */
  constructor(o) {
    this.map = MAPS[o.map]; this.mapName = o.map; this.mode = o.mode || 'inline';
    const cfg = this.cfg = this.map.cfg;
    this.nx = cfg.nx; this.nz = cfg.nz; this.cell = cfg.cell; this.ox = cfg.ox; this.oz = cfg.oz;
    this.h = new Float32Array(cfg.nx * cfg.nz); this.info = new Uint8Array(cfg.nx * cfg.nz * 4);
    this.cmds = []; this.results = new Map(); this.listeners = [];
    this.stats = { ms: 0, awake: 0, queue: 0 }; this.pending = 0; this.tickNo = 0;
    this.water = null; this.waterListeners = [];
    this._audits = new Map(); this._auditId = 0;
    this.wantWater = !!o.water;
  }

  async init() {
    if (this.mode === 'remote') { // co-op client: the host owns the terrain; build the same starting map, then only apply its deltas
      const core = new TerrainCore(this.cfg); this.map.build(core);
      if (this.wantWater) { const w = await import('./water.js'); const wat = w.attachWater(core, this.map); core.collectDirty(); core.markAllDirty(); this._apply({ n: 0, results: [], chunks: core.collectDirty(), water: wat ? { ...wat.pack0() } : null, stats: this.stats }); }
      else this._apply({ n: 0, results: [], chunks: core.collectDirty(), water: null, stats: this.stats });
      return this;
    }
    if (this.mode === 'worker') {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      await new Promise((res) => {
        this.worker.onmessage = (e) => { if (e.data.t === 'ready') res(); };
        this.worker.postMessage({ t: 'init', map: this.mapName, ext: this.wantWater });
      });
      this.worker.onmessage = (e) => this._onMessage(e.data);
    } else {
      this.core = new TerrainCore(this.cfg); this.map.build(this.core);
      if (this.wantWater) { const w = await import('./water.js'); w.attachWater(this.core, this.map); }
    }
    this.tick(); // first tick delivers every chunk
    if (this.mode === 'worker') await new Promise((res) => { this._firstTick = res; });
    return this;
  }

  // ---- commands (applied on the next tick)
  cut(id, p0, p1, capacity, ahead) { this.cmds.push({ k: 'cut', id, p0: Array.from(p0), p1: Array.from(p1), capacity, ahead }); }
  deposit(x, z, m, v) { this.cmds.push({ k: 'deposit', x, z, m, v }); this.queuedDep += v; }
  compact(x, z, r, load) { this.cmds.push({ k: 'compact', x, z, r, load }); }
  command(cmd) { this.cmds.push(cmd); }
  queuedDep = 0; sentDep = new Map(); // deposit volume queued / sent but not yet applied by the core
  /** Volume that is neither in the ground nor anywhere on the main thread right now (audit term). */
  get inFlight() {
    let s = this.queuedDep; for (const v of this.sentDep.values()) s += v;
    for (const r of this.results.values()) for (let m = 0; m < r.taken.length; m++) s += r.taken[m]; // dug but not yet claimed by its tool
    return s;
  }

  /** Advance the terrain one fixed step. */
  tick() {
    if (this.mode === 'remote') { this.cmds.length = 0; this.queuedDep = 0; return; }
    const cmds = this.cmds; this.cmds = [];
    const n = ++this.tickNo;
    if (this.queuedDep > 0) { this.sentDep.set(n, this.queuedDep); this.queuedDep = 0; }
    if (this.mode === 'worker') {
      this.pending++;
      this.worker.postMessage({ t: 'tick', n, cmds });
    } else {
      const t0 = performance.now();
      const results = this.core.step(cmds);
      const chunks = this.core.collectDirty();
      this._apply({ n, results, chunks, water: this.core.water ? this.core.water.pack() : null,
        stats: { ms: performance.now() - t0, awake: this.core.awakeChunks, queue: this.core.qLen } });
    }
  }
  _onMessage(m) {
    if (m.t === 'tick') { this.pending--; this._apply(m); if (this._firstTick) { this._firstTick(); this._firstTick = null; } }
    else if (m.t === 'audit') { this._audits.get(m.id)?.(m.audit); this._audits.delete(m.id); }
  }
  _apply(m) {
    this.stats = m.stats;
    this.sentDep.delete(m.n);
    for (const r of m.results) { // a second result for the same tool before the first was claimed: merge, never drop
      const old = this.results.get(r.id);
      if (old) { for (let q = 0; q < r.taken.length; q++) r.taken[q] += old.taken[q]; r.pushed += old.pushed; r.resist += old.resist; }
      this.results.set(r.id, r);
    }
    const { nx, nz } = this;
    for (const ch of m.chunks) {
      const ci = ch.id % Math.ceil(nx / CHUNK), cj = (ch.id / Math.ceil(nx / CHUNK)) | 0;
      for (let j = 0; j < CHUNK; j++) {
        const gj = cj * CHUNK + j; if (gj >= nz) break;
        const w = Math.min(CHUNK, nx - ci * CHUNK), dst = gj * nx + ci * CHUNK;
        this.h.set(ch.h.subarray(j * CHUNK, j * CHUNK + w), dst);
        this.info.set(ch.info.subarray(j * CHUNK * 4, (j * CHUNK + w) * 4), dst * 4);
      }
    }
    if (m.chunks.length) for (const l of this.listeners) l(m.chunks);
    if (m.water) { this.water = m.water; for (const l of this.waterListeners) l(m.water); }
  }
  /** Co-op client: apply a terrain delta / water message from the host. */
  applyRemote(bytes) { const chunks = applyTerrainDelta(this, bytes); if (chunks.length) for (const l of this.listeners) l(chunks); }
  applyRemoteWater(bytes) {
    const w = this.water; if (!w) return;
    decodeWater(bytes, w);
    const k = Math.round(w.cell / this.cell), j0 = Math.round((w.oz - this.oz) / w.cell), h = this.h, nx = this.nx; // bed from our own copy of the ground
    for (let j = 0; j < w.nz; j++) for (let i = 0; i < w.nx; i++) { const t = (j0 + j) * k * nx + i * k; w.bed[j * w.nx + i] = (h[t] + h[t + 1] + h[t + nx] + h[t + nx + 1]) * 0.25; }
    for (const l of this.waterListeners) l(w);
  }
  /** Take (and clear) the latest result for a cut id. */
  takeResult(id) { const r = this.results.get(id); if (r) this.results.delete(id); return r; }
  onChunks(fn) { this.listeners.push(fn); }
  onWater(fn) { this.waterListeners.push(fn); }

  audit() {
    if (this.mode === 'remote') return Promise.resolve({ ground: 0, byMat: [], lost: 0, compacted: 0, washed: 0, total: 0 });
    if (this.mode !== 'worker') return Promise.resolve(this.core.audit());
    return new Promise((res) => { const id = ++this._auditId; this._audits.set(id, res); this.worker.postMessage({ t: 'audit', id }); });
  }

  // ---- queries against the mirror
  heightAt(x, z) {
    let fi = (x - this.ox) / this.cell, fj = (z - this.oz) / this.cell;
    fi = fi < 0 ? 0 : fi > this.nx - 1.001 ? this.nx - 1.001 : fi; fj = fj < 0 ? 0 : fj > this.nz - 1.001 ? this.nz - 1.001 : fj;
    const i = fi | 0, j = fj | 0, tx = fi - i, tz = fj - j, c = j * this.nx + i, h = this.h;
    return (h[c] * (1 - tx) + h[c + 1] * tx) * (1 - tz) + (h[c + this.nx] * (1 - tx) + h[c + this.nx + 1] * tx) * tz;
  }
  /** Surface normal (unnormalised y = 1 form) into out[3]. */
  normalAt(x, z, out) {
    const e = this.cell, dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e), dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz); out[0] = -dx / l; out[1] = 1 / l; out[2] = -dz / l; return out;
  }
  cellAt(x, z) {
    const i = Math.round((x - this.ox) / this.cell), j = Math.round((z - this.oz) / this.cell);
    return i < 0 || j < 0 || i >= this.nx || j >= this.nz ? -1 : j * this.nx + i;
  }
  materialAt(x, z) { const c = this.cellAt(x, z); return c < 0 ? ROCK : this.info[c * 4]; }
  gripAt(x, z) {
    const c = this.cellAt(x, z); if (c < 0) return 0.8;
    const g = MATERIALS[this.info[c * 4]].grip;
    return this.info[c * 4 + 2] ? g * 0.75 : g; // wet ground is slicker
  }
  /** Water depth (m) at a world position; 0 where there is no water grid. */
  waterDepthAt(x, z) {
    const w = this.water; if (!w) return 0;
    const i = Math.floor((x - w.ox) / w.cell), j = Math.floor((z - w.oz) / w.cell);
    return i < 0 || j < 0 || i >= w.nx || j >= w.nz ? 0 : w.depth[j * w.nx + i];
  }
}
