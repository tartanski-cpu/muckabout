// Co-op for up to MAX_PLAYERS (spec §6, roadmap 0b: two players and a third), host-authoritative:
//   host    runs the terrain worker and all machine physics; sends machine states and poses at 20 Hz, terrain deltas at
//           10 Hz, container contents at 5 Hz, the river at 1 Hz, and clod spawn events (clients fly them cosmetically)
//   client  builds the same starting map, draws interpolated host state 0.12 s behind, and sends its head/hand pose and
//           the inputs of the machine it is sitting in. The host decides who drives what: first to sit gets the seat.
// Message shapes and rates follow SWVR's protocol (src/net/protocol.ts, hostSession.ts, clientSession.ts).
import { TerrainDeltaWriter, encodeWater } from './terrainDelta.js';
import { SnapshotBuffer, lerpArr, nlerpQuat } from './snapshot.js';
import { Avatar } from './avatar.js';
import { OwnMachine } from './predict.js';

export const MAX_PLAYERS = 4; // the host counts as one
const NET_DT = 1 / 20, now = () => performance.now() / 1000;
const _h = { x: 0, y: 0, z: 0 }, _q = { x: 0, y: 0, z: 0, w: 1 };

function localPose(game, S) {
  const p = { h: null, l: null, r: null }, c = game.camera;
  c.getWorldPosition(_v3(S)); c.getWorldQuaternion(_q4(S)); p.h = [...S._v.toArray(), ...S._q.toArray()];
  for (const [k, side] of [['l', 'left'], ['r', 'right']]) { const h = S.input.hands[side]; if (h.tracked) p[k] = [...h.pos.toArray(), ...h.quat.toArray()]; }
  p.seat = S.player.machine ? S.player.machine.id : null;
  return p;
}
const _v3 = (S) => (S._v ??= new (S.THREE.Vector3)()), _q4 = (S) => (S._q ??= new (S.THREE.Quaternion)());
const ctlValues = (m) => { const o = {}; for (const k in m.controls) { const c = m.controls[k]; if (c.def.type === 'handrail' || c.def.type === 'button' || k === 'clipboard') continue; o[k] = typeof c.value === 'object' ? [c.value.x, c.value.y] : c.value; } return o; };
const setCtlValues = (m, vals) => { for (const k in vals) { const c = m.controls[k]; if (!c || c.held) continue; const v = vals[k]; if (Array.isArray(v)) { if (c.value.x !== v[0] || c.value.y !== v[1]) c.set({ x: v[0], y: v[1] }); } else if (c.value !== v) c.set(v); } };
const packField = (f) => { const n = f.fill.length, fill = new Uint8Array(n); for (let k = 0; k < n; k++) fill[k] = Math.min(255, Math.round(f.fill[k] * 100)); return { f: fill, m: f.mat.slice() }; };

// ------------------------------------------------------------------ host
export async function startHost(game, S, transport, code) {
  S.THREE = game.THREE;
  await transport.host(code);
  const net = S.net = { role: 'host', code, transport, peers: new Map(), avatars: new Map(), acc: 0, n: 0, clods: [], sentRev: new Map(), silence: 12, drops: 0, admits: 0, max: MAX_PLAYERS, replaced: new Set() };
  const writer = new TerrainDeltaWriter(game.terrain); game.terrain.onChunks((c) => writer.markChunks(c));
  // record clod spawns for the clients
  const spawn = game.clods.spawn.bind(game.clods);
  game.clods.spawn = (x, y, z, vx, vy, vz, mat, vol) => { if (net.peers.size && net.clods.length < 8 * 250) net.clods.push(x, y, z, vx, vy, vz, mat, vol); spawn(x, y, z, vx, vy, vz, mat, vol); };

  const admit = (id) => { let p = net.peers.get(id); if (!p) { net.peers.set(id, p = { pose: null, last: now() }); net.admits++; } return p; };
  transport.onPeer = () => {}; // a link alone is not a player: admitted on its first message, when there is room
  transport.onLeave = (id) => drop(id);
  function drop(id) { if (net.peers.delete(id)) net.drops++; S.tools?.dropAll(id); net.avatars.get(id)?.dispose(); net.avatars.delete(id); for (const m of game.machines) if (m.driver === id) { m.driver = null; m.remoteInp = null; } }
  transport.onMessage = (msg, from) => {
    // A player dropped for going quiet (headset off, wifi blip) whose link is still up is let straight back in on its
    // next message, and brought up to date as a newcomer is. It used to be ignored for good: in the room, seeing the
    // host, unable to drive or be seen, and a fresh join was the only way back.
    // A link its player has already replaced with a new one can still deliver a last message or two: ignore it, or it
    // is let back in and stands about as a ghost with the same player's look until it times out.
    if (net.replaced.has(from)) return;
    if (!net.peers.has(from)) {
      // full: a player coming back on a new link (`was`) takes its old place, anyone else is turned away
      if (msg.t === 'hello' && msg.was && msg.was !== from) { net.replaced.add(msg.was); drop(msg.was); }
      if (net.peers.size >= net.max - 1) { if (msg.t === 'hello') transport.send({ t: 'full', max: net.max }, from); return; }
    }
    const back = !net.peers.has(from), peer = admit(from); peer.last = now();
    if (msg.t === 'hello' || back) {
      if (msg.was && msg.was !== from) { net.replaced.add(msg.was); drop(msg.was); } // the same player on a new link: free the old one's seat now
      const w = game.terrain.water;
      transport.send({ t: 'welcome', id: from, map: game.terrain.mapName, terrain: writer.full(), water: w ? encodeWater(w) : null }, from);
      for (const r of game.rigs) net.sentRev.delete(r.key); // resend every container to the newcomer
    } else if (msg.t === 'pose') { peer.pose = msg.p; if (msg.ct) { peer.ct = msg.ct; peer.ctAt = now(); } }
    else if (msg.t === 'sit') { const m = game.machine(msg.m); for (const x of game.machines) if (x.driver === from) x.driver = null; if (m && !m.driver) m.driver = from; }
    else if (msg.t === 'stand') { for (const m of game.machines) if (m.driver === from) { m.driver = null; m.remoteInp = null; } }
    else if (msg.t === 'tool') S.tools?.remoteMove(msg.i, from, msg.p, { drop: !!msg.drop, trigger: msg.trig || 0 });
    else if (msg.t === 'slope') S.tools?.remoteSlope(from, msg.on);
    else if (msg.t === 'inp') { const m = game.machine(msg.m); if (m && m.driver === from) { m.remoteInp = msg.inp; setCtlValues(m, msg.c); } } // inputs from anyone but the driver are ignored
  };
  game.frameUpdaters.push((dt) => {
    for (const [id, peer] of net.peers) { // draw the other player; drop anyone silent for 12 s (a headset taken off rarely closes the link)
      if (now() - peer.last > net.silence) { drop(id); continue; }
      let a = net.avatars.get(id); if (!a) net.avatars.set(id, a = new Avatar(game.scene, id, (x, z) => game.terrain.heightAt(x, z)));
      a.update(peer.pose, dt);
    }
    net.acc += dt; if (net.acc < NET_DT) return; net.acc = Math.min(net.acc - NET_DT, NET_DT); net.n++;
    if (!net.peers.size) { net.clods.length = 0; writer.dirty.size > 4000 && writer.dirty.clear(); return; }
    const machines = {}; for (const m of game.machines) machines[m.id] = { ...m.netState(), d: m.driver === 'local' ? 'host' : m.driver, c: ctlValues(m), ev: m.netEvents?.splice(0) };
    const players = { host: localPose(game, S) }; for (const [id, p] of net.peers) players[id] = p.pose;
    const echo = {}; for (const [id, p] of net.peers) if (p.ct) echo[id] = p.ct + (now() - p.ctAt); // each client's clock, less the time it waited here: its round trip
    transport.send({ t: 'snap', time: now(), machines, players, echo, tools: S.tools?.netState('host'), clods: net.clods.splice(0), jobs: S.checklist ? S.checklist.items.map((i) => i.done) : null });
    if (net.n % 2 === 0) { const d = writer.delta(); if (d) transport.send({ t: 'terrain', d }); }
    if (net.n % 4 === 0) { const c = {}; let any = false; for (const r of game.rigs) { const rev = r.field.rev || 0; if (net.sentRev.get(r.key) !== rev) { net.sentRev.set(r.key, rev); c[r.key] = packField(r.field); any = true; } } if (any) transport.send({ t: 'cont', c }); }
    if (net.n % 20 === 0 && game.terrain.water) transport.send({ t: 'water', d: encodeWater(game.terrain.water) });
  });
  return net;
}

// ------------------------------------------------------------------ client
export async function startClient(game, S, transport, code) {
  S.THREE = game.THREE;
  const net = S.net = { role: 'client', code, transport, id: null, buffers: new Map(), avatars: new Map(), poses: new SnapshotBuffer(), acc: 0, lost: false, lastSnap: now(), drivers: {}, seatT: 0, helloT: 0, rejoining: false, rejoins: 0, closed: false, error: null };
  for (const m of game.machines) net.buffers.set(m.id, new SnapshotBuffer());
  const rigByKey = new Map(game.rigs.map((r) => [r.key, r]));
  game.clods.setTargets({ heightAt: (x, z) => game.terrain.heightAt(x, z), deposit() {} }, []); // clods are scenery here: the host's terrain is the truth
  game.terrain.resetRemote(); // keeps the map as built
  let welcomed = null;
  const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
  /** Link up, say hello, wait for the host's site. Used for the first join and for every way back in. */
  async function connect() {
    await transport.join(code);
    const got = new Promise((res, rej) => { welcomed = (err) => (err ? rej(err) : res()); setTimeout(() => rej(new Error('the host did not answer')), 15000); });
    transport.send({ t: 'hello', was: net.id });
    await got;
  }
  /** The link is gone: keep trying to get back in, a little slower each time, until it works or the page closes. */
  async function rejoin() {
    if (net.rejoining || net.closed) return; net.rejoining = true; net.lost = true;
    for (let wait = 1; !net.closed; wait = Math.min(wait * 2, 8)) {
      try { await connect(); net.rejoins++; net.error = null; break; } catch (e) { net.error = e.message; await sleep(net.full ? 8 : wait); }
    }
    net.rejoining = false;
  }
  net.rejoin = rejoin;
  transport.onLeave = () => { net.lost = true; rejoin(); };
  transport.onMessage = (msg) => {
    if (msg.t === 'full') { net.full = msg.max; welcomed?.(new Error(`the room is full (${msg.max} players)`)); return; }
    if (msg.t === 'welcome') {
      if (net.id) game.terrain.resetRemote(); // coming back: start again from the map as built, the host may have reloaded
      net.id = msg.id; game.terrain.applyRemote(msg.terrain); if (msg.water) game.terrain.applyRemoteWater(msg.water);
      net.lastSnap = now(); net.lost = false; net.seatT = 0; welcomed?.();
      if (S.player.machine) transport.send({ t: 'sit', m: S.player.machine.id }); // back after a drop: the host freed the seat, ask for it again
    }
    else if (msg.t === 'snap') {
      const t = now(); net.lastSnap = t; net.lost = false;
      for (const id in msg.machines) { const s = msg.machines[id], m = game.machine(id); if (!m) continue; net.buffers.get(id).push(msg.time, t, s); net.drivers[id] = s.d; if (s.d !== net.id) setCtlValues(m, s.c); if (s.ev) for (const e of s.ev) m.voice.play(e); }
      net.poses.push(msg.time, t, msg.players); if (msg.tools) net.tools = msg.tools;
      const back = msg.echo?.[net.id]; if (back) { const r = Math.max(0, t - back); net.rtt = net.rtt == null ? r : net.rtt + (r - net.rtt) * 0.1; if (net.own) net.own.rtt = Math.min(0.5, net.rtt); }
      const c = msg.clods; for (let i = 0; i < c.length; i += 8) game.clods.spawn(c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5], c[i + 6], c[i + 7]);
      if (msg.jobs && S.checklist) msg.jobs.forEach((d, i) => { if (d) S.checklist.items[i].done = true; });
    } else if (msg.t === 'terrain') game.terrain.applyRemote(msg.d);
    else if (msg.t === 'water') game.terrain.applyRemoteWater(msg.d);
    else if (msg.t === 'cont') for (const key in msg.c) { const r = rigByKey.get(key); if (!r) continue; const p = msg.c[key], f = r.field; for (let k = 0; k < f.fill.length; k++) { f.fill[k] = p.f[k] / 100; f.mat[k] = p.m[k]; } f.dirty = true; }
  };
  for (let k = 0; ; k++) { try { await connect(); break; } catch (e) { if (k >= 2) throw e; await sleep(2); } } // three tries before giving up on a first join
  addEventListener('pagehide', () => { net.closed = true; });

  const tmp = { b: [], f: [], w: [], e: [] }, own = net.own = new OwnMachine();
  game.frameUpdaters.push((dt) => {
    const t = now(), seat = S.player.machine, driving = seat && !net.lost && net.drivers[seat.id] === net.id;
    if (!driving) own.reset();
    for (const m of game.machines) { // pose every machine from the host's states
      if (driving && m === seat && net.predict !== false) { const p = own.step(net.buffers.get(m.id), t, m, dt); if (p) m.applyNet(p, dt); continue; } // the one you drive: drawn ahead, where it is now (predict.js)
      const br = net.buffers.get(m.id).bracket(t); if (!br) continue;
      const { a, b, k } = br; tmp.b.length = a.b.length;
      for (let i = 0; i < a.b.length; i += 7) { for (let q = 0; q < 3; q++) tmp.b[i + q] = a.b[i + q] + (b.b[i + q] - a.b[i + q]) * k; nlerpQuat(a.b, b.b, k, tmp.b, i + 3); }
      tmp.f.length = a.f.length; lerpArr(a.f, b.f, k, tmp.f); tmp.w = b.w; tmp.e = b.e;
      m.applyNet(tmp, dt);
    }
    const pr = net.poses.bracket(t);
    if (pr) {
      for (const id in pr.b) { // the other players
        if (id === net.id) continue;
        let a = net.avatars.get(id); if (!a) net.avatars.set(id, a = new Avatar(game.scene, id, (x, z) => game.terrain.heightAt(x, z)));
        a.update(pr.b[id], dt);
      }
      // anyone the host no longer lists has gone (or come back under a new id): with three or more, the other
      // clients' figures used to stay standing where they were last seen
      for (const [id, a] of net.avatars) if (!(id in pr.b)) { a.dispose(); net.avatars.delete(id); }
    }
    // someone else got the seat first: get out
    const mine = S.player.machine;
    if (mine && !net.lost && net.drivers[mine.id] && net.drivers[mine.id] !== net.id) { if ((net.seatT += dt) > 1) { S.stand(); S.input.hands.left.pulse(0.8, 80); S.input.hands.right.pulse(0.8, 80); } }
    else net.seatT = 0; // only a steady second of someone else in the seat counts, not moments added up over a session
    // hand tools: the host's state for all but what this player carries; a tool someone else got first is let go
    if (S.tools && net.tools) {
      S.tools.applyNet(net.tools, net.id, dt);
      const lost = S.tools.all.find((x) => x.holders.length && x.remote);
      if (lost && (net.toolT += dt) > 0.5) { for (const side of ['left', 'right']) if (S.inter.state[side].held === lost) S.inter._drop(S.input.hands[side], S.inter.state[side]); S.input.hands.right.pulse(0.8, 80); }
      if (!lost) net.toolT = 0;
    }
    // Nothing from the host: after 4 s say hello again down the same link (the host may only have timed us out);
    // after 10 s take the link for dead and make a new one.
    const quiet = t - net.lastSnap;
    if (quiet > 4) {
      net.lost = true;
      if (!net.rejoining) { if (quiet > 10) rejoin(); else if (t - net.helloT > 2) { net.helloT = t; transport.send({ t: 'hello', was: null }); } }
    }
    net.acc += dt; if (net.acc < NET_DT) return; net.acc = Math.min(net.acc - NET_DT, NET_DT);
    transport.send({ t: 'pose', p: localPose(game, S), ct: t });
    if (mine) transport.send({ t: 'inp', m: mine.id, inp: { ...mine.inp }, c: ctlValues(mine) });
    if (S.tools) S.tools.all.forEach((x, i) => { if (x.holders.length && !x.remote) transport.send({ t: 'tool', i, p: toolPose(x), trig: x.hand?.trigger || 0 }); });
  });
  // a tool put down: tell the host where it was let go (before it settles here), so it lands in the same place there
  const toolPose = (x) => { const a = x.root.position, q = x.root.quaternion; return [a.x, a.y, a.z, q.x, q.y, q.z, q.w]; };
  net.toolT = 0;
  S.tools?.all.forEach((x, i) => { const end = x.grabEnd.bind(x); x.grabEnd = (hand) => { const p = toolPose(x), mine = !x.remote; end(hand); if (mine && !x.holders.length) { x.putDown = true; transport.send({ t: 'tool', i, p, drop: true }); } }; });
  // the line switched here (the trigger with a stake in hand): tell the host, and keep it so until the host has it too
  if (S.tools) for (const st of S.tools.stakes) st.onTrigger = () => { const L = S.tools.line, on = !L.slope; L.setSlope(on); L.mineUntil = performance.now() + 1000; transport.send({ t: 'slope', on }); };
  // seats go through the host
  const sit = S.sit, stand = S.stand;
  S.sit = (m) => { const d = net.drivers[m.id]; if (d && d !== net.id) { S.input.hands.left.pulse(0.8, 80); S.input.hands.right.pulse(0.8, 80); return; } net.seatT = 0; sit(m); transport.send({ t: 'sit', m: m.id }); };
  S.stand = () => { stand(); transport.send({ t: 'stand' }); };
  return net;
}
