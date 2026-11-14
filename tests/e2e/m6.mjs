// M6: two players, one world. Host and client are two tabs of one browser linked by the BroadcastChannel transport
// (same session code as the PeerJS path, minus the internet). The client must see the host's digging, drive a
// machine through the host, and both must see each other.
import { harness } from './lib.mjs';

const { open, check, done, browser } = await harness();
try {
  const context = await browser.newContext();
  const host = await open('?host=1&room=54321&net=bc&worker=0', { context });
  await host.waitForFunction(() => __game.play?.net?.role === 'host', null, { timeout: 60000 });
  const client = await open('?join=54321&net=bc', { context });
  // a tab in the background is throttled, so give host and client turns in front until the host has answered the join
  for (let k = 0, joined = false; !joined; k++) {
    if (k > 90) throw new Error('client never joined');
    await host.bringToFront(); await host.waitForTimeout(400); await client.bringToFront(); await client.waitForTimeout(400);
    joined = await client.evaluate(() => !!(globalThis.__game?.play?.net?.role === 'client' && __game.play.net.id));
  }
  check(await client.evaluate(() => __game.terrain.mode === 'remote' && __game.remote), 'client joined; it runs no terrain or physics of its own');
  const sync = async (ms = 1500) => { await host.bringToFront(); await host.waitForTimeout(ms / 2); await client.bringToFront(); await client.waitForTimeout(ms / 2); await host.bringToFront(); await host.waitForTimeout(300); await client.bringToFront(); await client.waitForTimeout(400); };

  // host works the loader at the gravel stockpile for a while (scripted), in real time so the client can follow
  await host.evaluate(() => {
    const g = __game, { Script, loaderCycle } = g.autopilot, L = g.machine('loader'); L.reset(6, -46, -Math.PI / 2);
    window.ls = new Script(L, loaderCycle({ from: [11, -46], dig: [20, -46], stage: [4, -46], target: g.play.hopper }), { loop: true });
    g.updaters.unshift((dt) => ls.step(dt));
  });
  // run the host sim fast (background tabs are throttled), letting the network loop flush in between
  for (let k = 0; k < 14; k++) { await host.evaluate(() => { __game.sim(120); }); await sync(500); }
  await sync(1500); await sync(1200); // short turns in the background: the host frees a seat whose player goes quiet
  const h = await host.evaluate(() => ({ pile: [16, 17, 18, 19, 20].map((x) => __game.terrain.heightAt(x, -46)), loader: __game.machine('loader').position.toArray(), boom: __game.machine('loader').fn.boom.pos, bucket: __game.machine('loader').payload(), peers: __game.play.net.peers.size }));
  const c = await client.evaluate(() => ({ pile: [16, 17, 18, 19, 20].map((x) => __game.terrain.heightAt(x, -46)), loader: __game.machine('loader').position.toArray(), boom: __game.machine('loader').fn.boom.pos, bucket: __game.machine('loader').payload(), base: __game.terrain.heightAt(16, -40) }));
  const dh = Math.max(...h.pile.map((v, i) => Math.abs(v - c.pile[i])));
  const dug = await host.evaluate(() => __game.machine('loader').feel.counts.clunk);
  check(h.peers === 1, 'host sees one client');
  check(dug > 3 && dh < 0.03, `client terrain matches the host's dug stockpile (worst difference ${(dh * 100).toFixed(1)} cm)`);
  const dpos = Math.hypot(h.loader[0] - c.loader[0], h.loader[1] - c.loader[1], h.loader[2] - c.loader[2]);
  check(dpos < 0.5 && Math.abs(h.boom - c.boom) < 0.1, `client sees the loader where the host has it (${dpos.toFixed(2)} m apart, boom ${c.boom.toFixed(2)} vs ${h.boom.toFixed(2)})`);
  check(Math.abs(h.bucket - c.bucket) < 0.15, `bucket contents replicated (${c.bucket.toFixed(2)} vs ${h.bucket.toFixed(2)} m³)`);

  // client climbs into the dumper and drives it: inputs go to the host, the host moves the machine
  await client.evaluate(() => { const g = __game, m = g.machine('dumper'); g.play.sit(m); m.controls.key.set(1); m.controls.park.set(0); m.controls.shuttle.set(1); m.override = { accel: 0.7 }; });
  const [x0, z0] = await host.evaluate(() => { const p = __game.machine('dumper').position; return [p.x, p.z]; });
  for (let k = 0; k < 6; k++) { await sync(600); await host.evaluate(() => { __game.sim(60); }); }
  await sync(1500); await sync(1500); // driving in real time
  await client.evaluate(() => { __game.machine('dumper').override = { accel: 0, brake: 1 }; }); // stop, so the comparison is of position, not of how far it travels in the interpolation delay
  await sync(1500); await sync(1200); // short turns in the background: the host frees a seat whose player goes quiet
  const drv = await host.evaluate(() => ({ driver: __game.machine('dumper').driver, z: __game.machine('dumper').position.z, x: __game.machine('dumper').position.x, running: __game.machine('dumper').engine.running, key: __game.machine('dumper').controls.key.value }));
  const cz = await client.evaluate(() => __game.machine('dumper').position.z);
  check(drv.driver && drv.driver !== 'local' && drv.running, 'host gave the dumper seat to the client and its key turned on the host');
  const went = Math.hypot(drv.x - x0, drv.z - z0);
  check(went > 1.5, `client drove the dumper ${went.toFixed(1)} m on the host`); // how far depends on how fast this computer runs the wall-clock part
  check(Math.abs(cz - drv.z) < 1.0, 'client sees its own dumper where the host put it');
  // the host cannot take a seat that is taken
  const taken = await host.evaluate(() => { __game.play.sit(__game.machine('dumper')); return __game.play.player.machine?.id || null; });
  check(taken === null, 'host is refused the seat the client is in');

  // avatars
  await sync(1000);
  const av = await Promise.all([host.evaluate(() => [...__game.play.net.avatars.values()].map((a) => a.root.visible)), client.evaluate(() => [...__game.play.net.avatars.values()].map((a) => a.root.visible))]);
  check(av[0].length === 1 && av[0][0] && av[1].length === 1 && av[1][0], 'each player sees the avatar of the other');
  await client.evaluate(() => { __game.play.stand(); __game.play.overview = { from: [28, 14, -30], to: [10, 8, -46] }; }); await sync(800);
  await client.screenshot({ path: 'shots/m6_client.png' });
  // leaving frees the seat
  await client.close(); await host.bringToFront(); await host.waitForTimeout(800);
  const after = await host.evaluate(() => ({ peers: __game.play.net.peers.size, driver: __game.machine('dumper').driver }));
  check(after.peers === 0 && !after.driver, 'client leaving frees its seat');
  check(host.errs.length === 0 && client.errs.length === 0, 'no page errors' + ([...host.errs, ...client.errs].length ? ':\n  ' + [...host.errs, ...client.errs].join('\n  ') : ''));
} finally { await done(); }
