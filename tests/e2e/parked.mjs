// Parked machines drawn baked (render/parked.js): four machines standing in the yard cost a few draw calls each, not
// some twenty; one that someone gets in and drives is drawn live again, and baked again once it is parked.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?worker=0');
  await page.waitForFunction(() => __game.machines?.length === 4, null, { timeout: 240000, polling: 300 });
  const calls = () => page.evaluate(() => __game.perf.snapshot().counters.find((x) => x.name === 'calls').value);
  await page.evaluate(() => { __game.paused = true; __game.sim(600); __game.paused = false; __game.play.overview = { from: [0, 12, -26], to: [0, 8, -44] }; }); // settled from their drop at spawn
  const live = await page.evaluate(() => { __game.parked.enabled = false; return true; });
  await page.waitForFunction(() => __game.parked.count === 0, null, { polling: 300 });
  await page.waitForTimeout(2500); const before = await calls();
  await page.evaluate(() => { __game.parked.enabled = true; });
  await page.waitForFunction(() => __game.parked.count === 4, null, { timeout: 60000, polling: 300 });
  await page.waitForTimeout(2500); const after = await calls();
  check(live && after <= before - 40, `four parked machines baked: ${before} draw calls drawn live, ${after} baked`);
  // the baked copy is where the machine is: its world-space box matches the live meshes'
  const fit = await page.evaluate(() => {
    const g = __game, T = g.THREE, m = g.machine('loader'), baked = g.scene.getObjectByName('loader.parked');
    const a = new T.Box3().setFromObject(baked), b = new T.Box3(); m.root.traverse((o) => { if (o.isMesh && o.layers.mask === 0) b.expandByObject(o); });
    return Math.max(a.min.distanceTo(b.min), a.max.distanceTo(b.max));
  });
  check(fit < 0.05, `the baked loader sits exactly over the live one (bounds differ by ${(fit * 100).toFixed(1)} cm)`);
  // get in and drive: drawn live from the first frame it moves; park: baked again
  const drive = await page.evaluate(() => {
    const g = __game, m = g.machine('loader'); g.play.sit(m); g.paused = true;
    Object.assign(m.override, { key: 1, park: 0, throttle: 1, shuttle: 1, accel: 0.8 }); g.sim(120);
    return true;
  });
  await page.evaluate(() => { __game.paused = false; });
  await page.waitForFunction(() => !__game.parked.isBaked(__game.machine('loader')), null, { timeout: 30000, polling: 100 });
  const moving = await page.evaluate(() => ({ others: __game.parked.count, hidden: (() => { let n = 0; __game.machine('loader').root.traverse((o) => { if (o.layers.mask === 0) n++; }); return n; })() }));
  check(drive && moving.others >= 2 && moving.hidden === 0, `the loader is drawn live while it drives (${moving.others} others still baked, ${moving.hidden} of its parts off the render layers)`);
  await page.evaluate(() => { const g = __game, m = g.machine('loader'); g.paused = true; Object.assign(m.override, { accel: 0, shuttle: 0, park: 1, key: 0, throttle: 0 }); g.sim(240); g.play.stand(); g.paused = false; });
  await page.waitForFunction(() => __game.parked.count === 4, null, { timeout: 60000, polling: 300 });
  check(true, 'parked again, it is baked again');
  await page.screenshot({ path: 'shots/parked.png' });
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
