// M3: loader fills the dumper, the dumper hauls and tips; all through scripted drivers on the real machines.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?worker=0&scene=play&map=test');
  await page.waitForFunction(() => __game.machines?.length >= 3);
  await page.evaluate(() => { __game.paused = true; });
  const v0 = await page.evaluate(() => __game.audit());
  const res = await page.evaluate(async () => {
    const g = __game, { Script, loaderCycle, dumperCycle } = g.autopilot, L = g.machine('loader'), D = g.machine('dumper');
    D.reset(-1.95, 4.4, 2.19); L.reset(5, 6, 0); g.sim(60); // dumper angled so the loader's swing from the heap meets the bed side square-on // dumper parked side-on, west of the loader's run at the sand heap
    const ls = new Script(L, loaderCycle({ from: [5, 3], dig: [5, -6], stage: [5, 12], target: D.containers.bed }), { loop: true });
    const ds = new Script(D, dumperCycle({ park: [-1.95, 4.4], via: [3.5, 0.5], tip: [-12, 14], load: 2.0 }), { loop: true, timeout: 200 }); // the dumper waits as long as loading takes
    const t0 = performance.now(); let n = 0, peak = 0, low = 99;
    while (ds.cycles < 1 && n < 60 * 420) { g.sim(1, () => { ls.step(1 / 60); ds.step(1 / 60); }); n++; const b = D.payload('bed'); peak = Math.max(peak, b); if (ds.i >= 3) low = Math.min(low, b); }
    return { n, ms: (performance.now() - t0) / n, loaderCycles: ls.cycles, dumperCycles: ds.cycles, peak, low, tipped: ds.i, dz: D.position.z, lz: L.position.z, lup: L.bodyList[0].obj.matrixWorld.elements[5], dup: D.bodyList[0].obj.matrixWorld.elements[5] };
  });
  console.log(`loader→dumper: ${(res.n / 60).toFixed(0)} s simulated at ${res.ms.toFixed(3)} ms/step; loader cycles ${res.loaderCycles}, bed peak ${res.peak.toFixed(2)} m³`);
  check(res.loaderCycles >= 2 && res.peak > 2.0, `loader filled the dumper bed (${res.peak.toFixed(2)} m³ in ${res.loaderCycles} buckets)`);
  check(res.dumperCycles >= 1 && res.low < 0.15, `dumper hauled, tipped (bed down to ${res.low.toFixed(2)} m³) and returned`);
  check(res.lup > 0.95 && res.dup > 0.95, 'both machines still upright');
  const heap = await page.evaluate(() => __game.terrain.heightAt(-12, 14) - __game.terrain.heightAt(-12, 22));
  await page.evaluate(() => { __game.play.sit(__game.machine('dumper')); __game.play.chase = true; __game.paused = false; }); await page.waitForTimeout(800);
  await page.screenshot({ path: 'shots/m3_dumper.png' });
  await page.evaluate(() => { __game.paused = true; __game.sim(300); });
  const a = await page.evaluate(() => __game.audit());
  const drift = Math.abs(a.total - v0.total) / v0.total;
  check(drift < 1e-3, `volume conserved (${(drift * 100).toExponential(1)} %)`);
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
