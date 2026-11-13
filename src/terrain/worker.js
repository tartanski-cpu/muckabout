// Worker shell around TerrainCore. Protocol in docs/terrain-design.md.
import { TerrainCore } from './core.js';
import { MAPS } from './maps.js';

let core = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') {
    core = new TerrainCore(MAPS[m.map].cfg); MAPS[m.map].build(core);
    if (m.ext) import('./water.js').then((w) => { w.attachWater(core, MAPS[m.map]); reply({ t: 'ready' }); });
    else reply({ t: 'ready' });
  } else if (m.t === 'tick') {
    const t0 = performance.now();
    const results = core.step(m.cmds);
    const chunks = core.collectDirty();
    const ms = performance.now() - t0;
    reply({ t: 'tick', n: m.n, results, chunks, water: core.water ? core.water.pack() : null,
      stats: { ms, awake: core.awakeChunks, queue: core.qLen } }, chunks.flatMap((c) => [c.h.buffer, c.info.buffer]));
  } else if (m.t === 'audit') reply({ t: 'audit', id: m.id, audit: core.audit() });
};
function reply(msg, transfer) { self.postMessage(msg, transfer || []); }
