// Co-op over the real thing: PeerJS and WebRTC data channels, against a matchmaking server run here (the game uses
// PeerJS's public one; `?broker=host:port` points it at another). What this covers that coop.mjs cannot:
//   the matchmaking server goes away while a game is on → the players already in carry on;
//   it stays away for a while (several failed reconnects), then returns → the host gets back on it by itself, and a
//     new player can join the room. This is the failure that locked a dropped player out for good.
//   a client's data link closes → it joins again by itself.
import { PeerServer } from 'peer';
import { harness } from './lib.mjs';

const PORT = 9777;
function broker() {
  return new Promise((res) => {
    const socks = new Set();
    PeerServer({ port: PORT, path: '/', host: '127.0.0.1' }, (server) => {
      server.on('connection', (s) => { socks.add(s); s.on('close', () => socks.delete(s)); });
      res({ stop: () => new Promise((r) => { for (const s of socks) s.destroy(); server.close(() => r()); }) });
    });
  });
}

const { open, check, done } = await harness();
let srv = await broker();
try {
  const q = `net=peer&broker=127.0.0.1:${PORT}`;
  const host = await open(`?host=1&room=24680&worker=0&${q}`);
  await host.waitForFunction(() => __game.play?.net?.role === 'host', null, { timeout: 60000 });
  const pages = [host];
  const turn = async (ms = 400) => { for (const p of pages) { await p.bringToFront(); await p.waitForTimeout(ms); } };
  const until = async (what, fn, tries = 80) => { for (let k = 0; k < tries; k++) { if (await fn()) return true; await turn(); } for (const p of pages) console.log('  page:', await p.evaluate(() => ({ status: document.getElementById('status')?.textContent, net: (({ role, id, lost, rejoining, error, rejoins }) => ({ role, id, lost, rejoining, error, rejoins }))(globalThis.__game?.play?.net || {}), tr: (({ state, reachable }) => ({ state, reachable }))(globalThis.__game?.play?.net?.transport || {}) })).catch((e) => String(e)), p.errs.slice(-6)); throw new Error('timed out waiting for ' + what); };
  const joined = (p) => p.evaluate(() => { const n = globalThis.__game?.play?.net; return !!(n && n.role === 'client' && n.id && !n.lost && !n.rejoining); });
  const peers = () => host.evaluate(() => __game.play.net.peers.size);
  const reachable = () => host.evaluate(() => __game.play.net.transport.reachable);

  const a = await open(`?join=24680&${q}`); pages.push(a);
  await until('the first player to join over WebRTC', async () => (await joined(a)) && (await peers()) === 1);
  check(true, 'a player joins over PeerJS and a WebRTC data channel');
  // ordinary digging: small ground updates and container contents must arrive readable (PeerJS delivers small and
  // large byte arrays differently)
  const ground = (p) => p.evaluate(() => [2, 2.6, 3.2].map((x) => __game.terrain.heightAt(x, -30)));
  const same = async (p) => { const h = await ground(host), c = await ground(p); return Math.max(...h.map((v, i) => Math.abs(v - c[i]))); };
  const flat = (await ground(host))[1];
  await host.evaluate(() => { const g = __game; for (let i = 0; i < 6; i++) g.terrain.deposit(2 + i * 0.3, -30, 1, 0.5); g.sim(60); const r = g.rigs[0].field; r.fill[0] = 0.5; r.mat[0] = 1; r.rev = (r.rev || 0) + 1; });
  await turn(900); await turn(900);
  const heap = (await ground(host))[1] - flat, off = await same(a), fill = (p) => p.evaluate(() => __game.rigs[0].field.fill[0]);
  await until('container contents', async () => Math.abs(await fill(a) - await fill(host)) < 0.02, 12).catch(() => {});
  const cont = await fill(a), contH = await fill(host);
  check(heap > 0.1 && off < 0.03, `a small change to the ground reaches the player (heap of ${heap.toFixed(2)} m, ${(off * 100).toFixed(1)} cm out)`);
  check(contH > 0.05 && Math.abs(cont - contH) < 0.02, `and so do container contents (${cont.toFixed(2)} vs ${contH.toFixed(2)})`);

  // the matchmaking server goes away
  await srv.stop();
  await until('the host to notice', async () => !(await reachable()));
  await turn(1500);
  check(await joined(a) && (await peers()) === 1, 'the matchmaking server going away does not disturb a game in progress');
  for (let k = 0; k < 8; k++) await turn(800); // long enough for several reconnects to fail
  check(!(await reachable()) && await host.evaluate(() => __game.play.net.transport.state === 'open'), 'the host keeps trying while it is away');
  srv = await broker();
  await until('the host to get back onto the matchmaking server', reachable);
  check(true, 'when it returns the host gets back on by itself');
  const b = await open(`?join=24680&${q}`); pages.push(b);
  await until('a new player to join', async () => (await joined(b)) && (await peers()) === 2);
  check(true, 'and a new player can join the room');
  check(await same(b) < 0.03, 'who sees the site as it stands');

  // a client's link closes
  const id0 = await a.evaluate(() => __game.play.net.id);
  await a.evaluate(() => { __game.play.net.transport.conn.close(); });
  await until('the player to rejoin', async () => (await joined(a)) && (await a.evaluate(() => __game.play.net.id)) !== id0 && (await peers()) === 2);
  check(true, 'a player whose link closes joins again by itself');
  // and the same when its whole Peer dies (the browser dropped everything)
  await b.evaluate(() => { __game.play.net.transport.peer.destroy(); });
  await until('the other player to rejoin', async () => (await joined(b)) && (await peers()) === 2);
  check(await host.evaluate(() => __game.play.net.avatars.size) === 2, 'so does one whose connection was torn down entirely; the host shows two players');

  // the host's page reloads: same room id straight after leaving it
  await b.close(); pages.pop(); // three pages rendering in software make the reload very slow
  await host.bringToFront(); await host.reload({ timeout: 180000, waitUntil: 'commit' });
  await host.waitForFunction(() => globalThis.__game?.play?.net?.role === 'host', null, { timeout: 240000, polling: 500 }).catch(async (e) => { console.log('  host says:', await host.evaluate(() => document.getElementById('status')?.textContent), host.errs.slice(-5)); throw e; });
  await until('the player to find the reloaded host', async () => (await joined(a)) && (await peers()) === 1, 150);
  check(true, 'a reloaded host reopens the room and the player comes back by itself');
  const bad = pages.flatMap((p) => p.errs.filter((e) => /pageerror/.test(e)));
  check(bad.length === 0, 'no page errors' + (bad.length ? ':\n  ' + bad.join('\n  ') : ''));
} catch (e) { console.error(e); check(false, 'the run finished: ' + e.message); } finally { await srv.stop().catch(() => {}); await done(); process.exit(0); } // the matchmaking server would keep node alive
