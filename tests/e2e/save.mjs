// Saving the site: work done in one visit is there in the next. The page is loaded, changed, saved, loaded again
// (same browser storage), and compared; then the same round trip with the terrain in its worker.
import { harness } from './lib.mjs';

const { open, check, done, browser } = await harness();
try {
  const context = await browser.newContext();
  const snap = () => ({ h: [[2, 8], [2.5, 8], [10, -3], [14, -14], [-6, 3]].map(([x, z]) => __game.terrain.heightAt(x, z)), loader: __game.machine('loader').position.toArray(), dozerYaw: __game.machine('dozer').heading,
    boom: __game.machine('loader').fn.boom.pos, bucket: __game.machine('loader').payload(), bed: __game.machine('dumper').payload(), stake: __game.play.tools.stakes[0].root.position.toArray(), feet: __game.play.player.feet.toArray(), done: __game.play.checklist ? __game.play.checklist.items.map((i) => i.done) : [] });
  let page = await open('?worker=0&map=test&save=1&new=1', { context });
  await page.waitForFunction(() => __game.machines?.length && __game.save);
  const fresh = await page.evaluate(() => __game.save.savedAt);
  check(fresh === 0, 'a new site starts with nothing saved');
  await page.evaluate(() => { const g = __game, L = g.machine('loader'), D = g.machine('dozer'), T = g.terrain; g.paused = true;
    for (let i = 0; i < 40; i++) T.deposit(2 + (i % 5) * 0.1, 8, 4, 0.05);                      // a heap of sand
    L.reset(9, 4, 0.7); D.reset(-9, -3, 2.1); L.fn.boom.pos = 0.4; L.containers.bucket.field.add(4, 1.3); g.machine('dumper').containers.bed.field.add(5, 2.2);
    g.play.tools.stakes[0].root.position.set(6, T.heightAt(6, 9), 9); g.play.player.place(3, 11, 1.2); g.sim(40); });
  const audit0 = await page.evaluate(() => __game.audit()), before = await page.evaluate(snap);
  check(await page.evaluate(() => __game.save.save()), 'the site saves');
  await page.close();

  page = await open('?worker=0&map=test&save=1', { context });
  await page.waitForFunction(() => __game.machines?.length && __game.save?.savedAt > 0, null, { timeout: 60000 }); // (the load finishes a moment after the page is up)
  await page.evaluate(() => { __game.paused = true; });
  const after = await page.evaluate(snap), audit1 = await page.evaluate(() => __game.audit());
  const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) < tol);
  check(await page.evaluate(() => __game.save.savedAt > 0), 'on the next visit the saved site is loaded');
  check(near(after.h, before.h, 1e-4), `the ground is as it was left (heap ${after.h[0].toFixed(2)} m)`);
  check(near(after.loader, before.loader, 0.05) && Math.abs(after.dozerYaw - before.dozerYaw) < 0.02 && Math.abs(after.boom - before.boom) < 1e-6, 'the machines stand where they were left, booms as they were');
  check(Math.abs(after.bucket - before.bucket) < 1e-6 && Math.abs(after.bed - before.bed) < 1e-6 && before.bucket > 1, `their loads are still aboard (${after.bucket.toFixed(2)} m³ in the bucket, ${after.bed.toFixed(2)} m³ in the bed)`);
  check(near(after.stake, before.stake, 1e-4) && near(after.feet, before.feet, 0.02), 'tools and the player are where they were');
  check(Math.abs(audit1.total - audit0.total) / audit0.total < 1e-6, `no soil lost or made by saving and loading (${((audit1.total - audit0.total) * 1000).toFixed(1)} litres)`);
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
  await page.close();

  // ---- the same with the terrain running in its worker, as it does in the game
  page = await open('?worker=1&map=test&save=1&new=1', { context });
  await page.waitForFunction(() => __game.machines?.length && __game.save && __game.terrain.mode === 'worker');
  await page.evaluate(async () => { const T = __game.terrain; for (let i = 0; i < 30; i++) T.deposit(-3 + (i % 4) * 0.1, 15, 5, 0.05); await new Promise((r) => setTimeout(r, 1500)); });
  const wh0 = await page.evaluate(() => __game.terrain.heightAt(-3, 15));
  check(await page.evaluate(() => __game.save.save()), 'worker terrain: the site saves');
  await page.close();
  page = await open('?worker=1&map=test&save=1', { context });
  await page.waitForFunction(() => __game.machines?.length && __game.save?.savedAt > 0, null, { timeout: 60000 });
  const wh1 = await page.evaluate(() => __game.terrain.heightAt(-3, 15)), base = await page.evaluate(() => __game.terrain.heightAt(-3, 11));
  check(wh0 - base > 0.2 && Math.abs(wh1 - wh0) < 0.02, `worker terrain: the heap comes back (${(wh1 - base).toFixed(2)} m high)`);
  await page.evaluate(() => __game.save.forget());
  check(page.errs.length === 0, 'no page errors with the worker' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
