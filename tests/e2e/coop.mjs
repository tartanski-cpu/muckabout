// Co-op reliability: everything that can drop a player, and whether they get back in by themselves.
// Two tabs of one browser on the BroadcastChannel transport (the session code is the same one the PeerJS path runs;
// tests/e2e/peer.mjs covers PeerJS itself against a local matchmaking server).
//   1  the host times a quiet player out (headset off) while the link stays up → let back in on its next message
//   2  the link dies without a goodbye (wifi drop) → the client makes a new link and gets its seat back
//   3  the same, five times over → no ghost players, seats or avatars pile up on the host
//   4  the client's page reloads → joins again
//   5  the host's page reloads → same room number; the client finds it again and takes the host's site as it now is
import { harness } from './lib.mjs';

const { open, check, done, browser } = await harness();
try {
  const context = await browser.newContext();
  const host = await open('?host=1&net=bc&worker=0', { context });
  await host.waitForFunction(() => __game.play?.net?.role === 'host', null, { timeout: 60000 });
  const code = await host.evaluate(() => __game.play.net.code);
  check(new URL(host.url()).searchParams.get('room') === code, `the host's address carries its room number (${code}), so a reload reopens the same room`);
  let client = await open(`?join=${code}&net=bc`, { context });
  // a tab in the background is throttled: give each a turn in front
  const turn = async (ms = 500) => { await host.bringToFront(); await host.waitForTimeout(ms); await client.bringToFront(); await client.waitForTimeout(ms); };
  const until = async (what, fn, tries = 60) => { for (let k = 0; k < tries; k++) { if (await fn()) return true; await turn(); } throw new Error('timed out waiting for ' + what); };
  const joined = () => client.evaluate(() => { const n = globalThis.__game?.play?.net; return !!(n && n.role === 'client' && n.id && !n.lost && !n.rejoining); });
  const hostSees = () => host.evaluate(() => { const n = __game.play.net; return { peers: [...n.peers.keys()], avatars: n.avatars.size, driver: __game.machine('dumper').driver, drops: n.drops }; });
  await until('the first join', joined);
  check((await hostSees()).peers.length === 1, 'client joined');

  // the client gets into the dumper
  await client.evaluate(() => { const g = __game; g.play.sit(g.machine('dumper')); });
  await until('the seat', async () => (await hostSees()).driver === await client.evaluate(() => __game.play.net.id));
  check(true, 'client has the dumper seat');

  // 1 ---- the host times the player out, the link stays up
  await host.evaluate(() => { __game.play.net.silence = 1.5; });
  await client.evaluate(() => { const t = __game.play.net.transport; t._send = t.send; t.send = () => {}; });
  await until('the host to drop the quiet player', async () => (await hostSees()).peers.length === 0);
  const dropped = await hostSees();
  check(dropped.driver === null && dropped.avatars === 0, 'a player who goes quiet is dropped: seat freed, avatar gone');
  await client.evaluate(() => { const t = __game.play.net.transport; t.send = t._send; });
  await host.evaluate(() => { __game.play.net.silence = 12; });
  await until('the quiet player to be let back in', async () => { const h = await hostSees(); return h.peers.length === 1 && h.driver === h.peers[0]; });
  check(true, 'when it speaks again it is let straight back in, and gets its seat back');
  await until('the client to be current again', joined);

  // it can still drive: inputs reach the host
  const z0 = await host.evaluate(() => { const p = __game.machine('dumper').position; return [p.x, p.z]; });
  await client.evaluate(() => { const m = __game.machine('dumper'); m.controls.key.set(1); m.controls.park.set(0); m.controls.shuttle.set(1); m.override = { accel: 0.7 }; });
  for (let k = 0; k < 8; k++) { await turn(400); await host.evaluate(() => { __game.sim(60); }); }
  await client.evaluate(() => { __game.machine('dumper').override = { accel: 0, brake: 1 }; }); await turn(600);
  const z1 = await host.evaluate(() => { const p = __game.machine('dumper').position; return [p.x, p.z]; });
  check(Math.hypot(z1[0] - z0[0], z1[1] - z0[1]) > 1, `and can drive again (${Math.hypot(z1[0] - z0[0], z1[1] - z0[1]).toFixed(1)} m)`);

  // 2 ---- the link dies without a goodbye
  const id0 = await client.evaluate(() => __game.play.net.id);
  await client.evaluate(() => { __game.play.net.transport.cut(); });
  await until('the client to rejoin', async () => (await joined()) && (await client.evaluate(() => __game.play.net.id)) !== id0);
  await until('the seat to follow', async () => { const h = await hostSees(); return h.peers.length === 1 && h.driver === h.peers[0] && h.peers[0] !== id0; });
  check(true, 'a dead link is replaced by itself; the old seat goes to the same player on the new link');
  check(await client.evaluate(() => __game.play.player.machine?.id === 'dumper'), 'the player was not thrown out of the cab meanwhile');

  // 3 ---- five times over
  for (let k = 0; k < 5; k++) {
    const id = await client.evaluate(() => __game.play.net.id);
    await client.evaluate(() => { __game.play.net.transport.cut(); });
    await until(`rejoin ${k + 1}`, async () => (await joined()) && (await client.evaluate(() => __game.play.net.id)) !== id);
  }
  await until('the host to settle', async () => { const h = await hostSees(); return h.peers.length === 1 && h.avatars === 1; });
  const many = await hostSees(), rejoins = await client.evaluate(() => __game.play.net.rejoins);
  check(many.peers.length === 1 && many.avatars === 1 && rejoins >= 6, `${rejoins} rejoins leave one player and one avatar on the host`);

  // the host digs; the rejoined client must still follow the ground
  await host.evaluate(() => { const g = __game; for (let i = 0; i < 6; i++) g.terrain.deposit(2 + i * 0.3, -30, 1, 0.5); g.sim(120); });
  await turn(800); await turn(800);
  const dh = async () => { const f = () => [2, 2.6, 3.2].map((x) => __game.terrain.heightAt(x, -30)); const a = await host.evaluate(f), b = await client.evaluate(f); return Math.max(...a.map((v, i) => Math.abs(v - b[i]))); };
  check(await dh() < 0.03, 'the rejoined client still sees what the host does to the ground');

  // 4 ---- the client's page reloads
  await client.reload(); await client.waitForFunction(() => globalThis.__game && __game.ready !== false, null, { timeout: 60000 });
  await until('the reloaded client to join', joined);
  await until('the host to have just that one', async () => { const h = await hostSees(); return h.peers.length === 1 && h.avatars === 1 && h.driver === null; });
  check(await dh() < 0.03, 'a reloaded client joins again, sees the site as it stands, and its old seat is free');

  // 5 ---- the host's page reloads: same room, and the client finds it again by itself
  await client.evaluate(() => { window.before = __game.terrain.heightAt(2.6, -30); });
  await host.reload(); await host.waitForFunction(() => globalThis.__game?.play?.net?.role === 'host', null, { timeout: 60000 });
  check(await host.evaluate(() => __game.play.net.code) === code, 'a reloaded host reopens the same room');
  await until('the client to find the host again', async () => (await joined()) && (await hostSees()).peers.length === 1, 90);
  const stale = await client.evaluate(() => [window.before, __game.terrain.heightAt(2.6, -30)]), fresh = await host.evaluate(() => __game.terrain.heightAt(2.6, -30));
  check(Math.abs(stale[1] - fresh) < 0.03 && Math.abs(stale[0] - fresh) > 0.05, `the client takes the host's site as it now is (heap of ${stale[0].toFixed(2)} m gone, ${stale[1].toFixed(2)} vs ${fresh.toFixed(2)})`);

  const bad = (p) => p.errs.filter((e) => !/Failed to load resource/.test(e));
  check(bad(host).length === 0 && bad(client).length === 0, 'no page errors' + ([...bad(host), ...bad(client)].length ? ':\n  ' + [...bad(host), ...bad(client)].join('\n  ') : ''));
} finally { await done(); }
