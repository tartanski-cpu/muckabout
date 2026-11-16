// Hand tools in co-op (roadmap 0b): one set, owned by the host; a client carries them on its own screen and the
// host follows. Host and client are tabs of one browser on the BroadcastChannel transport, each stepped by hand
// (their animation loops stopped) so the test does not depend on how a background tab is throttled.
//   1  a client picks up the shovel: the host sees it move, and cannot take it while the client has it
//   2  the client digs with it: the soil comes out of the host's ground, onto the host's shovel, and the volume
//      audit on the host still balances
//   3  the client puts it down: it lands where it was let go, on the host too, and the host can take it again
//   4  the host plants a stake: the client sees it there; the client switches the line to sloped and the host follows
//   5  a client that drops out with a tool in hand: the host puts it down
import { harness } from './lib.mjs';

const { open, check, done, browser } = await harness();
try {
  const context = await browser.newContext();
  const host = await open('?host=1&net=bc&worker=0&map=test', { context });
  await host.waitForFunction(() => __game.play?.net?.role === 'host' && __game.play.tools, null, { timeout: 60000 });
  const code = await host.evaluate(() => __game.play.net.code);
  const client = await open(`?join=${code}&net=bc&map=test`, { context });
  const turn = async () => { await host.bringToFront(); await host.waitForTimeout(300); await client.bringToFront(); await client.waitForTimeout(300); };
  for (let k = 0; !(await client.evaluate(() => !!globalThis.__game?.play?.net?.id && !__game.play.net.lost)); k++) { if (k > 60) throw new Error('client never joined'); await turn(); }
  const setup = () => { const g = __game; g.renderer.setAnimationLoop(null); window.P = g.play; window.V = g.THREE.Vector3; window.Q = g.THREE.Quaternion; window.E = g.THREE.Euler;
    window.hold = (side, x, y, z, grip, extra = {}) => P.input.setFake(side, { pos: new V(x, y, z), grip, ...extra });
    window.frames = (n) => { for (let i = 0; i < n; i++) g.loop(1 / 60); }; };
  await host.evaluate(setup); await client.evaluate(setup);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** n frames on the client, then n on the host, a few times: messages cross in between */
  const both = async (n = 6, rounds = 1) => { for (let r = 0; r < rounds; r++) { await client.evaluate((n) => frames(n), n); await sleep(30); await host.evaluate((n) => frames(n), n); await sleep(30); } };
  await both(6, 4);
  const v0 = await host.evaluate(() => __game.audit());

  // 1 ---- the client picks up the shovel
  const sh = await client.evaluate(() => { const p = P.tools.shovel.grabPoint(new V()); return [p.x, p.y, p.z]; });
  await client.evaluate(([x, y, z]) => hold('right', x, y, z, true), sh); await both(6, 3);
  await client.evaluate(([x, y, z]) => hold('right', x + 1, y + 0.3, z, true), sh); await both(6, 4);
  const moved = await host.evaluate(([x, , z]) => { const s = P.tools.shovel; return { remote: s.remote, d: Math.hypot(s.grabPoint(new V()).x - (x + 1), s.grabPoint(new V()).z - z) }; }, sh);
  const cid = await client.evaluate(() => P.net.id);
  check(moved.remote === cid && moved.d < 0.2, `a client picks up the shovel: the host has it in that player's hand, where they hold it (${moved.d.toFixed(2)} m off)`);
  const taken = await host.evaluate(() => { const p = P.tools.shovel.grabPoint(new V()); hold('left', p.x, p.y, p.z, false); frames(2); hold('left', p.x, p.y, p.z, true); frames(3); const got = P.tools.shovel.holders.length > 0; hold('left', p.x, p.y, p.z, false); frames(2); P.input.setFake('left', null); return got; });
  check(!taken, 'the host cannot take the shovel out of the client\'s hand');

  // 2 ---- dig with it, on the client; the host does the digging
  const spot = await host.evaluate(() => { const t = __game.terrain, x = 2, z = 12; return { x, z, y0: t.heightAt(x, z - 1.2) }; });
  for (let i = 0; i < 60; i++) {
    await client.evaluate(({ x, z, y0, i }) => { hold('right', x, y0 + 0.62 - Math.min(0.2, i * 0.012), z - i * 0.009, true); frames(3); }, { ...spot, i });
    await sleep(10); await host.evaluate(() => frames(3));
  }
  await client.evaluate(({ x, z, y0 }) => { for (let i = 0; i < 6; i++) { hold('right', x, y0 + 1.1, z - 0.6, true); frames(3); } }, spot); await both(6, 3);
  const dug = { load: await host.evaluate(() => P.tools.shovel.volume()), audit: await host.evaluate(() => __game.audit()) };
  const seen = await client.evaluate(() => P.tools.shovel.heap.visible);
  check(dug.load > 0.005, `the client digs: the soil comes out of the host's ground onto the shovel (${(dug.load * 1000).toFixed(0)} litres)`);
  check(Math.abs(dug.audit.total - v0.total) / v0.total < 1e-6, `and the volume on the host still balances (${((dug.audit.total - v0.total) * 1000).toFixed(3)} litres adrift, ${(dug.audit.extra * 1000).toFixed(0)} litres on the shovel)`);
  check(seen, 'the client sees soil on its shovel');

  // 3 ---- put it down
  const at = await client.evaluate(({ x, z, y0 }) => { hold('right', x + 2, y0 + 0.9, z + 1, true); frames(4); hold('right', x + 2, y0 + 0.9, z + 1, false); frames(1); P.input.setFake('right', null); const p = P.tools.shovel.root.position; return [p.x, p.y, p.z]; }, spot);
  await both(6, 4);
  const stays = await client.evaluate((p) => P.tools.shovel.root.position.distanceTo(new V(...p)), at);
  check(stays < 0.05, `on the client it stays where it was put down while the host catches up (${stays.toFixed(2)} m)`);
  const down = await host.evaluate(([x, y, z]) => { const s = P.tools.shovel, p = s.root.position; return { remote: s.remote, d: Math.hypot(p.x - x, p.y - y, p.z - z) }; }, at);
  check(down.remote === null && down.d < 0.15, `put down, it lands where the client let it go, on the host too (${down.d.toFixed(2)} m apart)`);
  const again = await host.evaluate(() => { const p = P.tools.shovel.grabPoint(new V()); hold('left', p.x, p.y, p.z, false); frames(2); hold('left', p.x, p.y, p.z, true); frames(3); const got = P.tools.shovel.holders.length > 0; hold('left', p.x, p.y, p.z, false); frames(3); P.input.setFake('left', null); frames(2); return got; });
  check(again, 'and the host can take it again');

  // 4 ---- a stake, planted by the host; the line switched by the client
  const planted = await host.evaluate(() => { const s = P.tools.stakes[0], t = __game.terrain, p = s.grabPoint(new V()), x = 9, z = 4;
    hold('left', p.x, p.y, p.z, true); frames(2); hold('left', x, t.heightAt(x, z) + 0.9, z, true); frames(2); hold('left', x, t.heightAt(x, z) + 0.9, z, false); frames(2); P.input.setFake('left', null); frames(2);
    return s.root.position.toArray(); });
  await both(6, 4);
  const there = await client.evaluate((p) => P.tools.stakes[0].root.position.distanceTo(new V(...p)), planted);
  check(there < 0.05, `the host plants a stake: the client sees it there (${(there * 100).toFixed(1)} cm off)`);
  const flipped = await client.evaluate(() => { const s = P.tools.stakes[1], p = s.grabPoint(new V()); hold('left', p.x, p.y, p.z, true); frames(3); hold('left', p.x, p.y, p.z, true, { trigger: 1 }); frames(3); return P.tools.line.slope; });
  await both(6, 4);
  await client.evaluate(() => { const p = P.tools.stakes[1].grabPoint(new V()); hold('left', p.x, p.y, p.z, false); frames(3); P.input.setFake('left', null); });
  await both(6, 4);
  check(flipped && await host.evaluate(() => P.tools.line.slope) && await client.evaluate(() => P.tools.line.slope), 'the client switches the line to sloped, and the host and client both have it so');

  // 5 ---- a client drops out holding a tool
  const hk = await client.evaluate(() => { const p = P.tools.hooks[0].grabPoint(new V()); hold('right', p.x, p.y, p.z, true); frames(3); hold('right', p.x + 0.5, p.y + 0.5, p.z, true); frames(6); return true; });
  await both(6, 3);
  const held = await host.evaluate(() => P.tools.hooks[0].remote), cid2 = await client.evaluate(() => P.net.id); // (it may have rejoined under a new id: the host only runs when stepped)
  await client.close();
  for (let k = 0; k < 40 && await host.evaluate(() => !!P.tools.hooks[0].remote); k++) { await host.evaluate(() => frames(6)); await sleep(100); }
  const after = await host.evaluate(() => { const h = P.tools.hooks[0], p = h.root.position; return { remote: h.remote, ground: p.y - __game.terrain.heightAt(p.x, p.z) }; });
  check(hk && held === cid2 && after.remote === null && after.ground < 0.2, `a client that leaves with a hook in hand: the host puts it down (${after.ground.toFixed(2)} m above the ground)`);
  check(host.errs.length === 0 && client.errs.length === 0, 'no page errors' + ([...host.errs, ...client.errs].length ? ':\n  ' + [...host.errs, ...client.errs].join('\n  ') : ''));
} finally { await done(); }
