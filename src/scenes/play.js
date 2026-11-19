// The playable scene: machines with physical cab controls, the player on foot or seated, sound and haptics,
// plus the desktop keyboard debug path.
import * as THREE from 'three';
import { DEFS } from '../../machines/index.js';
import { Physics } from '../vehicles/physics.js';
import { Machine } from '../vehicles/machine.js';
import { XRInput, stickOf } from '../xr/input.js';
import { MouseHand } from '../xr/mouseHand.js';
import { InteractionSystem } from '../xr/interaction.js';
import { Hands } from '../xr/hands.js';
import { Player } from '../xr/player.js';
import { makeControl } from '../xr/controls/index.js';
import { buildDecor } from '../xr/controls/decor.js';
import { AudioBus, MachineVoice, renderEngine } from '../audio/machineAudio.js';
import { clamp } from '../util/rng.js';
import * as autopilot from '../game/autopilot.js';
import { PushHeap } from '../render/pushHeap.js';
import { Avatar } from '../net/avatar.js';
import { HandTools } from '../game/handTools.js';
import { makeHopper } from '../game/hopper.js';
import { makeChecklist, Clipboard } from '../game/checklist.js';
import { PadJob, JobBoard } from '../game/jobs.js';
import { startStress } from './stress.js';
import { Rams } from '../render/rams.js';
import { ParkedMachines } from '../render/parked.js';
import { Particles } from '../render/particles.js';
import { Effects } from '../game/effects.js';
import { PAINT_U } from '../vehicles/machine.js';

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();

export async function setup(game, { kinds = Object.keys(DEFS) } = {}) {
  const { terrain, scene } = game, map = terrain.map;
  const phys = await Physics.create(), input = new XRInput(game.renderer, game.rig), inter = new InteractionSystem(scene);
  const hands = new Hands(scene), player = new Player(game, input), bus = new AudioBus(), mouse = new MouseHand(game, input, inter);
  const machines = [], keys = new Set();
  const S = { phys, input, inter, hands, player, bus, machines, keys, mouse, chase: false, look: { yaw: 0, pitch: -0.15 }, renderEngine };

  for (const kind of kinds) {
    const def = DEFS[kind]; if (!map.spawn[kind]) continue;
    const [x, z, yaw] = map.spawn[kind];
    const m = phys.add(new Machine(def, phys, terrain, { id: kind, x, z, yaw }));
    scene.add(m.root);
    for (const c of Object.values(m.containers)) game.addContainer(c.rig, c.obj);
    m.voice = new MachineVoice(bus, def.engine);
    m.override = {}; m.controls = {}; m.joyFns = new Set();
    for (const d of def.controls || []) {
      const c = makeControl(d); m.nodes[d.parent].add(c.root); m.controls[d.name] = c;
      if (d.type === 'joystick') { m.joyFns.add(d.x[0]); m.joyFns.add(d.y[0]); }
      if (d.type === 'handrail') c.onGrab = () => { if (player.machine !== m) S.sit(m); };
      if (d.type === 'handrail') (m.rails ??= []).push(c);
      if (d.out === 'recentre') c.onChange = () => { if (c.value) player.recentre(); };
      if (d.out === 'horn') c.onChange = () => { if (c.value) { bus.start(); m.voice.horn(); } };
      if (d.out === 'exit') c.onChange = () => { if (c.value && player.machine === m) S.stand(); };
    }
    inter.add(Object.values(m.controls));
    const placard = []; // the trigger reminder used to hang on the windscreen frame; it was in the way (it is in the help panel instead)
    m.controlRoots = Object.values(m.controls).map((c) => c.root).concat(buildDecor(Object.values(m.controls), placard));
    machines.push(m);
  }
  const rams = new Rams(scene, machines);
  const fx = S.fx = new Effects(game, new Particles(scene, game.env), machines);
  { const dep = terrain.deposit.bind(terrain); terrain.deposit = (x, z, m, v) => { dep(x, z, m, v); fx.landed(x, z, m); }; } // dust where tipped material lands
  const shadows = [], lamps = []; let fxTime = 0;
  S.setLighting = (name) => { game.env.apply(name); if (!S.stress) game.hud.note = `LIGHT: ${game.env.name.toUpperCase()}`; };
  game.machines = machines; game.play = S; game.autopilot = autopilot;
  game.machine = (id) => machines.find((m) => m.id === id);

  // the jobs: the site-office pad to level (game/jobs.js), then the MVP checklist; the current one on a clipboard in every cab
  if (map.hopper) {
    S.hopper = makeHopper(game, phys, map.hopper);
    S.checklist = makeChecklist(game, { machines, hopper: S.hopper, map });
    S.checklist.onTick = () => { for (const s of ['left', 'right']) input.hands[s].pulse(0.9, 150); };
    if (map.pad) { S.padJob = new PadJob(game, phys, map.pad); S.padJob.onDone = (j) => { for (const s of ['left', 'right']) input.hands[s].pulse(1, 300); game.hud.note = `PAD DONE: GRADE ${j.grade}`; }; }
    S.board = new JobBoard(S.padJob ? [S.padJob, S.checklist] : [S.checklist]);
    for (const m of machines) {
      const e = m.seatDef.eye, cb = new Clipboard({ name: 'clipboard', pos: [e[0] - 0.5, e[1] - 0.45, e[2] - 0.62], rot: [-0.5, 0.45, 0] }, S.board.texture);
      m.nodes[m.seatDef.node].add(cb.root); m.controls.clipboard = cb; m.controlRoots.push(cb.root); inter.add([cb]);
    }
  }
  // two vehicle models to compare back to back: the hand-written one (default) and Rapier rigid bodies
  S.physics = 'rapier';
  S.setPhysics = (mode) => { S.physics = mode; for (const m of machines) m.setPhysics(mode); if (!S.stress) game.hud.note = `PHYSICS: ${mode.toUpperCase()}`; setHelp(); };
  S.stress = null;
  S.setStress = (v) => { if (game.remote) return; if (v && !S.stress) { for (const m of machines) m.override = {}; S.stress = startStress(game); } else if (!v && S.stress) { S.stress.stop(); S.stress = null; } game.hud.note = v ? 'STRESS: scripted machines + clod fountain' : ''; };

  // dash display: one canvas, shown in whichever cab the player is in
  const dashC = document.createElement('canvas'); dashC.width = 256; dashC.height = 128;
  const dashT = new THREE.CanvasTexture(dashC), dash = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshBasicMaterial({ map: dashT }));
  dash.visible = false; let dashTimer = 0;
  function drawDash(m) {
    const c = dashC.getContext('2d'), e = m.engine;
    c.fillStyle = '#10161a'; c.fillRect(0, 0, 256, 128); c.strokeStyle = '#ffb21a'; c.lineWidth = 3; c.strokeRect(2, 2, 252, 124);
    c.fillStyle = '#ffd25a'; c.font = 'bold 22px monospace';
    c.fillText(`${(Math.abs(m.speed) * 3.6).toFixed(0).padStart(2)} km/h  ${m.gear > 0 ? 'F' : m.gear < 0 ? 'R' : 'N'}${m.range.high ? '2' : '1'}${m.inp.park > 0.5 ? '  (P)' : ''}`, 12, 30);
    if (m.gradeOn) { c.fillStyle = '#9fe08a'; c.font = 'bold 15px monospace'; c.fillText('AUTO LEVEL', 150, 122); c.fillStyle = '#ffd25a'; c.font = 'bold 22px monospace'; }
    c.fillText(e.running ? `${e.rpm.toFixed(0)} rpm` : e.crank > 0 ? 'cranking…' : 'ENGINE OFF', 12, 58);
    c.fillStyle = '#9fd4ff'; c.font = 'bold 15px monospace'; c.fillText(S.physics === 'custom' ? 'CUSTOM PHYSICS' : 'RAPIER PHYSICS', 12, 122); c.fillStyle = '#ffd25a'; c.font = 'bold 22px monospace';
    if (S.net) { c.fillStyle = S.net.lost ? '#ff7a5a' : '#9fd4ff'; c.font = 'bold 16px monospace'; c.fillText(S.net.lost ? 'RECONNECTING' : `ROOM ${S.net.code}`, 150, 58); c.fillStyle = '#ffd25a'; }
    const load = m.payload(), cap = m.rigs.reduce((s, r) => s + r.field.capacity, 0);
    if (cap) { c.fillStyle = '#2b3a40'; c.fillRect(12, 70, 232, 12); c.fillStyle = '#c98a3a'; c.fillRect(12, 70, 232 * clamp(load / cap, 0, 1), 12);
      c.fillStyle = '#9fe08a'; c.font = 'bold 18px monospace'; c.fillText(`LOAD ${load.toFixed(2)} m³`, 12, 108); }
    dashT.needsUpdate = true;
  }

  function sit(m) {
    if (m.driver && m.driver !== 'local') { input.hands.left.pulse(0.8, 80); input.hands.right.pulse(0.8, 80); return; } // the other player is in it
    inter.releaseAll(input.hands); player.sit(m); S.look.yaw = 0; S.look.pitch = -0.15;
    // up in the top right corner of the windscreen, clear of the wheel and the view of the work
    const d = m.def.display || { parent: m.seatDef.node, pos: [m.seatDef.eye[0] + 0.5, m.seatDef.eye[1] + 0.33, m.seatDef.eye[2] - 0.78], rot: [0.35, -0.45, 0] };
    m.nodes[d.parent].add(dash); dash.position.fromArray(d.pos); dash.rotation.fromArray(d.rot); dash.visible = true; drawDash(m);
    setHelp();
  }
  function stand() { inter.releaseAll(input.hands); player.stand(); dash.visible = false; setHelp(); }
  S.sit = sit; S.stand = stand;

  // ---- inputs → machine
  function readControls(m) {
    const inp = m.inp;
    for (const f of m.joyFns) inp[f] = 0;
    for (const c of Object.values(m.controls)) {
      const d = c.def;
      if (d.type === 'joystick') { inp[d.x[0]] += c.value.x * d.x[1]; inp[d.y[0]] += c.value.y * d.y[1]; }
      else if (d.out && d.type !== 'button' && d.type !== 'handrail') inp[d.out] = d.map ? d.map[0] + c.value * (d.map[1] - d.map[0]) : c.value * (d.sign ?? 1);
    }
    inp.accel = 0; inp.brake = 0; inp.decel = 0;
    if (player.machine === m) {
      const { left, right } = input.hands, tracks = m.def.drive.type === 'tracks';
      // feet aren't tracked: triggers are the pedals while that hand is on a control
      if (right.tracked && right.holding) inp.accel = right.trigger;
      if (left.tracked && left.holding) { if (tracks) inp.decel = left.trigger; else inp.brake = left.trigger; }
      // thumbsticks work the implements too, so a hand on the wheel can still lift the boom (the levers still work)
      const rear = m.fn.swivel && m.fn.swivel.pos > 1.5, map = (rear ? m.def.sticksRear : m.def.sticks) || {};
      for (const [h, key] of [[left, 'left'], [right, 'right']]) {
        const sm = map[key]; if (!sm || !h.tracked || (key === 'left' && inp.assist > 0.5 && !rear)) continue; // with stick assist on, the left stick drives instead
        const [sx, sy] = stickOf(h), turns = key === 'left' && !rear; // facing forward, the left stick's sideways push turns you in the seat instead (xr/player.js)
        if (sm.x && sx && !turns) inp[sm.x[0]] = clamp((inp[sm.x[0]] || 0) + sx * sm.x[1], -1, 1);
        if (sm.y && sy) inp[sm.y[0]] = clamp((inp[sm.y[0]] || 0) + sy * sm.y[1], -1, 1);
      }
      // Backhoe pattern. The hoe's joysticks and stick maps are written in the ISO (excavator) pattern: left hand swing
      // and dipper, right hand boom and bucket. Backhoe loaders traditionally use the SAE pattern, which swaps boom
      // and dipper between the hands (left: swing and boom; right: dipper and bucket), so that is the default; the
      // ISO PATTERN switch in the cab puts it back. The desktop keys are named for what they move and are not swapped.
      const hs = m.def.handSwap;
      if (hs && !(inp.pattern > 0.5)) { const v = inp[hs[0]]; inp[hs[0]] = inp[hs[1]]; inp[hs[1]] = v; }
      if (inp.assist > 0.5 || (!game.renderer.xr.isPresenting && (keys.size || pad.on))) assist(m, left, right);
    }
    if (m.driver && m.driver !== 'local' && m.remoteInp) Object.assign(inp, m.remoteInp); // co-op: the other player is driving this one
    Object.assign(inp, m.override);
  }
  // ---- gamepad on the desktop (standard / Xbox layout). Sticks as stickOf gives them: x right, y forward.
  const pad = S.pad = { on: false, fwd: 0, brake: 0, l: [0, 0], r: [0, 0], prev: [], fake: null };
  function pollPad() {
    const g = pad.fake || (navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected && p.mapping === 'standard') : null);
    pad.on = !!g && !game.renderer.xr.isPresenting;
    if (!pad.on) { pad.fwd = pad.brake = 0; pad.l[0] = pad.l[1] = pad.r[0] = pad.r[1] = 0; return; }
    const dz = (v = 0) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85), b = (i) => g.buttons[i]?.value ?? 0;
    const hit = (i) => { const d = b(i) > 0.5, was = pad.prev[i]; pad.prev[i] = d; return d && !was; };
    pad.l[0] = dz(g.axes[0]); pad.l[1] = -dz(g.axes[1]); pad.r[0] = dz(g.axes[2]); pad.r[1] = -dz(g.axes[3]);
    pad.fwd = b(7) - b(6); pad.brake = 0; // (LT brakes while rolling forward, then reverses: see assist)
    // Farming Simulator's layout (FS22/FS25 defaults): RT go, LT brake / reverse, left stick steer, right stick look, right
    // stick click switches camera, X in / out, Y switches control group, d-pad ◀ ▶ previous / next vehicle, ▲ ▼ zoom,
    // Menu the menu, hold LB for the implement. The engine starts and the park brake comes off when you pull away.
    // seated, the right stick looks round (the chase camera orbits the machine); held with LB it works the implement instead
    const lb = b(4) > 0.5, now = performance.now();
    if (lb && !pad.lb) { pad.lbAt = now; pad.lbUsed = false; }
    if (player.machine && (pad.r[0] || pad.r[1])) {
      if (lb) pad.lbUsed = true;
      else { S.look.yaw -= pad.r[0] * 0.045; S.look.pitch = clamp(S.look.pitch + pad.r[1] * 0.03, -1.3, 1.3); pad.r[0] = pad.r[1] = 0; }
    }
    const lbTap = !lb && pad.lb && !pad.lbUsed && now - pad.lbAt < 350; pad.lb = lb; // a short press with no looking is still throttle down
    if (pad.fwd || pad.l[0] || pad.l[1] || g.buttons.some((x) => x.value > 0.5)) bus.start();
    const m = player.machine, seat = (d) => { const i = (machines.indexOf(m) + d + machines.length) % machines.length; if (m) S.stand(); S.sit(machines[m ? i : 0]); };
    if (hit(2)) { if (m) S.stand(); else { let best = machines[0], bd = 1e9; for (const o of machines) { const d = Math.hypot(o.position.x - player.feet.x, o.position.z - player.feet.z); if (d < bd) { bd = d; best = o; } } S.sit(best); } } // X: in / out
    if (hit(15)) seat(1); if (hit(14)) seat(-1);                                                     // d-pad ◀ ▶: previous / next vehicle
    if (hit(9)) { if (game.menu?.open) game.menu.hide(); else game.menu?.show(); }                   // Menu: the menu
    // View held a second: stand the machine back on its wheels (a hold, so it is not done by accident)
    const view = b(8) > 0.5; pad.viewHeld = view ? (pad.viewHeld || 0) + 1 / 60 : 0;
    if (!m) { if (hit(0)) player.crouch(); return; }                                                 // on foot, A crouches
    if (hit(11)) S.chase = !S.chase;                                                                 // right stick click: cab / outside camera
    if (hit(12)) S.zoom = clamp((S.zoom || 1) / 1.25, 0.45, 2.5); if (hit(13)) S.zoom = clamp((S.zoom || 1) * 1.25, 0.45, 2.5); // d-pad ▲ ▼: zoom the outside camera
    if (hit(3) && m.controls.swivel) m.controls.swivel.press(null);                                  // Y: switch control group (the backhoe's seat: loader or hoe)
    if (lb && hit(0)) setCtl(m, 'key', m.controls.key.value > 0.5 ? 0 : 1);                         // LB + A: engine off / on
    else if (hit(0)) m.voice.horn();                                                                 // A: horn
    if (hit(1)) setCtl(m, 'park', m.controls.park.value > 0.5 ? 0 : 1);                              // B: park brake
    if (hit(5)) setCtl(m, 'throttle', clamp(m.controls.throttle.value + 0.25, 0, 1));                // tap RB / LB: hand throttle up / down
    if (lbTap) setCtl(m, 'throttle', clamp(m.controls.throttle.value - 0.25, 0, 1));
    if (hit(10) && m.controls.range) setCtl(m, 'range', m.controls.range.value > 0.5 ? 0 : 1);       // left stick click: travel gear
    if (pad.viewHeld >= 1 && pad.viewHeld - 1 / 60 < 1) { m.upright(); game.hud.note = 'MACHINE STOOD UPRIGHT'; }
    if (pad.fwd) { // pulling away: the engine starts and the park brake comes off, as in Farming Simulator
      if (m.controls.key.value < 0.5) setCtl(m, 'key', 1);
      if (m.controls.park.value > 0.5 && !pad.parkHeld) setCtl(m, 'park', 0);
    }
    pad.parkHeld = b(1) > 0.5;
  }
  const setCtl = (m, name, v) => { const c = m.controls[name]; if (c && !c.held && c.value !== v) c.set(v); };
  const k = (c) => (keys.has(c) ? 1 : 0);
  /** Thumbstick assist (dash toggle, off by default) and the desktop keyboard: both drive without the levers. */
  function assist(m, left, right) {
    const inp = m.inp, vr = game.renderer.xr.isPresenting;
    const rear = m.fn.swivel && m.fn.swivel.pos > 1.5; // backhoe facing its rear controls: the keys work the hoe instead of driving
    let fwd = rear ? 0 : k('KeyW') - k('KeyS'), turn = rear ? 0 : k('KeyD') - k('KeyA');
    if (pad.on) { // gamepad: triggers go and reverse, left stick steers (and drives a tracked machine), right stick works the implement
      const tracks = m.def.drive.type === 'tracks', map = (rear ? m.def.sticksRear : m.def.sticks) || {};
      let pf = pad.fwd; // LT (or RT) against the way it is rolling brakes first; at a stop it drives that way
      if (!tracks && pf && (pf < 0 ? m.speed > 0.4 : m.speed < -0.4)) { pad.brake = Math.abs(pf); pf = 0; }
      if (!rear) { fwd += pf + (tracks ? pad.l[1] : 0); turn += pad.l[0]; }
      for (const [key, st] of [['left', pad.l], ['right', pad.r]]) {
        const sm = map[key]; if (!sm || (key === 'left' && !rear)) continue;
        if (sm.x && st[0]) inp[sm.x[0]] = clamp((inp[sm.x[0]] || 0) + st[0] * sm.x[1], -1, 1);
        if (sm.y && st[1]) inp[sm.y[0]] = clamp((inp[sm.y[0]] || 0) + st[1] * sm.y[1], -1, 1);
      }
    }
    if (vr && left.tracked && inp.assist > 0.5) { const [x, y] = stickOf(left); fwd += y; turn += x; }
    fwd = clamp(fwd, -1, 1); turn = clamp(turn, -1, 1);
    if (m.def.drive.type === 'tracks') {
      const l = clamp(fwd + turn, -1, 1), r = clamp(fwd - turn, -1, 1);
      if (fwd || turn || !m.controls.left?.held) { inp.left = l; inp.right = r; setCtl(m, 'left', l); setCtl(m, 'right', r); }
    } else {
      if (fwd) { const dir = Math.sign(fwd); inp.shuttle = dir; setCtl(m, 'shuttle', dir); inp.accel = Math.max(inp.accel, Math.abs(fwd)); }
      if (turn || !m.controls.steer?.held) { inp.steer = turn; setCtl(m, 'steer', turn); }
      inp.brake = Math.max(inp.brake, k('Space'), pad.brake);
    }
    for (const [fn, pos, neg] of (rear ? m.def.keysRear : m.def.keys) || []) { const v = k(pos) - k(neg); if (v) inp[fn] = v; }
  }

  game.updaters.push((dt) => {
    if (game.remote) { if (player.machine) readControls(player.machine); return; } // co-op client: the host simulates; we only read our own controls
    if (!game.smooth.length) game.smooth = machines.flatMap((m) => m.bodyList.map((b) => b.obj)); // the machines' bodies are drawn smoothly between simulation steps
    for (const m of machines) readControls(m);
    if (S.tools) S.tools.step(dt);
    phys.step(dt);
    for (const m of machines) {
      if (!game.fast) for (const ev of m.events) m.voice.play(ev);
      for (const ev of m.events) if (ev.type === 'churn') { churn(ev); if (Math.abs(ev.hw) > 0.5) heap.kick(ev.tool); }
      if (S.net && S.net.peers.size && m.events.length) { m.netEvents ??= []; if (m.netEvents.length < 20) m.netEvents.push(...m.events.filter((e) => e.type === 'clunk' || e.type === 'clank')); }
      if (player.machine === m) { const amp = Math.min(1, m.digRate * 0.5) + m.bump; if (amp > 0.03) for (const s of ['left', 'right']) if (input.hands[s].holding) input.hands[s].pulse(amp, 30); }
    }
  });

  const heap = S.heap = new PushHeap(terrain); scene.add(heap.mesh);
  /** For looking at the figures without a second player: one standing by the machine, one in its seat (tools/gallery.mjs). */
  S.avatarDemo = (m) => {
    const q = [0, 0, 0, 1], p = m.position, eye = new THREE.Vector3().fromArray(m.seatDef.eye); m.nodes[m.seatDef.node].localToWorld(eye);
    const at = (x, y, z) => [x, y, z, ...q], gx = p.x - 3.2, gz = p.z - 1.5, gy = terrain.heightAt(gx, gz);
    const A = new Avatar(scene, 'host', (x, z) => terrain.heightAt(x, z)), B = new Avatar(scene, 'p2', (x, z) => terrain.heightAt(x, z));
    A.update({ h: at(gx, gy + 1.68, gz), l: at(gx - 0.25, gy + 1.0, gz - 0.2), r: at(gx + 0.3, gy + 1.35, gz - 0.35) }, 1);
    B.update({ h: at(eye.x, eye.y, eye.z), l: at(eye.x - 0.2, eye.y - 0.45, eye.z - 0.45), r: at(eye.x + 0.3, eye.y - 0.5, eye.z - 0.35) }, 1);
    return [A, B];
  };
  // Material being shoved along ahead of a blade or a full bucket: a bed of granules riding the heap (render/pushHeap.js), and a few chunks thrown up along the cutting edge.
  // They carry no volume (the soil itself is already heaped on the ground ahead); they are there so you can see it move.
  // Chunks come off new ground being cut, not off a heap that is only being shoved along again (docs/blade-soil.md). A
  // blade pressed into a face standing near its own height (a pile) breaks lumps off it that roll back down onto the
  // blade, with a puff of dust: soil driven into is not thrown forward.
  const tall = new WeakMap();
  function churn(ev) {
    if (game.fast) return;
    const r = Math.random, sp = Math.hypot(ev.vx, ev.vz) || 1, fx = ev.vx / sp, fz = ev.vz / sp, m = terrain.materialAt(ev.x + fx * 0.5, ev.z + fz * 0.5) || 1;
    const n = Math.min(3, Math.ceil(ev.fresh / 0.006));
    for (let k = 0; k < n; k++) {
      const a = (r() * 2 - 1) * ev.hw, lift = ev.full ? 2.2 : 1.4;
      game.clods.spawn(ev.x + ev.ax * a + fx * 0.25, ev.y + 0.15 + r() * 0.35, ev.z + ev.az * a + fz * 0.25,
        ev.vx * 1.15 + (r() - 0.5) * 1.2, lift + r() * 1.6, ev.vz * 1.15 + (r() - 0.5) * 1.2, m, 0);
    }
    if (!(ev.top > 0)) return;
    const was = tall.get(ev.tool) ?? ev.face, jump = Math.max(0, ev.face - was); tall.set(ev.tool, ev.face);
    if (ev.face > ev.top * 0.8 && r() < 0.18 + jump * 3) { // lumps off the face above the blade, rolling back toward it
      const a = (r() * 2 - 1) * ev.hw * 0.8, y = ev.y + ev.face + 0.1;
      game.clods.spawn(ev.x + ev.ax * a + fx * (0.5 + r() * 0.4), y, ev.z + ev.az * a + fz * (0.5 + r() * 0.4), ev.vx * 0.9 - fx * (0.5 + r() * 0.6), 0.3 + r() * 0.5, ev.vz * 0.9 - fz * (0.5 + r() * 0.6), m, 0);
    }
    if (jump > 0.08) S.fx.puff(ev.x + fx * 0.6, ev.y + Math.min(ev.face, ev.top), ev.z + fz * 0.6, ev.hw, m, Math.min(1, jump * 4)); // the face hit: a puff of dust off it
  }

  // ---- per frame: hands, interaction, player, camera, audio, HUD
  const hudHolder = new THREE.Group(); scene.add(hudHolder); game.hud.attachTo(hudHolder);
  game.frameUpdaters.push((fdt) => {
    mouse.update(); input.update(); pollPad();
    inter.update(input.hands, fdt);
    const { left, right } = input.hands;
    if (left.primaryPressed) game.hud.toggle();
    if (left.secondaryPressed && player.seated) S.stand();
    if (right.secondaryPressed) player.recentre();
    if (right.stickPressed && player.seated && !right.holding) { player.horizonLock = player.horizonLock ? 0 : 0.8; game.hud.note = player.horizonLock ? 'HORIZON LOCK ON (right stick click)' : ''; right.pulse(0.5, 40); } // comfort: damp cab roll and pitch
    if (right.primaryPressed && player.machine) { bus.start(); player.machine.voice.horn(); }
    if (right.primaryPressed && !player.machine && !right.holding) { const c = player.crouch(); game.hud.note = c ? 'CROUCHING (A to stand up)' : ''; right.pulse(0.4, 30); } // on foot: get down to the chain hooks and stakes
    player.noSeatTurn = !!player.machine && (player.machine.inp.assist > 0.5 || (player.machine.fn.swivel && player.machine.fn.swivel.pos > 1.5)); // the left stick is busy driving, or working the hoe
    player.update(fdt, input.hands);
    if (!game.fast) heap.update(fdt);
    for (const m of machines) m.animateCap(Math.min(fdt, 0.05), game.simTime);
    desktopCamera();
    scene.updateMatrixWorld();
    hands.update(input.hands, fdt);
    rams.update();
    // lighting that follows the machines: a pool of shade under each half, headlamp pools at dusk, lamps and beacons
    shadows.length = 0; lamps.length = 0;
    for (const m of machines) {
      for (const b of m.bodyList) { const c = b.def.colliders?.[0]; if (!c) continue; b.obj.localToWorld(_p.set(c.pos[0], 0, c.pos[2])); shadows.push({ x: _p.x, z: _p.z, r: Math.max(c.size[0], c.size[2]) * 0.62 }); }
      if (m.engine.running) { const lead = m.bodyList[m.bodyList.length - 1].obj; _f.set(0, 0, -1).applyQuaternion(lead.quaternion); _f.y = 0; _f.normalize(); lead.localToWorld(_p.set(0, 1.5, m.joints[0] ? m.joints[0].def.anchor[2] - 2.2 : -2.2)); lamps.push({ x: _p.x, z: _p.z, dx: _f.x, dz: _f.z }); }
    }
    game.ground.setMachineLighting(shadows, lamps);
    fxTime += fdt; PAINT_U.uTime.value = fxTime; PAINT_U.uLampOn.value = game.env.lamps.value;
    fx.update(fdt);
    if (right.stickPressed && !player.seated) S.setLighting(game.env.next());
    hudHolder.visible = left.tracked; if (left.tracked) { hudHolder.position.copy(left.pos); hudHolder.quaternion.copy(left.quat); }
    if (bus.ctx) {
      game.camera.getWorldPosition(_p); game.camera.getWorldDirection(_f); _u.set(0, 1, 0).applyQuaternion(game.camera.getWorldQuaternion(_q));
      bus.setListener(_p, _f, _u);
      if (map.riverZ) { const rx = clamp(_p.x, terrain.ox, terrain.ox + terrain.nx * terrain.cell); bus.river({ x: rx, y: 0, z: map.riverZ(rx) }); }
      for (const m of machines) { const s = m.audioState(); if (m.tools[0]) { m.tools[0].node.getWorldPosition(_p); s.digMat = terrain.materialAt(_p.x, _p.z); } s.cab = player.machine === m; m.voice.drive(s, m.position); }
    }
    if (player.machine && (dashTimer += fdt) > 0.25) { dashTimer = 0; drawDash(player.machine); }
    if (S.checklist && game.frame % 15 === 0) { S.checklist.update(fdt * 15); S.hopper.update(); S.padJob?.update(fdt * 15, { authority: !game.remote }); S.board.update(fdt * 15); }
    // Left stick held in for a second, seated: stand this machine back on its wheels where it is. (A click used to
    // switch the physics model when seated and start the demo drivers on foot: far too easy to do by accident. Both
    // are on the start page now.) A hold, not a click, because the stick is clicked by accident while pushing it.
    const lsDown = !!left._prev?.stick && player.seated && !left.holding && !game.remote;
    S.resetHold = lsDown ? (S.resetHold || 0) + fdt : 0;
    if (lsDown && S.resetHold >= 1 && S.resetHold - fdt < 1) { player.machine.upright(); game.hud.note = 'MACHINE STOOD UPRIGHT'; left.pulse(0.9, 120); }
    // cab controls and their labels are many small draw calls: only draw them for machines within reach (handrails always: they are how you find the way in)
    if (game.frame % 20 === 0) { game.camera.getWorldPosition(_p); for (const m of machines) { const near = m.position.distanceToSquared(_p) < 64; for (const r of m.controlRoots) r.visible = near; for (const r of m.rails || []) r.root.visible = true; } }
    const f = player.machine ? player.machine.position : player.feet; game.focus.copy(f);
  });
  // machines nobody is using are drawn baked into a few meshes each (render/parked.js): checked last thing before drawing, so a machine that has moved is never drawn stale
  const parked = game.parked = new ParkedMachines(scene, machines, () => (game.renderer.shadowMap.enabled ? 1 : 0));
  game.beforeRender.push((fdt) => { for (const m of machines) m.root.updateMatrixWorld(); parked.update(fdt); });

  // ---- PC: the mouse works the controls under it (xr/mouseHand.js); anywhere else, dragging looks round
  let drag = false;
  const el = game.renderer.domElement;
  el.addEventListener('pointerdown', (e) => { bus.start(); if (!mouse.down(e)) drag = true; else el.setPointerCapture?.(e.pointerId); });
  addEventListener('pointerup', (e) => { drag = false; mouse.up(e); });
  el.addEventListener('contextmenu', (e) => e.preventDefault()); // the right button is the trigger while carrying a tool
  el.addEventListener('pointerleave', () => mouse.leave());
  el.addEventListener('wheel', (e) => { if (mouse.wheel(e)) e.preventDefault(); }, { passive: false });
  addEventListener('pointermove', (e) => { mouse.move(e); if (drag) { S.look.yaw -= e.movementX * 0.004; S.look.pitch = clamp(S.look.pitch - e.movementY * 0.004, -1.3, 1.3); } });
  game.renderer.xr.addEventListener('sessionstart', () => { bus.start(); S.chase = false; if (game.camera.parent !== game.rig) game.rig.add(game.camera); player.enteredVR(); setTimeout(() => player.recentre(), 500); });
  game.renderer.xr.addEventListener('sessionend', () => { inter.releaseAll(input.hands); game.camera.position.set(0, 0, 0); game.camera.rotation.set(0, 0, 0); });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('keydown', (e) => {
    if (e.repeat) return; keys.add(e.code); bus.start();
    const m = player.machine, n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0 && machines[n]) S.sit(machines[n]);
    else if (e.code === 'KeyQ') { if (m) S.stand(); }
    else if (e.code === 'KeyV') S.chase = !S.chase;
    else if (e.code === 'KeyF') game.hud.toggle();
    else if (e.code === 'KeyX') S.setStress(!S.stress);
    else if (e.code === 'KeyM' && !game.remote) S.setPhysics(S.physics === 'custom' ? 'rapier' : 'custom');
    else if (e.code === 'KeyN') S.setLighting(game.env.next());
    else if (e.code === 'KeyO') { player.horizonLock = player.horizonLock ? 0 : 0.8; }
    else if (m && e.code === 'Enter') setCtl(m, 'key', m.controls.key.value > 0.5 ? 0 : 1);
    else if (m && e.code === 'KeyP') setCtl(m, 'park', m.controls.park.value > 0.5 ? 0 : 1);
    else if (m && e.code === 'KeyT') setCtl(m, 'throttle', clamp(m.controls.throttle.value + 0.25, 0, 1));
    else if (m && e.code === 'KeyG') setCtl(m, 'throttle', clamp(m.controls.throttle.value - 0.25, 0, 1));
    else if (m && e.code === 'KeyR') { if (e.shiftKey) m.reset(); else m.upright(); }
    else if (m && e.code === 'KeyU' && m.controls.range) setCtl(m, 'range', m.controls.range.value > 0.5 ? 0 : 1);
    else if (m && e.code === 'KeyY' && m.controls.grade) setCtl(m, 'grade', m.controls.grade.value > 0.5 ? 0 : 1);
    else if (m && e.code === 'KeyH') m.voice.horn();
    else if (m && e.code === 'KeyC') player.recentre();
    else if (!m && e.code === 'KeyC') player.crouch();
    else if (m && e.code === 'KeyB' && m.controls.swivel) m.controls.swivel.press(null);
  });
  function desktopCamera() {
    if (game.renderer.xr.isPresenting) return;
    const cam = game.camera, m = player.machine;
    if (S.overview) { if (cam.parent !== scene) scene.add(cam); cam.position.fromArray(S.overview.from); cam.lookAt(...S.overview.to); return; } // bird's-eye for screenshots
    if (m && S.chase) {
      if (cam.parent !== scene) scene.add(cam);
      const a = m.heading + S.look.yaw, p = m.position;
      const z = S.zoom || 1; cam.position.set(p.x + Math.sin(a) * 11 * z, p.y + (6 - S.look.pitch * 6) * z, p.z + Math.cos(a) * 11 * z);
      _f.set(0, 0, -2).applyQuaternion(m.bodyList[0].obj.quaternion); cam.lookAt(p.x + _f.x, p.y + 1.5, p.z + _f.z);
      return;
    }
    if (cam.parent !== game.rig) game.rig.add(cam);
    if (m) cam.position.set(0, 0, 0);
    else { // walking on the desktop: WASD
      const fwd = clamp(k('KeyW') - k('KeyS') + pad.l[1], -1, 1), side = clamp(k('KeyD') - k('KeyA') + pad.l[0], -1, 1), sp = (keys.has('ShiftLeft') || pad.fwd > 0.5 ? 5 : 2) * 0.016;
      S.look.yaw -= pad.r[0] * 0.04; S.look.pitch = clamp(S.look.pitch + pad.r[1] * 0.03, -1.3, 1.3);
      const yaw = player.yaw + S.look.yaw; player.feet.x += (-Math.sin(yaw) * fwd + Math.cos(yaw) * side) * sp; player.feet.z += (-Math.cos(yaw) * fwd - Math.sin(yaw) * side) * sp;
    }
    cam.rotation.set(S.look.pitch, S.look.yaw, 0, 'YXZ');
  }
  function setHelp() {
    const el = document.getElementById('helpBody'); if (!el) return;
    const m = player.machine, K = (s) => `<span class="k">${s}</span>`;
    el.innerHTML = `<b>Quest:</b> <i>Enter VR</i>. Squeeze a grip on thin air and pull to move yourself through the world (both hands: pull and twist to turn); or walk with the left stick, snap-turn with the right. Seated, push the left stick sideways to turn in the seat. Play sitting down if you like: on foot you stand at full height whatever your real height (B on foot measures it again). Grab the yellow handrail to climb in. `
      + `All controls are physical: grip to take hold; point at a button from a distance and the blue laser lets the trigger press it. Triggers are the pedals while that hand is on a control (right go, left brake). Either thumbstick also works the bucket, blade or bed. ${K('Y')} get out · ${K('B')} recentre · ${K('A')} horn (on foot: crouch down / stand up) · ${K('X')} perf HUD · seated, click the right stick for horizon lock, and hold the left stick in for a second to stand a rolled or stuck machine back on its wheels · on foot, click the right stick to change the time of day.<br>`
      + `<b>PC:</b> point at a lever, switch, key or the wheel and it lights up; drag it (up pushes forward), click a switch or button; on foot, click a handrail to climb in, or click a hand tool to carry it (look at the ground to put it there, walk to dig, right button throws, click to put down). Drag anywhere else to look round.<br>`
      + `<b>Keys:</b> ${K('1')}–${K('4')} take a seat · ${K('Q')} get out · ${K('Enter')} ignition · ${K('P')} park brake · ${K('W')}${K('A')}${K('S')}${K('D')} drive · ${K('Space')} brake · `
      + `${K('T')}/${K('G')} throttle · ${K('U')} travel gear · ${K('Y')} dozer auto level · ${K('V')} chase view · ${K('R')} stand the machine upright (${K('Shift')}+${K('R')} back to where it started) · ${K('X')} demo drivers · ${K('M')} switch physics · ${K('N')} time of day · on foot, ${K('C')} crouch · drag to look<br>`
      + `<b>Gamepad (Xbox), laid out as in Farming Simulator:</b> ${K('RT')} go · ${K('LT')} brake, then reverse · left stick steer (tracks: drive) · right stick look round · right stick click: cab / outside view · d-pad ▲ ▼ zoom · ${K('X')} get in / out · d-pad ◀ ▶ previous / next machine · ${K('Y')} switch control group (backhoe: loader or hoe) · hold ${K('LB')} + right stick bucket, blade or bed · tap ${K('RB')} / ${K('LB')} hand throttle · ${K('B')} park brake · ${K('A')} horn · ${K('LB')}+${K('A')} engine on / off (it starts by itself when you pull away) · left stick click travel gear · hold ${K('View')} to stand the machine upright · ${K('Menu')} menu; on foot, sticks walk and look, ${K('A')} crouch<br>`
      + `<b>Physics: ${S.physics === 'custom' ? 'custom (hand-written vehicle model)' : 'Rapier (rigid bodies)'}.</b> Switch it under Extras on the start page (Esc).<br>`
      + (m ? `<b>${m.name}:</b> ${(m.def.keyHelp || '')}` : 'On foot.') + ` · <a href="poc.html">original POC</a>`;
  }
  const sp = map.spawn.player || [(map.spawn[kinds[0]] || [0, 0])[0] - 5, (map.spawn[kinds[0]] || [0, 0])[1] + 3, 0];
  player.place(sp[0], sp[1], sp[2] || 0);
  // hand tools on the ground beside where you start: shovel, grading stakes, tow chain (game/handTools.js)
  const tools = S.tools = new HandTools(game, inter, sp[0] + 1.6, sp[1] - 1.2);
  tools.design = () => (S.padJob && !S.padJob.done ? S.padJob.design : null); // the stakes read cut and fill against it
  game.frameUpdaters.push((fdt) => tools.update(fdt));
  setHelp();
  return S;
}
