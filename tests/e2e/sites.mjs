// A valley each (docs/valley-layout.md): named sites in one browser, and a site carried to another computer as a file.
//   1  "Family" is worked and saved; "Friends", new, starts from the map as built: the two do not mix
//   2  both are listed; choosing one by name loads that one
//   3  Family saved to a file, and opened on another computer (a second browser profile): the work is there
//   4  opened again where a "Family" already exists, it comes in beside it, not over it
import { harness } from './lib.mjs';

const { open, check, done, browser } = await harness();
try {
  const home = await browser.newContext(), away = await browser.newContext(); // two computers: separate storage
  const ready = (p) => p.waitForFunction(() => __game.machines?.length && __game.save && __game.sites, null, { timeout: 60000 });
  const heap = () => __game.terrain.heightAt(2, 8) - __game.terrain.heightAt(2, 12);

  // 1 ---- Family: a heap, saved
  let p = await open('?worker=0&map=test&save=1&new=1&site=Family', { context: home }); await ready(p);
  await p.evaluate(() => { const g = __game; g.paused = true; for (let i = 0; i < 40; i++) g.terrain.deposit(2 + (i % 5) * 0.1, 8, 4, 0.05); g.sim(60); });
  const famHeap = await p.evaluate(heap);
  check(await p.evaluate(() => __game.save.save()) && famHeap > 0.3, `"Family" is worked (a ${famHeap.toFixed(2)} m heap) and saved`);
  const file = await p.evaluate(async () => Array.from(await __game.sites.exportBytes()));
  check(file.length > 100 && file.length < 300_000, `"Family" saved to a file: ${Math.round(file.length / 1024)} KB`);
  await p.close();

  // Friends: new, and none of Family's work
  p = await open('?worker=0&map=test&save=1&new=1&site=Friends', { context: home }); await ready(p);
  check(Math.abs(await p.evaluate(heap)) < 0.05 && await p.evaluate(() => __game.save.name) === 'Friends', 'a new site, "Friends", starts from the map as built');
  await p.evaluate(() => __game.save.save());
  // 2 ---- both listed; and the last one played is the one that opens next time
  const names = await p.evaluate(async () => { const { listSites } = await import('/src/game/save.js').catch(() => ({})); return listSites ? (await listSites('test')).map((s) => s.name) : [...document.querySelectorAll('#siteSel option')].map((o) => o.value); });
  check(names.includes('Family') && names.includes('Friends'), `both sites are listed (${names.join(', ')})`);
  await p.close();
  p = await open('?worker=0&map=test&save=1', { context: home }); await ready(p);
  check(await p.evaluate(() => __game.save.name) === 'Friends', 'opening the game again goes back to the site last played');
  await p.close();
  p = await open('?worker=0&map=test&save=1&site=Family', { context: home }); await ready(p);
  await p.waitForFunction(() => __game.save.savedAt > 0, null, { timeout: 60000 });
  check(Math.abs(await p.evaluate(heap) - famHeap) < 0.02, 'choosing "Family" by name loads Family, heap and all');

  // 4 ---- the file opened here again: beside the existing Family, not over it
  const name2 = await p.evaluate(async (b) => __game.sites.importBytes(new Uint8Array(b), 'Family.muck'), file);
  check(name2 === 'Family 2', `opened where a "Family" already exists, it comes in as "${name2}"`);
  await p.close();

  // 3 ---- another computer
  p = await open('?worker=0&map=test&save=1&new=1&site=Mine', { context: away }); await ready(p);
  const name3 = await p.evaluate(async (b) => __game.sites.importBytes(new Uint8Array(b), 'Family.muck'), file);
  await p.close();
  p = await open(`?worker=0&map=test&save=1&site=${encodeURIComponent(name3)}`, { context: away }); await ready(p);
  await p.waitForFunction(() => __game.save.savedAt > 0, null, { timeout: 60000 });
  const there = await p.evaluate(heap);
  check(name3 === 'Family' && Math.abs(there - famHeap) < 0.02, `on another computer the file opens as "${name3}", with the heap (${there.toFixed(2)} m)`);
  const bad = await p.evaluate(async () => { try { await __game.sites.importBytes(new TextEncoder().encode('not a site'), 'x.muck'); return 'accepted'; } catch (e) { return e.message; } });
  check(/not a Muck About site file/.test(bad), `a file that is not a site is refused plainly ("${bad}")`);
  check(p.errs.length === 0, 'no page errors' + (p.errs.length ? ':\n  ' + p.errs.join('\n  ') : ''));
} finally { await done(); }
