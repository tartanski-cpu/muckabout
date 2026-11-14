// The playable scene: machines with physical cab controls, the player on foot or seated, sound and haptics,
// plus the desktop keyboard debug path.
import * as THREE from 'three';
import { DEFS } from '../../machines/index.js';
import { Physics } from '../vehicles/physics.js';
import { Machine } from '../vehicles/machine.js';
import { XRInput, stickOf } from '../xr/input.js';
import { InteractionSystem } from '../xr/interaction.js';
import { Hands } from '../xr/hands.js';
import { Player } from '../xr/player.js';
import { makeControl } from '../xr/controls/index.js';
import { buildDecor } from '../xr/controls/decor.js';
import { AudioBus, MachineVoice, renderEngine } from '../audio/machineAudio.js';
import { clamp } from '../util/rng.js';
import * as autopilot from '../game/autopilot.js';
import { makeHopper } from '../game/hopper.js';
import { makeChecklist, Clipboard } from '../game/checklist.js';
import { startStress } from './stress.js';
import { Rams } from '../render/rams.js';

const _p = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _q = new THREE.Quaternion();

export async function setup(game, { kinds = Object.keys(DEFS) } = {}) {
  const { terrain, scene } = game, map = terrain.map;
  const phys = await Physics.create(), input = new XRInput(game.renderer, game.rig), inter = new InteractionSystem(scene);
  const hands = new Hands(scene), player = new Player(game, input), bus = new AudioBus();
  const machines = [], keys = new Set();
  const S = { phys, input, inter, hands, player, bus, machines, keys, chase: false, look: { yaw: 0, pitch: -0.15 }, renderEngine };

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
    const placard = def.placard ? [{ parent: m.nodes[def.placard.parent], text: m.def.drive.type === 'tracks' ? 'L TRIGGER: DECELERATOR' : 'R TRIGGER: GO   L TRIGGER: BRAKE', width: 0.3, pos: def.placard.pos, rot: def.placard.rot || [0, 0, 0] }] : [];
    m.controlRoots = Object.values(m.controls).map((c) => c.root).concat(buildDecor(Object.values(m.controls), placard));
    machines.push(m);
  }
  const rams = new Rams(scene, machines);
  game.machines = machines; game.play = S; game.autopilot = autopilot;
  game.machine = (id) => machines.find((m) => m.id === id);

  // the job: hopper in the yard, checklist on a clipboard in every cab
  if (map.hopper) {
    S.hopper = makeHopper(game, phys, map.hopper);
    S.checklist = makeChecklist(game, { machines, hopper: S.hopper, map });
    S.checklist.onTick = () => { for (const s of ['left', 'right']) input.hands[s].pulse(0.9, 150); };
    for (const m of machines) {
      const e = m.seatDef.eye, cb = new Clipboard({ name: 'clipboard', pos: [e[0] - 0.5, e[1] - 0.45, e[2] - 0.62], rot: [-0.5, 0.45, 0] }, S.checklist.texture);
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
    c.fillText(`${(Math.abs(m.speed) * 3.6).toFixed(0).padStart(2)} km/h  ${m.gear > 0 ? 'F' : m.gear < 0 ? 'R' : 'N'}${m.inp.park > 0.5 ? '  (P)' : ''}`, 12, 30);
    c.fillText(e.running ? `${e.rpm.toFixed(0)} rpm` : e.crank > 0 ? 'cranking…' : 'ENGINE OFF', 12, 58);
    c.fillStyle = '#9fd4ff'; c.font = 'bold 15px monospace'; c.fillText(S.physics === 'custom' ? 'CUSTOM PHYSICS' : 'RAPIER PHYSICS', 12, 122); c.fillStyle = '#ffd25a'; c.font = 'bold 22px monospace';
    if (S.net) { c.fillStyle = S.net.lost ? '#ff7a5a' : '#9fd4ff'; c.font = 'bold 16px monospace'; c.fillText(S.net.lost ? 'LINK LOST' : `ROOM ${S.net.code}`, 150, 58); c.fillStyle = '#ffd25a'; }
    const load = m.payload(), cap = m.rigs.reduce((s, r) => s + r.field.capacity, 0);
    if (cap) { c.fillStyle = '#2b3a40'; c.fillRect(12, 70, 232, 12); c.fillStyle = '#c98a3a'; c.fillRect(12, 70, 232 * clamp(load / cap, 0, 1), 12);
      c.fillStyle = '#9fe08a'; c.font = 'bold 18px monospace'; c.fillText(`LOAD ${load.toFixed(2)} m³`, 12, 108); }
    dashT.needsUpdate = true;
  }

  function sit(m) {
    if (m.driver && m.driver !== 'local') { input.hands.left.pulse(0.8, 80); input.hands.right.pulse(0.8, 80); return; } // the other player is in it
    inter.releaseAll(input.hands); player.sit(m); S.look.yaw = 0; S.look.pitch = -0.15;
    const d = m.def.display || { parent: m.seatDef.node, pos: [m.seatDef.eye[0] + 0.42, m.seatDef.eye[1] - 0.74, m.seatDef.eye[2] - 0.9], rot: [-0.5, -0.25, 0] };
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
        const [sx, sy] = stickOf(h);
        if (sm.x && sx) inp[sm.x[0]] = clamp((inp[sm.x[0]] || 0) + sx * sm.x[1], -1, 1);
        if (sm.y && sy) inp[sm.y[0]] = clamp((inp[sm.y[0]] || 0) + sy * sm.y[1], -1, 1);
      }
      if (inp.assist > 0.5 || (!game.renderer.xr.isPresenting && keys.size)) assist(m, left, right);
    }
    if (m.driver && m.driver !== 'local' && m.remoteInp) Object.assign(inp, m.remoteInp); // co-op: the other player is driving this one
    Object.assign(inp, m.override);
  }
  const setCtl = (m, name, v) => { const c = m.controls[name]; if (c && !c.held && c.value !== v) c.set(v); };
  const k = (c) => (keys.has(c) ? 1 : 0);
  /** Thumbstick assist (dash toggle, off by default) and the desktop keyboard: both drive without the levers. */
  function assist(m, left, right) {
    const inp = m.inp, vr = game.renderer.xr.isPresenting;
    const rear = m.fn.swivel && m.fn.swivel.pos > 1.5; // backhoe facing its rear controls: the keys work the hoe instead of driving
    let fwd = rear ? 0 : k('KeyW') - k('KeyS'), turn = rear ? 0 : k('KeyD') - k('KeyA');
    if (vr && left.tracked && inp.assist > 0.5) { const [x, y] = stickOf(left); fwd += y; turn += x; }
    fwd = clamp(fwd, -1, 1); turn = clamp(turn, -1, 1);
    if (m.def.drive.type === 'tracks') {
      const l = clamp(fwd + turn, -1, 1), r = clamp(fwd - turn, -1, 1);
      if (fwd || turn || !m.controls.left?.held) { inp.left = l; inp.right = r; setCtl(m, 'left', l); setCtl(m, 'right', r); }
    } else {
      if (fwd) { const dir = Math.sign(fwd); inp.shuttle = dir; setCtl(m, 'shuttle', dir); inp.accel = Math.max(inp.accel, Math.abs(fwd)); }
      if (turn || !m.controls.steer?.held) { inp.steer = turn; setCtl(m, 'steer', turn); }
      inp.brake = Math.max(inp.brake, k('Space'));
    }
    for (const [fn, pos, neg] of (rear ? m.def.keysRear : m.def.keys) || []) { const v = k(pos) - k(neg); if (v) inp[fn] = v; }
  }

  game.updaters.push((dt) => {
    if (game.remote) { if (player.machine) readControls(player.machine); return; } // co-op client: the host simulates; we only read our own controls
    for (const m of machines) readControls(m);
    phys.step(dt);
    for (const m of machines) {
      if (!game.fast) for (const ev of m.events) m.voice.play(ev);
      if (S.net && S.net.peers.size && m.events.length) { m.netEvents ??= []; if (m.netEvents.length < 20) m.netEvents.push(...m.events.filter((e) => e.type === 'clunk' || e.type === 'clank')); }
      if (player.machine === m) { const amp = Math.min(1, m.digRate * 0.5) + m.bump; if (amp > 0.03) for (const s of ['left', 'right']) if (input.hands[s].holding) input.hands[s].pulse(amp, 30); }
    }
  });

  // ---- per frame: hands, interaction, player, camera, audio, HUD
  const hudHolder = new THREE.Group(); scene.add(hudHolder); game.hud.attachTo(hudHolder);
  game.frameUpdaters.push((fdt) => {
    input.update();
    inter.update(input.hands, fdt);
    const { left, right } = input.hands;
    if (left.primaryPressed) game.hud.toggle();
    if (left.secondaryPressed && player.seated) S.stand();
    if (right.secondaryPressed) player.recentre();
    if (right.stickPressed && player.seated && !right.holding) { player.horizonLock = player.horizonLock ? 0 : 0.8; game.hud.note = player.horizonLock ? 'HORIZON LOCK ON (right stick click)' : ''; right.pulse(0.5, 40); } // comfort: damp cab roll and pitch
    if (right.primaryPressed && player.machine) { bus.start(); player.machine.voice.horn(); }
    player.update(fdt, input.hands);
    desktopCamera();
    scene.updateMatrixWorld();
    hands.update(input.hands, fdt);
    rams.update();
    hudHolder.visible = left.tracked; if (left.tracked) { hudHolder.position.copy(left.pos); hudHolder.quaternion.copy(left.quat); }
    if (bus.ctx) {
      game.camera.getWorldPosition(_p); game.camera.getWorldDirection(_f); _u.set(0, 1, 0).applyQuaternion(game.camera.getWorldQuaternion(_q));
      bus.setListener(_p, _f, _u);
      if (map.riverZ) { const rx = clamp(_p.x, terrain.ox, terrain.ox + terrain.nx * terrain.cell); bus.river({ x: rx, y: 0, z: map.riverZ(rx) }); }
      for (const m of machines) { const s = m.audioState(); if (m.tools[0]) { m.tools[0].node.getWorldPosition(_p); s.digMat = terrain.materialAt(_p.x, _p.z); } m.voice.drive(s, m.position); }
    }
    if (player.machine && (dashTimer += fdt) > 0.25) { dashTimer = 0; drawDash(player.machine); }
    if (S.checklist && game.frame % 15 === 0) { S.checklist.update(fdt * 15); S.hopper.update(); }
    if (left.stickPressed && !left.busy && !player.seated) S.setStress(!S.stress);
    if (left.stickPressed && player.seated && !left.holding && !game.remote) { S.setPhysics(S.physics === 'custom' ? 'rapier' : 'custom'); left.pulse(0.6, 60); }
    // cab controls and their labels are many small draw calls: only draw them for machines within reach (handrails always: they are how you find the way in)
    if (game.frame % 20 === 0) { game.camera.getWorldPosition(_p); for (const m of machines) { const near = m.position.distanceToSquared(_p) < 64; for (const r of m.controlRoots) r.visible = near; for (const r of m.rails || []) r.root.visible = true; } }
    const f = player.machine ? player.machine.position : player.feet; game.focus.copy(f);
  });

  // ---- desktop debug: keyboard + mouse look
  let drag = false;
  const el = game.renderer.domElement;
  el.addEventListener('pointerdown', () => { drag = true; bus.start(); });
  addEventListener('pointerup', () => { drag = false; });
  addEventListener('pointermove', (e) => { if (drag) { S.look.yaw -= e.movementX * 0.004; S.look.pitch = clamp(S.look.pitch - e.movementY * 0.004, -1.3, 1.3); } });
  game.renderer.xr.addEventListener('sessionstart', () => { bus.start(); S.chase = false; if (game.camera.parent !== game.rig) game.rig.add(game.camera); setTimeout(() => player.recentre(), 500); });
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
    else if (e.code === 'KeyO') { player.horizonLock = player.horizonLock ? 0 : 0.8; }
    else if (m && e.code === 'Enter') setCtl(m, 'key', m.controls.key.value > 0.5 ? 0 : 1);
    else if (m && e.code === 'KeyP') setCtl(m, 'park', m.controls.park.value > 0.5 ? 0 : 1);
    else if (m && e.code === 'KeyT') setCtl(m, 'throttle', clamp(m.controls.throttle.value + 0.25, 0, 1));
    else if (m && e.code === 'KeyG') setCtl(m, 'throttle', clamp(m.controls.throttle.value - 0.25, 0, 1));
    else if (m && e.code === 'KeyR') m.reset();
    else if (m && e.code === 'KeyH') m.voice.horn();
    else if (m && e.code === 'KeyC') player.recentre();
    else if (m && e.code === 'KeyB' && m.controls.swivel) m.controls.swivel.press(null);
  });
  function desktopCamera() {
    if (game.renderer.xr.isPresenting) return;
    const cam = game.camera, m = player.machine;
    if (S.overview) { if (cam.parent !== scene) scene.add(cam); cam.position.fromArray(S.overview.from); cam.lookAt(...S.overview.to); return; } // bird's-eye for screenshots
    if (m && S.chase) {
      if (cam.parent !== scene) scene.add(cam);
      const a = m.heading + S.look.yaw, p = m.position;
      cam.position.set(p.x + Math.sin(a) * 11, p.y + 6 - S.look.pitch * 6, p.z + Math.cos(a) * 11);
      _f.set(0, 0, -2).applyQuaternion(m.bodyList[0].obj.quaternion); cam.lookAt(p.x + _f.x, p.y + 1.5, p.z + _f.z);
      return;
    }
    if (cam.parent !== game.rig) game.rig.add(cam);
    if (m) cam.position.set(0, 0, 0);
    else { // walking on the desktop: WASD
      const fwd = k('KeyW') - k('KeyS'), side = k('KeyD') - k('KeyA'), sp = (keys.has('ShiftLeft') ? 5 : 2) * 0.016;
      const yaw = player.yaw + S.look.yaw; player.feet.x += (-Math.sin(yaw) * fwd + Math.cos(yaw) * side) * sp; player.feet.z += (-Math.cos(yaw) * fwd - Math.sin(yaw) * side) * sp;
    }
    cam.rotation.set(S.look.pitch, S.look.yaw, 0, 'YXZ');
  }
  function setHelp() {
    const el = document.getElementById('helpBody'); if (!el) return;
    const m = player.machine, K = (s) => `<span class="k">${s}</span>`;
    el.innerHTML = `<b>Quest:</b> <i>Enter VR</i>. Walk with the left stick, snap-turn with the right. Grab the yellow handrail to climb in. `
      + `All controls are physical: grip to take hold; point at a button from a distance and the blue laser lets the trigger press it. Triggers are the pedals while that hand is on a control (right go, left brake). Either thumbstick also works the bucket, blade or bed. ${K('Y')} get out · ${K('B')} recentre · ${K('A')} horn · ${K('X')} perf HUD · seated, click the right stick for horizon lock and the left stick to switch physics · on foot, click the left stick for the stress test.<br>`
      + `<b>Desktop (debug):</b> ${K('1')}–${K('4')} take a seat · ${K('Q')} get out · ${K('Enter')} ignition · ${K('P')} park brake · ${K('W')}${K('A')}${K('S')}${K('D')} drive · ${K('Space')} brake · `
      + `${K('T')}/${K('G')} throttle · ${K('V')} chase view · ${K('R')} reset · ${K('X')} stress test · ${K('M')} switch physics · drag to look<br>`
      + `<b>Physics: ${S.physics === 'custom' ? 'custom (hand-written vehicle model)' : 'Rapier (rigid bodies)'}.</b> Seated in VR, click the left stick to switch and compare.<br>`
      + (m ? `<b>${m.name}:</b> ${(m.def.keyHelp || '')}` : 'On foot.') + ` · <a href="poc.html">original POC</a>`;
  }
  const sp = map.spawn.player || [(map.spawn[kinds[0]] || [0, 0])[0] - 5, (map.spawn[kinds[0]] || [0, 0])[1] + 3, 0];
  player.place(sp[0], sp[1], sp[2] || 0);
  setHelp();
  return S;
}
