// Terrain engine v2 in the browser: the ghost-bucket stress scene, inline (deterministic, audited) and in a worker.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  // --- inline terrain: fast-forward and audit
  let page = await open('?worker=0&scene=stress');
  await page.evaluate(() => { __game.paused = true; });
  const a0 = await page.evaluate(() => __game.audit());
  const ms = await page.evaluate(() => { const t = performance.now(); __game.sim(1500); return (performance.now() - t) / 1500; });
  const mid = await page.evaluate(() => ({ clods: __game.clods.count, awake: __game.terrain.stats.awake, taken: __game.scene_.ghosts.map((g) => +g.taken.toFixed(2)) }));
  await page.evaluate(() => { __game.paused = false; }); await page.waitForTimeout(700);
  await page.screenshot({ path: 'shots/terrain_stress.png' });
  const perf = await page.evaluate(() => __game.perf.snapshot());
  await page.evaluate(() => { __game.paused = true; __game.scene_.setFountain(false); });
  const a1 = await page.evaluate(() => __game.audit());
  console.log(`stress: ${ms.toFixed(3)} ms/step, ${mid.clods} clods, ${mid.awake} awake chunks, ghost buckets dug ${mid.taken.join(' / ')} m³`);
  console.log('calls', perf.counters.find((c) => c.name === 'calls').value, 'tris', perf.counters.find((c) => c.name === 'tris').value);
  check(mid.clods > 1300, `clod budget in use (${mid.clods})`);
  check(mid.taken.every((t) => t > 2), 'every ghost bucket dug and carried soil');
  const drift = Math.abs(a1.total - a0.total) / a0.total;
  check(drift < 1e-3, `volume conserved: ${a0.total.toFixed(2)} -> ${a1.total.toFixed(2)} m³ (${(drift * 100).toExponential(1)} %), containers ${a1.containers.toFixed(2)}, airborne ${a1.airborne.toFixed(2)}`);
  check(perf.counters.find((c) => c.name === 'calls').value <= 150, 'draw calls within budget');
  check(page.errs.length === 0, 'no page errors (inline)' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
  await page.close();

  // --- worker terrain: realtime
  page = await open('?worker=1&scene=stress');
  await page.waitForTimeout(5000);
  const w = await page.evaluate(() => ({ mode: __game.terrain.mode, tick: __game.terrain.tickNo, pending: __game.terrain.pending, stats: __game.terrain.stats, clods: __game.clods.count, h: __game.terrain.heightAt(5, -8) }));
  console.log('worker:', JSON.stringify(w));
  check(w.mode === 'worker' && w.tick > 30 && w.pending < 10, `worker terrain ticking (${w.tick} ticks, ${w.pending} pending, ${w.stats.ms.toFixed(2)} ms/tick)`);
  check(w.clods > 100, 'clods flying with worker terrain');
  const a2 = await page.evaluate(async () => { __game.paused = true; await new Promise((r) => setTimeout(r, 300)); return __game.audit(); });
  const drift2 = Math.abs(a2.total - a0.total) / a0.total;
  check(drift2 < 1e-3, `volume conserved with worker: ${a2.total.toFixed(2)} m³ (${(drift2 * 100).toExponential(1)} %)`);
  check(page.errs.length === 0, 'no page errors (worker)' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
