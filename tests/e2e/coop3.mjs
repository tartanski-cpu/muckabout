// Three players (roadmap 0b): a host and two clients in tabs of one browser, on the BroadcastChannel transport.
//   1  both clients join; each sees the other two players, and the host sees both
//   2  each takes a machine and drives it; nobody can take a seat that is taken
//   3  one client's link dies and it comes back under a new id: the other client loses the old figure, not keeps it
//   4  one client's page reloads: the same
//   5  a room that is full turns a newcomer away, and a player coming back on a new link still gets in
import { harness } from './lib.mjs';

const { open, check, done, browser } = await harness();
try {
  const context = await browser.newContext();
  const host = await open('?host=1&net=bc&worker=0', { context });
  await host.waitForFunction(() => __game.play?.net?.role === 'host', null, { timeout: 60000 });
  const code = await host.evaluate(() => __game.play.net.code);
  const a = await open(`?join=${code}&net=bc`, { context }), b = await open(`?join=${code}&net=bc`, { context });
  const pages = [host, a, b];
  const turn = async (ms = 400) => { for (const p of pages) { await p.bringToFront(); await p.waitForTimeout(ms); } };
  const until = async (what, fn, tries = 60) => { for (let k = 0; k < tries; k++) { if (await fn()) return true; await turn(); } throw new Error('timed out waiting for ' + what); };
  const joined = (p) => p.evaluate(() => { const n = globalThis.__game?.play?.net; return !!(n && n.role === 'client' && n.id && !n.lost && !n.rejoining); });
  const idOf = (p) => p.evaluate(() => __game.play.net.id);
  const seen = (p) => p.evaluate(() => [...__game.play.net.avatars.keys()].sort());
  const hostSees = () => host.evaluate(() => { const n = __game.play.net; return { peers: [...n.peers.keys()].sort(), avatars: n.avatars.size, drivers: Object.fromEntries(__game.machines.map((m) => [m.id, m.driver])) }; });

  // 1 ----
  await until('both clients to join', async () => (await joined(a)) && (await joined(b)));
  let ia = await idOf(a), ib = await idOf(b);
  await until('everyone to see everyone', async () => { const h = await hostSees(), sa = await seen(a), sb = await seen(b); return h.peers.length === 2 && h.avatars === 2 && sa.join() === ['host', ib].sort().join() && sb.join() === ['host', ia].sort().join(); });
  check(true, 'three players: the host sees both clients, and each client sees the host and the other client');

  // 2 ----
  await a.evaluate(() => __game.play.sit(__game.machine('dumper')));
  await b.evaluate(() => __game.play.sit(__game.machine('loader')));
  await until('both seats', async () => { const d = (await hostSees()).drivers; return d.dumper === ia && d.loader === ib; });
  check(true, 'each client has its own machine');
  await until('the clients to hear who drives', async () => (await b.evaluate(() => __game.play.net.drivers.dumper)) === ia);
  await b.evaluate(() => { __game.play.stand(); __game.play.sit(__game.machine('dumper')); });
  await turn(); await turn();
  check((await hostSees()).drivers.dumper === ia && await b.evaluate(() => __game.play.player.machine === null), 'a seat that is taken stays with its driver; the other is kept out');
  await b.evaluate(() => __game.play.sit(__game.machine('loader')));
  await until('the loader back', async () => (await hostSees()).drivers.loader === ib);

  const pos = () => host.evaluate(() => ['dumper', 'loader'].map((id) => { const p = __game.machine(id).position; return [p.x, p.z]; }));
  const p0 = await pos();
  for (const c of [a, b]) await c.evaluate(() => { const m = __game.play.player.machine; m.controls.key.set(1); m.controls.park.set(0); m.controls.shuttle.set(1); m.override = { accel: 0.7 }; });
  for (let k = 0; k < 8; k++) { await turn(300); await host.evaluate(() => __game.sim(60)); }
  for (const c of [a, b]) await c.evaluate(() => { __game.play.player.machine.override = { accel: 0, brake: 1 }; });
  await turn();
  const p1 = await pos(), moved = p1.map((p, i) => Math.hypot(p[0] - p0[i][0], p[1] - p0[i][1]));
  check(moved.every((d) => d > 1), `both clients drive at once (dumper ${moved[0].toFixed(1)} m, loader ${moved[1].toFixed(1)} m)`);

  // the machine you drive answers at once on your own screen (net/predict.js), before the host has heard
  await until('b to be current (not reconnecting)', () => joined(b));
  await b.bringToFront();
  const lever = await b.evaluate(async () => {
    const g = __game, m = g.machine('loader'), i = m.fnList.indexOf(m.fn.boom), buf = g.play.net.buffers.get('loader'), host = () => buf.snaps[buf.snaps.length - 1].s.f[i];
    const t = g.play.net.transport, send = t.send; t.send = () => {}; // nothing reaches the host meanwhile
    const before = m.fn.boom.pos, h0 = host(); m.override = { boom: 1 };
    await new Promise((r) => { let k = 0; const f = () => (++k > 6 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    const after = m.fn.boom.pos, h1 = host(); m.override = {}; t.send = send;
    return { before, after, h0, h1, rtt: g.play.net.rtt };
  });
  check(lever.after > lever.before + 0.01 && Math.abs(lever.h1 - lever.h0) < 1e-6, `the boom rises on the driver's screen as the lever moves, before the host has it (${lever.before.toFixed(3)} → ${lever.after.toFixed(3)}, host ${lever.h1.toFixed(3)}; round trip ${(lever.rtt * 1000).toFixed(0)} ms)`);

  // 3 ---- b's link dies; a must not keep b's old figure
  await b.evaluate(() => __game.play.net.transport.cut());
  await until('b to rejoin', async () => (await joined(b)) && (await idOf(b)) !== ib);
  const ib2 = await idOf(b);
  await until('a to see the new b only', async () => (await seen(a)).join() === ['host', ib2].sort().join());
  await until('the host to settle', async () => { const h = await hostSees(); return h.peers.join() === [ia, ib2].sort().join() && h.avatars === 2 && h.drivers.loader === ib2; });
  check(true, 'a client that drops and comes back is one figure to the others, not two, and has its seat back');

  // 4 ---- a reloads
  await a.reload(); await a.waitForFunction(() => globalThis.__game && __game.ready !== false, null, { timeout: 60000 });
  await until('a to join again', () => joined(a));
  ia = await idOf(a);
  await until('everyone to settle', async () => { const h = await hostSees(), ib3 = await idOf(b); return h.peers.join() === [ia, ib3].sort().join() && h.avatars === 2 && h.drivers.dumper === null && (await seen(b)).join() === ['host', ia].sort().join(); });
  check(true, 'a reloaded client is one player again; its old seat is free; the other client sees just it');

  // 5 ---- a full room
  await host.evaluate(() => { __game.play.net.max = 3; });
  const answer = await a.evaluate(() => new Promise((res) => {
    const ch = new BroadcastChannel('muckabout-room-' + __game.play.net.code), me = 'pfull';
    ch.onmessage = (e) => { const m = e.data; if (m.k === 'welcome' && m.to === me) ch.postMessage({ k: 'msg', from: me, to: 'host', d: { t: 'hello', was: null } }); if (m.k === 'msg' && m.to === me) { ch.close(); res(m.d.t); } };
    ch.postMessage({ k: 'join', from: me }); setTimeout(() => { ch.close(); res('nothing'); }, 8000);
  }));
  check(answer === 'full', `a fourth player is turned away from a room of three (answer: ${answer})`);
  check((await hostSees()).peers.length === 2, 'and is not counted');
  await b.evaluate(() => __game.play.net.transport.cut());
  await until('b to get back into the full room', async () => (await joined(b)) && (await idOf(b)) !== ib2);
  check((await hostSees()).peers.length === 2, 'a player coming back on a new link still gets into a full room');

  const bad = (p) => p.errs.filter((e) => !/Failed to load resource/.test(e));
  const errs = pages.flatMap(bad);
  check(errs.length === 0, 'no page errors' + (errs.length ? ':\n  ' + errs.join('\n  ') : ''));
} finally { await done(); }
