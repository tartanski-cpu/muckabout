// Three players finish the MVP job together (roadmap 0b), one of them dropping out and back in on the way.
// A host and two clients in tabs of one browser (BroadcastChannel), each stepped by hand so background-tab throttling
// does not decide the outcome. The clients really drive: a scripted driver runs on each client's own (predicted)
// copy of its machine and works it only through that client's inputs, which travel to the host like a player's.
// Shortcuts, as in m5.mjs, for what other tests cover: the two machines start on the river flat (cutting the road is
// M3's), the host lays the crossing straight onto the ground, and the last of the sand is poured into the hopper.
import { harness } from './lib.mjs';

const { open, check, done, browser } = await harness();
try {
  const context = await browser.newContext();
  const host = await open('?host=1&net=bc&worker=0', { context });
  await host.waitForFunction(() => __game.play?.net?.role === 'host' && __game.terrain.water && __game.play.checklist, null, { timeout: 60000 });
  const code = await host.evaluate(() => __game.play.net.code);
  const A = await open(`?join=${code}&net=bc`, { context }), B = await open(`?join=${code}&net=bc`, { context });
  const pages = [host, A, B];
  const turn = async () => { for (const p of pages) { await p.bringToFront(); await p.waitForTimeout(250); } };
  const joined = (p) => p.evaluate(() => { const n = globalThis.__game?.play?.net; return !!(n && n.id && !n.lost && !n.rejoining); });
  for (let k = 0; !((await joined(A)) && (await joined(B))); k++) { if (k > 60) throw new Error('clients never joined'); await turn(); }
  const setup = () => { const g = __game; g.renderer.setAnimationLoop(null); window.frames = (n, each) => { for (let i = 0; i < n; i++) { if (each) each(); g.loop(1 / 60); } }; };
  for (const p of pages) await p.evaluate(setup);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** One round: each client steps its driver and its game three frames, then the host three frames */
  const round = async () => {
    for (const c of [A, B]) await c.evaluate(() => frames(3, () => window.drv?.step(1 / 60)));
    await sleep(5); await host.evaluate(() => frames(3)); await sleep(5);
  };
  const jobs = (p) => p.evaluate(() => __game.play.checklist.items.map((i) => i.done));

  // ---- the machines on the river flat; each client takes one
  await host.evaluate(() => { __game.machine('dumper').reset(0, 12.5, Math.PI); __game.machine('loader').reset(4, 12.5, Math.PI); frames(30); });
  for (let k = 0; k < 6; k++) await round();
  await A.evaluate(() => __game.play.sit(__game.machine('dumper')));
  await B.evaluate(() => __game.play.sit(__game.machine('loader')));
  const ids = { A: await A.evaluate(() => __game.play.net.id), B: await B.evaluate(() => __game.play.net.id) };
  for (let k = 0; k < 10; k++) await round();
  const seats = await host.evaluate(() => ({ dumper: __game.machine('dumper').driver, loader: __game.machine('loader').driver }));
  check(seats.dumper === ids.A && seats.loader === ids.B, 'player A has the dumper and player B the loader');
  await host.evaluate(() => { __game.play.checklist.update(1); });
  for (let k = 0; k < 4; k++) await round();
  check((await jobs(A))[0] && (await jobs(B))[0], 'the first job (down to the river) is ticked on every player\'s clipboard');

  // ---- the host lays the crossing (the third player's part)
  const ford = await host.evaluate(() => {
    const t = __game.terrain, CL = __game.play.checklist, fill = (top, mat) => { for (let x = -1; x <= 5; x += 0.25) for (let z = 12.5; z <= 28; z += 0.25) { const h = t.heightAt(x, z); if (h < top && h < 0.4) t.deposit(x, z, mat, (top - h) * 0.0625); } };
    fill(-0.45, 2); frames(30); fill(-0.1, 5); for (let k = 0; k < 26; k++) { frames(60); CL.update(1); }
    return { done: CL.items[1].done, w: CL.fordWidth() };
  });
  check(ford.done, `the crossing holds (${ford.w.toFixed(1)} m wide)`);
  for (let k = 0; k < 6; k++) await round();
  const seen = await A.evaluate(() => __game.terrain.heightAt(2, 20));
  const truth = await host.evaluate(() => __game.terrain.heightAt(2, 20));
  check(Math.abs(seen - truth) < 0.03, `the clients see the crossing the host built (${seen.toFixed(2)} vs ${truth.toFixed(2)} m)`);

  // ---- both clients drive across at once; B's link dies half way
  const go = (x) => { const g = __game, { Script, driveTo, startUp, halt, setFn } = g.autopilot, m = g.play.player.machine;
    window.drv = new Script(m, [startUp, (mm) => !mm.fn.boom || setFn(mm, 'boom', 0.15), (mm) => driveTo(mm, x, 33, { speed: 3 }) < 1.5, (mm, t) => { halt(mm); return t > 1; }], { timeout: 90 }); };
  await A.evaluate(go, 0.8); await B.evaluate(go, 3.4);
  let cut = false, rounds = 0;
  for (; rounds < 1400; rounds++) {
    await round();
    const z = await host.evaluate(() => __game.machine('loader').position.z);
    if (!cut && z > 18) { cut = true; await B.evaluate(() => __game.play.net.transport.cut()); }
    if (rounds % 20 === 0 && await A.evaluate(() => window.drv.done) && await B.evaluate(() => window.drv.done)) break;
  }
  for (let k = 0; k < 10; k++) await round();
  const after = await host.evaluate(() => ({ d: __game.machine('dumper').position.z, l: __game.machine('loader').position.z, dl: __game.machine('loader').driver, CL: (__game.play.checklist.update(1), __game.play.checklist.items[2].done) }));
  const idB = await B.evaluate(() => __game.play.net.id), rejoinsB = await B.evaluate(() => __game.play.net.rejoins);
  check(cut && rejoinsB >= 1 && idB !== ids.B && after.dl === idB, `player B dropped out half way across, came back by itself and had the loader again (${rejoinsB} rejoin)`);
  check(after.CL, `both machines driven across by the clients (dumper at z ${after.d.toFixed(1)}, loader at ${after.l.toFixed(1)}; ${rounds} rounds)`);

  // ---- the sand
  const fin = await host.evaluate(() => { const g = __game, H = g.play.hopper, c = H.obj.getWorldPosition(new g.THREE.Vector3()); let n = 0;
    while (H.sand() < H.target + 0.2 && n++ < 4000) { g.clods.pour('rest', c.x, c.y + 4, c.z, 0, 0, 0, 4, 0.03, 2.5); g.sim(1); }
    frames(60); g.play.checklist.update(2); return g.play.checklist.complete; });
  for (let k = 0; k < 8; k++) await round();
  const all = [await jobs(host), await jobs(A), await jobs(B)];
  check(fin && all.every((j) => j.every(Boolean)), `the job is done, and it says so on all three clipboards (${all.map((j) => j.map((d) => (d ? '✓' : '·')).join('')).join(' / ')})`);
  const errs = pages.flatMap((p) => p.errs.filter((e) => !/Failed to load resource/.test(e)));
  check(errs.length === 0, 'no page errors' + (errs.length ? ':\n  ' + errs.join('\n  ') : ''));
} finally { await done(); }
