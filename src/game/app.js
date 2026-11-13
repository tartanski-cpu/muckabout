// Game shell: renderer, fixed-step loop, terrain, clods, perf HUD, and the window.__game test surface.
// A "scene" module supplies what happens on the ground (machines, ghost tools, map logic).
import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { PerfMonitor } from '../harness/perf.js';
import { WristHud } from '../harness/wristHud.js';
import { TerrainClient } from '../terrain/client.js';
import { Clods } from '../terrain/clods.js';
import { Ground } from '../render/ground.js';
import { Chips } from '../render/chips.js';
import { ClodMesh } from '../render/clodMesh.js';
import { ContainerMesh } from '../render/containerMesh.js';
import { makeEnvironment } from '../render/scenery.js';
import { WaterMesh } from '../render/water.js';
import { makeRng } from '../util/rng.js';

export const DT = 1 / 60;

export class Game {
  constructor(opts) { this.opts = opts; }

  async init() {
    const o = this.opts;
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFoveation(1);
    document.body.appendChild(renderer.domElement);
    document.body.appendChild(VRButton.createButton(renderer));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 500);
    // the rig is what moves through the world; in VR the headset pose is relative to it
    this.rig = new THREE.Group(); this.scene.add(this.rig); this.rig.add(this.camera);

    this.perf = new PerfMonitor(['input', 'vehicles', 'tools', 'clods', 'terrain', 'upload', 'render']);
    this.hud = new WristHud(this.perf);
    this.rng = makeRng(o.seed ?? 1337);

    this.terrain = await new TerrainClient({ map: o.map, mode: o.worker ? 'worker' : 'inline', water: !!o.water }).init();
    this.env = makeEnvironment(this.scene, this.terrain);
    this.ground = new Ground(renderer, this.terrain, this.env); this.scene.add(this.ground.group);
    this.chips = new Chips(this.terrain); this.scene.add(this.chips.group);
    if (o.water) { this.water = new WaterMesh(this.terrain, this.env); this.water.onReady = (m) => this.scene.add(m); if (this.water.mesh) this.scene.add(this.water.mesh); }
    this.clods = new Clods({ rng: this.rng, max: 1500 });
    this.rigs = []; // ContainerRig list (clod targets)
    this.containerMeshes = [];
    this.clods.setTargets(this.terrain, this.rigs);
    this.clodMesh = new ClodMesh(this.clods); this.scene.add(this.clodMesh.mesh);

    this.simTime = 0; this.acc = 0; this.paused = false; this.fast = false; this.frame = 0;
    this.updaters = [];      // fn(dt) run each fixed step, in order
    this.frameUpdaters = []; // fn(dt) run each rendered frame
    this.clock = new THREE.Clock();
    this.focus = new THREE.Vector3(); // what the desktop debug camera looks at
    this.THREE = THREE; // for scripted tests
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
    });
    return this;
  }

  /** Register a container so clods can land in it and its contents are drawn. parent = Object3D whose frame is the container's. */
  addContainer(rig, parent) {
    this.rigs.push(rig);
    const cm = new ContainerMesh(rig.field); parent.add(cm.mesh); this.containerMeshes.push(cm);
    rig.object = parent;
    return rig;
  }
  /** Copy each container's current world pose into its rig (after transforms are updated). */
  syncContainers() {
    for (const r of this.rigs) {
      const o = r.object; o.updateWorldMatrix(true, false);
      _inv.copy(o.matrixWorld).invert(); r.setPose(o.matrixWorld.elements, _inv.elements);
    }
  }

  /** One fixed simulation step. */
  step(dt) {
    const perf = this.perf;
    perf.begin('vehicles');
    for (const u of this.updaters) u(dt);
    perf.end('vehicles');
    perf.begin('tools');
    this.syncContainers();
    for (const r of this.rigs) r.step(dt, this.clods);
    perf.end('tools');
    perf.begin('clods');
    this.clods.update(dt);
    perf.end('clods');
    perf.begin('terrain');
    this.terrain.tick();
    perf.end('terrain');
    this.simTime += dt;
  }

  start() {
    this.renderer.setAnimationLoop(() => this.loop());
  }

  loop() {
    const perf = this.perf, fdt = Math.min(this.clock.getDelta(), 0.1);
    this.frame++;
    if (!this.paused) {
      this.acc += fdt; let n = 0;
      while (this.acc >= DT && n < 3) { this.step(DT); this.acc -= DT; n++; }
      if (this.acc > DT) this.acc = 0; // fell behind: drop the backlog rather than spiral
    }
    for (const u of this.frameUpdaters) u(fdt);
    perf.begin('upload');
    this.camera.getWorldPosition(_cam);
    this.ground.update(_cam); this.chips.update(_cam);
    this.clodMesh.update();
    for (const c of this.containerMeshes) c.update();
    if (this.water) this.water.update(fdt);
    perf.end('upload');
    perf.begin('render');
    this.renderer.render(this.scene, this.camera);
    perf.end('render');
    if (this.terrain.mode === 'worker') perf.add('terrain', this.terrain.stats.ms);
    perf.count('clods', this.clods.count);
    perf.count('awake', this.terrain.stats.awake);
    perf.count('queue', this.terrain.stats.queue);
    perf.count('calls', this.renderer.info.render.calls);
    perf.count('tris', this.renderer.info.render.triangles);
    perf.frame();
    this.hud.update(fdt);
  }

  /** Fast-forward n fixed steps (inline terrain only: a worker cannot be stepped synchronously). */
  sim(n, fn) {
    this.fast = true;
    for (let i = 0; i < n; i++) { if (fn) fn(this.simTime, this); this.step(DT); }
    this.fast = false; this.perf.discard();
  }

  /** Where every cubic metre is: ground (per material), containers, airborne, lost, compacted. */
  async audit() {
    const a = await this.terrain.audit();
    let containers = 0; for (const r of this.rigs) containers += r.field.volume();
    const airborne = this.clods.airborne();
    const extra = this.extraVolume ? this.extraVolume() : 0;
    return { ...a, containers, airborne, inFlight: this.terrain.inFlight, extra, total: a.total + containers + airborne + this.terrain.inFlight + extra };
  }
}
const _inv = new THREE.Matrix4(), _cam = new THREE.Vector3();

/** Simple orbit camera for desktop debugging: drag to look, wheel to zoom. Follows game.focus. */
export function debugCamera(game, dist = 14) {
  const st = { yaw: 0.6, pitch: 0.5, dist, enabled: true };
  let drag = false;
  const el = game.renderer.domElement;
  el.addEventListener('pointerdown', () => { drag = true; });
  addEventListener('pointerup', () => { drag = false; });
  addEventListener('pointermove', (e) => { if (drag) { st.yaw -= e.movementX * 0.005; st.pitch = Math.min(1.5, Math.max(-0.2, st.pitch + e.movementY * 0.005)); } });
  el.addEventListener('wheel', (e) => { st.dist = Math.min(150, Math.max(2, st.dist * (e.deltaY > 0 ? 1.1 : 0.9))); });
  game.frameUpdaters.push(() => {
    if (!st.enabled || game.renderer.xr.isPresenting) return;
    const f = game.focus, cp = Math.cos(st.pitch);
    game.rig.position.set(f.x + Math.sin(st.yaw) * cp * st.dist, f.y + Math.sin(st.pitch) * st.dist, f.z + Math.cos(st.yaw) * cp * st.dist);
    game.rig.rotation.set(0, 0, 0); game.camera.position.set(0, 0, 0);
    game.rig.updateMatrixWorld(); game.camera.lookAt(f);
  });
  return st;
}
