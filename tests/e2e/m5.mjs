// M5: the full map. River and erosion running in the worker; the checklist ticking off as the job is done;
// a dumper tipping into the hopper; and the four-machine stress scene inside its budgets.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  // --- default page: worker terrain with the river
  let page = await open('');
  await page.waitForFunction(() => __game.machines?.length === 4 && __game.terrain.water, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  const w = await page.evaluate(() => ({ mode: __game.terrain.mode, depth: __game.terrain.waterDepthAt(0, 20), dry: __game.terrain.waterDepthAt(0, 9), ms: __game.terrain.stats.ms, yard: __game.terrain.heightAt(0, -45), items: __game.play.checklist.items.map((i) => i.done) }));
  check(w.mode === 'worker' && w.depth > 0.4 && w.dry === 0, `river running in the worker (${w.depth.toFixed(2)} m deep mid-channel, ${w.ms.toFixed(2)} ms/tick)`);
  check(w.items.every((d) => !d), 'checklist starts with nothing ticked');
  await page.evaluate(() => { __game.play.overview = { from: [38, 62, -98], to: [0, 0, -8] }; }); await page.waitForTimeout(600);
  await page.screenshot({ path: 'shots/m5_map.png' });
  await page.evaluate(() => { __game.play.overview = { from: [16, 9, 6], to: [-2, 0, 21] }; }); await page.waitForTimeout(600);
  await page.screenshot({ path: 'shots/m5_river.png' });
  check(page.errs.length === 0, 'no page errors (default page)' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
  await page.close();

  // --- inline: play the job through with scripted shortcuts
  page = await open('?worker=0');
  await page.waitForFunction(() => __game.machines?.length === 4 && __game.terrain.water);
  await page.evaluate(() => { __game.paused = true; window.CL = __game.play.checklist; window.tick = (s) => { __game.sim(Math.round(s * 60)); CL.update(s); }; });
  const v0 = await page.evaluate(() => __game.audit());
  // 1. a wheeled machine reaches the river flat
  const s1 = await page.evaluate(() => { __game.machine('dumper').reset(0, 12.5, Math.PI); __game.machine('loader').reset(4, 12.5, Math.PI); tick(1); return CL.items[0].done; });
  check(s1, 'checklist: road to the river ticks when a machine gets down there');
  // 2. build the crossing: mud for bulk, gravel on top (placed directly; machines placing it is covered by M3)
  const ford = await page.evaluate(() => {
    const t = __game.terrain, fill = (top, mat) => { for (let x = -1; x <= 5; x += 0.25) for (let z = 12.5; z <= 28; z += 0.25) { const h = t.heightAt(x, z); if (h < top && h < 0.4) t.deposit(x, z, mat, (top - h) * 0.0625); } };
    fill(-0.45, 2); tick(0.5); fill(-0.1, 5); tick(1);
    const w0 = CL.fordWidth(); for (let k = 0; k < 24; k++) tick(1);
    return { w0, w1: CL.fordWidth(), done: CL.items[1].done, depth: t.waterDepthAt(2, 20) };
  });
  check(ford.done && ford.w1 >= 3, `checklist: gravel-capped crossing holds (${ford.w1.toFixed(1)} m wide after 25 s, ${ford.depth.toFixed(2)} m of water over it)`);
  // 3. drive the dumper and the loader over it
  const cross = await page.evaluate(() => {
    const { Script, driveTo, startUp, halt } = __game.autopilot, out = {};
    for (const [id, x] of [['dumper', 0.8], ['loader', 3.4]]) {
      const m = __game.machine(id); if (id === 'loader') m.override.boom = 0;
      const s = new Script(m, [startUp, (mm) => !mm.fn.boom || __game.autopilot.setFn(mm, 'boom', 0.15), (mm) => driveTo(mm, x, 33, { speed: 3 }) < 1.5, (mm, t) => { halt(mm); return t > 1; }], { timeout: 60 });
      let n = 0; while (!s.done && n++ < 60 * 90) __game.sim(1, () => s.step(1 / 60));
      out[id] = { z: m.position.z, up: m.bodyList[0].obj.matrixWorld.elements[5], t: n / 60 };
    }
    CL.update(1); out.done = CL.items[2].done; return out;
  });
  check(cross.done, `checklist: dumper and loader drove across the ford (dumper ${cross.dumper.t.toFixed(0)} s, loader ${cross.loader.t.toFixed(0)} s)`);
  await page.evaluate(() => { __game.play.overview = { from: [14, 7, 10], to: [1, 0, 22] }; __game.paused = false; }); await page.waitForTimeout(700);
  await page.screenshot({ path: 'shots/m5_crossing.png' });
  await page.evaluate(() => { __game.paused = true; });
  // 4a. a real tip into the hopper: back the dumper up to the wall with sand aboard
  const tip = await page.evaluate(() => {
    const g = __game, D = g.machine('dumper'), H = g.play.hopper, V = g.THREE.Vector3;
    D.reset(-24, -39.4, Math.PI); g.sim(90); // backed up until the chassis meets the wall: the bed tail overhangs the pit
    const p = D.containers.bed.obj.getWorldPosition(new V());
    for (let k = 0; k < 250; k++) { g.clods.pour('load', p.x, p.y + 2, p.z, 0, 0, 0, 4, 0.02, 1.2); g.sim(1); }
    g.sim(120); const loaded = D.payload('bed');
    D.override = { key: 1, throttle: 1, park: 1, tip: 1 }; g.sim(600); D.override.tip = -1; g.sim(300); D.override = {};
    return { loaded, left: D.payload('bed'), hopper: H.sand() };
  });
  check(tip.loaded > 4.5 && tip.hopper > tip.loaded * 0.75, `dumper tips into the hopper (${tip.loaded.toFixed(1)} m³ aboard, ${tip.hopper.toFixed(1)} m³ landed in the pit)`);
  // 4b. the rest of the 20 m³ arrives; the job completes
  const fin = await page.evaluate(() => {
    const g = __game, H = g.play.hopper, V = g.THREE.Vector3, c = H.obj.getWorldPosition(new V());
    let n = 0; while (H.sand() < 20.2 && n++ < 4000) { g.clods.pour('rest', c.x, c.y + 4, c.z, 0, 0, 0, 4, 0.03, 2.5); g.sim(1); }
    tick(2); return { sand: H.sand(), done: CL.items.map((i) => i.done), complete: CL.complete };
  });
  check(fin.complete, `checklist complete with ${fin.sand.toFixed(1)} m³ of sand in the hopper (${fin.done.map((d) => (d ? '✓' : '·')).join(' ')})`);
  const a = await page.evaluate(() => { __game.sim(300); return __game.audit(); });
  const added = 250 * 0.02 + fin.sand - tip.hopper; // sand poured in from outside the world by this test
  console.log(`audit: start ${v0.total.toFixed(1)} end ${a.total.toFixed(1)} m³ (washed ${a.washed.toFixed(2)}, compacted ${a.compacted.toFixed(2)}, lost ${a.lost.toFixed(2)})`);
  check(page.errs.length === 0, 'no page errors (inline job)' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
  await page.close();

  // --- stress scene: four machines, clod fountain, river
  page = await open('?worker=0&stress=1');
  await page.waitForFunction(() => __game.play?.stress);
  await page.evaluate(() => { __game.paused = true; });
  const s0 = await page.evaluate(() => __game.audit());
  const st = await page.evaluate(() => { const t = performance.now(); __game.sim(60 * 75); const S = __game.play.stress; return { ms: (performance.now() - t) / (60 * 75), prog: S.scripts.map((s) => `${s.m.id} ${s.cycles}c/${s.i}`), clods: __game.clods.count, up: __game.machines.map((m) => m.bodyList[0].obj.matrixWorld.elements[5]), bed: __game.machine('dumper').payload('bed'), terr: __game.terrain.stats }; });
  console.log(`stress: ${st.ms.toFixed(3)} ms/step total sim on this CPU; ${st.prog.join(', ')}; terrain tick ${st.terr.ms.toFixed(2)} ms, ${st.terr.awake} awake chunks; dumper bed ${st.bed.toFixed(2)} m³`);
  check(st.clods > 1300, `clod budget held full (${st.clods})`);
  check(st.up.every((u) => u > 0.8), `all four machines upright after 75 s of scripted work (${st.up.map((u) => u.toFixed(2)).join(' ')})`);
  await page.evaluate(() => { __game.play.overview = { from: [34, 16, -28], to: [8, 8, -46] }; __game.paused = false; }); await page.waitForTimeout(1200);
  await page.screenshot({ path: 'shots/m5_stress.png' });
  const perf = await page.evaluate(() => __game.perf.snapshot());
  const cnt = (n) => perf.counters.find((c) => c.name === n).value;
  check(cnt('calls') <= 150 && cnt('tris') <= 400000, `render budget: ${cnt('calls')} draw calls, ${cnt('tris')} triangles`);
  const s1a = await page.evaluate(() => { __game.paused = true; return __game.audit(); });
  const drift = Math.abs(s1a.total - s0.total) / s0.total;
  check(drift < 1e-3, `volume conserved through the stress run (${(drift * 100).toExponential(1)} %)`);
  check(page.errs.length === 0, 'no page errors (stress)' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
