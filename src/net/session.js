// Two-player co-op (spec §6), host-authoritative:
//   host    runs the terrain worker and all machine physics; sends machine states and poses at 20 Hz, terrain deltas at
//           10 Hz, container contents at 5 Hz, the river at 1 Hz, and clod spawn events (clients fly them cosmetically)
//   client  builds the same starting map, draws interpolated host state 0.12 s behind, and sends its head/hand pose and
//           the inputs of the machine it is sitting in. The host decides who drives what: first to sit gets the seat.
// Message shapes and rates follow SWVR's protocol (src/net/protocol.ts, hostSession.ts, clientSession.ts).
import { TerrainDeltaWriter, encodeWater } from './terrainDelta.js';
import { SnapshotBuffer, lerpArr, nlerpQuat } from './snapshot.js';
import { Avatar } from './avatar.js';

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
  const net = S.net = { role: 'host', code, transport, peers: new Map(), avatars: new Map(), acc: 0, n: 0, clods: [], sentRev: new Map() };
  const writer = new TerrainDeltaWriter(game.terrain); game.terrain.onChunks((c) => writer.markChunks(c));
  // record clod spawns for the clients
  const spawn = game.clods.spawn.bind(game.clods);
  game.clods.spawn = (x, y, z, vx, vy, vz, mat, vol) => { if (net.peers.size && net.clods.length < 8 * 250) net.clods.push(x, y, z, vx, vy, vz, mat, vol); spawn(x, y, z, vx, vy, vz, mat, vol); };

  transport.onPeer = (id) => { net.peers.set(id, { pose: null, last: now() }); };
  transport.onLeave = (id) => drop(id);
  function drop(id) { net.peers.delete(id); net.avatars.get(id)?.dispose(); net.avatars.delete(id); for (const m of game.machines) if (m.driver === id) { m.driver = null; m.remoteInp = null; } }
  transport.onMessage = (msg, from) => {
    const peer = net.peers.get(from); if (!peer) return; peer.last = now();
    if (msg.t === 'hello') {
      const w = game.terrain.water;
      transport.send({ t: 'welcome', id: from, map: game.terrain.mapName, terrain: writer.full(), water: w ? encodeWater(w) : null }, from);
      for (const r of game.rigs) net.sentRev.delete(r.key); // resend every container to the newcomer
    } else if (msg.t === 'pose') peer.pose = msg.p;
    else if (msg.t === 'sit') { const m = game.machine(msg.m); for (const x of game.machines) if (x.driver === from) x.driver = null; if (m && !m.driver) m.driver = from; }
    else if (msg.t === 'stand') { for (const m of game.machines) if (m.driver === from) { m.driver = null; m.remoteInp = null; } }
    else if (msg.t === 'inp') { const m = game.machine(msg.m); if (m && m.driver === from) { m.remoteInp = msg.inp; setCtlValues(m, msg.c); } } // inputs from anyone but the driver are ignored
  };
  game.frameUpdaters.push((dt) => {
    for (const [id, peer] of net.peers) { // draw the other player; drop anyone silent for 12 s (a headset taken off rarely closes the link)
      if (now() - peer.last > 12) { drop(id); continue; }
      let a = net.avatars.get(id); if (!a) net.avatars.set(id, a = new Avatar(game.scene));
      a.update(peer.pose, dt);
    }
    net.acc += dt; if (net.acc < NET_DT) return; net.acc = Math.min(net.acc - NET_DT, NET_DT); net.n++;
    if (!net.peers.size) { net.clods.length = 0; writer.dirty.size > 4000 && writer.dirty.clear(); return; }
    const machines = {}; for (const m of game.machines) machines[m.id] = { ...m.netState(), d: m.driver === 'local' ? 'host' : m.driver, c: ctlValues(m), ev: m.netEvents?.splice(0) };
    const players = { host: localPose(game, S) }; for (const [id, p] of net.peers) players[id] = p.pose;
    transport.send({ t: 'snap', time: now(), machines, players, clods: net.clods.splice(0), jobs: S.checklist ? S.checklist.items.map((i) => i.done) : null });
    if (net.n % 2 === 0) { const d = writer.delta(); if (d) transport.send({ t: 'terrain', d }); }
    if (net.n % 4 === 0) { const c = {}; let any = false; for (const r of game.rigs) { const rev = r.field.rev || 0; if (net.sentRev.get(r.key) !== rev) { net.sentRev.set(r.key, rev); c[r.key] = packField(r.field); any = true; } } if (any) transport.send({ t: 'cont', c }); }
    if (net.n % 20 === 0 && game.terrain.water) transport.send({ t: 'water', d: encodeWater(game.terrain.water) });
  });
  return net;
}

// ------------------------------------------------------------------ client
export async function startClient(game, S, transport, code) {
  S.THREE = game.THREE;
  const net = S.net = { role: 'client', code, transport, id: null, buffers: new Map(), avatars: new Map(), poses: new SnapshotBuffer(), acc: 0, lost: false, lastSnap: now(), drivers: {} };
  for (const m of game.machines) net.buffers.set(m.id, new SnapshotBuffer());
  const rigByKey = new Map(game.rigs.map((r) => [r.key, r]));
  game.clods.setTargets({ heightAt: (x, z) => game.terrain.heightAt(x, z), deposit() {} }, []); // clods are scenery here: the host's terrain is the truth
  let welcomed; const ready = new Promise((r) => { welcomed = r; });
  transport.onLeave = () => { net.lost = true; };
  transport.onMessage = (msg) => {
    if (msg.t === 'welcome') { net.id = msg.id; game.terrain.applyRemote(msg.terrain); if (msg.water) game.terrain.applyRemoteWater(msg.water); welcomed(); }
    else if (msg.t === 'snap') {
      const t = now(); net.lastSnap = t; net.lost = false;
      for (const id in msg.machines) { const s = msg.machines[id], m = game.machine(id); if (!m) continue; net.buffers.get(id).push(msg.time, t, s); net.drivers[id] = s.d; if (s.d !== net.id) setCtlValues(m, s.c); if (s.ev) for (const e of s.ev) m.voice.play(e); }
      net.poses.push(msg.time, t, msg.players);
      const c = msg.clods; for (let i = 0; i < c.length; i += 8) game.clods.spawn(c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5], c[i + 6], c[i + 7]);
      if (msg.jobs && S.checklist) msg.jobs.forEach((d, i) => { if (d) S.checklist.items[i].done = true; });
    } else if (msg.t === 'terrain') game.terrain.applyRemote(msg.d);
    else if (msg.t === 'water') game.terrain.applyRemoteWater(msg.d);
    else if (msg.t === 'cont') for (const key in msg.c) { const r = rigByKey.get(key); if (!r) continue; const p = msg.c[key], f = r.field; for (let k = 0; k < f.fill.length; k++) { f.fill[k] = p.f[k] / 100; f.mat[k] = p.m[k]; } f.dirty = true; }
  };
  await transport.join(code);
  transport.send({ t: 'hello' });
  await Promise.race([ready, new Promise((_, rej) => setTimeout(() => rej(new Error('the host did not answer')), 15000))]);

  const tmp = { b: [], f: [], w: [], e: [] };
  game.frameUpdaters.push((dt) => {
    const t = now();
    for (const m of game.machines) { // pose every machine from the host's states
      const br = net.buffers.get(m.id).bracket(t); if (!br) continue;
      const { a, b, k } = br; tmp.b.length = a.b.length;
      for (let i = 0; i < a.b.length; i += 7) { for (let q = 0; q < 3; q++) tmp.b[i + q] = a.b[i + q] + (b.b[i + q] - a.b[i + q]) * k; nlerpQuat(a.b, b.b, k, tmp.b, i + 3); }
      tmp.f.length = a.f.length; lerpArr(a.f, b.f, k, tmp.f); tmp.w = b.w; tmp.e = b.e;
      m.applyNet(tmp, dt);
    }
    const pr = net.poses.bracket(t);
    if (pr) for (const id in pr.b) { // the other players
      if (id === net.id) continue;
      let a = net.avatars.get(id); if (!a) net.avatars.set(id, a = new Avatar(game.scene, id === 'host' ? 0xd0562f : 0x2f8fd0));
      a.update(pr.b[id], dt);
    }
    // someone else got the seat first: get out
    const mine = S.player.machine; if (mine && net.drivers[mine.id] && net.drivers[mine.id] !== net.id && (net.seatT += dt) > 1) { S.stand(); S.input.hands.left.pulse(0.8, 80); S.input.hands.right.pulse(0.8, 80); }
    if (t - net.lastSnap > 4) net.lost = true;
    net.acc += dt; if (net.acc < NET_DT) return; net.acc = Math.min(net.acc - NET_DT, NET_DT);
    transport.send({ t: 'pose', p: localPose(game, S) });
    if (mine) transport.send({ t: 'inp', m: mine.id, inp: { ...mine.inp }, c: ctlValues(mine) });
  });
  // seats go through the host
  const sit = S.sit, stand = S.stand;
  S.sit = (m) => { const d = net.drivers[m.id]; if (d && d !== net.id) { S.input.hands.left.pulse(0.8, 80); S.input.hands.right.pulse(0.8, 80); return; } net.seatT = 0; sit(m); transport.send({ t: 'sit', m: m.id }); };
  S.stand = () => { stand(); transport.send({ t: 'stand' }); };
  return net;
}
