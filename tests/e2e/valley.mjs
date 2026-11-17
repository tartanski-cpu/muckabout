// The valley (docs/valley-layout.md, terrain/valley.js): today's map unchanged in the middle, the features round it,
// water running where the map says, the backdrop following its edges, and the Quest's budgets held.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?map=valley&worker=0');
  await page.waitForFunction(() => __game.machines?.length === 4 && __game.terrain.water, null, { timeout: 240000, polling: 300 });
  const g = await page.evaluate(() => {
    const T = __game.terrain, M = __game.terrain.map, at = (x, z) => T.heightAt(x, z);
    return { cfg: M.cfg, yard: at(0, -45), north: at(0, -177), quarryMat: T.materialAt(-84, -95), quarryFloor: at(-84, -95), padHeap: at(7.8, -35), features: M.features.map((f) => f.name) };
  });
  check(g.cfg.nx * g.cfg.cell === 192 && g.cfg.nz * g.cfg.cell === 288, `the valley is 192 × 288 m (${g.features.length} named features: ${g.features.join(', ')})`);
  check(Math.abs(g.yard - 9) < 0.15 && g.north > 25, `the yard is at ${g.yard.toFixed(1)} m and the head of the valley rises to ${g.north.toFixed(1)} m`);
  check(g.quarryMat === 6 && Math.abs(g.quarryFloor - 10.5) < 0.3, `the old quarry's floor is bare rock at ${g.quarryFloor.toFixed(1)} m`);
  // (today's map unchanged in the middle is checked cell by cell in tests/terrain.test.js)
  // water: the stream runs down the west side, the gully down the east, the silted pond holds water, the river flows
  await page.evaluate(() => { __game.paused = true; __game.sim(60 * 30); });
  const w = await page.evaluate(() => {
    const T = __game.terrain, deep = (x, z) => { let m = 0; for (let dx = -3; dx <= 3; dx += 0.5) m = Math.max(m, T.waterDepthAt(x + dx, z)); return m; };
    return { stream: [[-50, -140], [-62, -112], [-72, -80], [-72, -40], [-72, -10]].map(([x, z]) => deep(x, z)), gully: [[82, -104], [78, -60]].map(([x, z]) => deep(x, z)), pond: T.waterDepthAt(-66, 88), river: T.waterDepthAt(0, 20), tiles: T.water.wet.size, of: Math.ceil(T.water.nx / 16) * Math.ceil(T.water.nz / 16) };
  });
  check(w.stream.every((d) => d > 0.015), `the stream runs from its spring to the river (${w.stream.map((d) => (d * 100).toFixed(0)).join(', ')} cm deep down its course)`);
  check(w.gully.every((d) => d > 0.005), `the gully carries a trickle across the road in (${w.gully.map((d) => (d * 100).toFixed(1)).join(', ')} cm)`);
  check(w.pond > 0.15 && w.river > 0.5, `the silted pond holds water (${w.pond.toFixed(2)} m) and the river runs (${w.river.toFixed(2)} m)`);
  check(w.tiles < w.of / 4, `water is worked only where it is: ${w.tiles} of ${w.of} patches`);
  // budgets, at the Quest tier (the harness default), from the yard and from high over the south
  const views = [];
  for (const [from, to] of [[[0, 11, -52], [0, 8, -20]], [[0, 25, 30], [-40, 2, 85]], [[-20, 40, -60], [-50, 14, -150]]]) {
    await page.evaluate(([from, to]) => { __game.paused = false; __game.play.overview = { from, to }; }, [from, to]);
    await page.waitForTimeout(2500);
    views.push(await page.evaluate(() => Object.fromEntries(__game.perf.snapshot().counters.map((x) => [x.name, x.value]))));
  }
  await page.screenshot({ path: 'shots/valley_test.png' });
  check(views.every((v) => v.calls <= 150 && v.tris <= 400000), `within the Quest's budgets from three viewpoints (${views.map((v) => `${v.calls} calls, ${Math.round(v.tris / 1000)}k tris`).join('; ')})`);
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
