// The MVP job list and the clipboard it is written on. Each item is a predicate over the game state; once
// ticked an item stays ticked (the river taking your crossing back later does not untick it).
import * as THREE from 'three';
import { Control } from '../xr/controls/index.js';

export function makeChecklist(game, { machines, hopper, map }) {
  const river = map.river, far = river.z + 8, near = river.z - 9;
  const fordWidth = () => { // widest run of water columns (0.5 m each) where the deepest point across the channel is wadeable
    const w = game.terrain.water; if (!w) return 0;
    let best = 0, run = 0;
    for (let i = 4; i < w.nx - 4; i++) {
      let deep = 0; for (let j = 0; j < w.nz; j++) { const d = w.depth[j * w.nx + i]; if (d > deep) deep = d; }
      if (deep < 0.38) { run++; if (run > best) best = run; } else run = 0;
    }
    return best * w.cell;
  };
  let fordHeld = 0;
  const items = [
    { text: 'Cut a road down the terraces to the river', done: false, test: () => machines.some((m) => m.def.drive.type === 'wheels' && m.position.z > near && m.position.z < river.z - 3) },
    { text: 'Build a crossing: mud for bulk, gravel on top', done: false, test: (dt) => { fordHeld = fordWidth() >= 3 ? fordHeld + dt : 0; return fordHeld > 20; }, hint: () => `ford ${fordWidth().toFixed(1)} m wide, held ${Math.min(20, fordHeld).toFixed(0)}/20 s` },
    { text: 'Drive the dumper and loader across', done: false, test: () => ['dumper', 'loader'].every((id) => { const m = machines.find((x) => x.id === id); return m && m.position.z > far; }) },
    { text: `Haul ${hopper.target} m³ of sand to the yard hopper`, done: false, test: () => hopper.sand() >= hopper.target, hint: () => `${hopper.sand().toFixed(1)} / ${hopper.target} m³` },
  ];
  // one canvas shared by every clipboard
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 640;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  function draw() {
    const g = canvas.getContext('2d'); g.fillStyle = '#efe6cf'; g.fillRect(0, 0, 512, 640);
    g.fillStyle = '#6d6e70'; g.fillRect(176, 0, 160, 34);
    g.fillStyle = '#2b2b2b'; g.font = 'bold 34px system-ui, sans-serif'; g.fillText('TODAY\'S JOBS', 36, 86);
    let y = 150;
    for (const it of items) {
      g.strokeStyle = '#2b2b2b'; g.lineWidth = 4; g.strokeRect(36, y - 30, 34, 34);
      if (it.done) { g.strokeStyle = '#2f8f3a'; g.lineWidth = 7; g.beginPath(); g.moveTo(40, y - 14); g.lineTo(52, y); g.lineTo(76, y - 36); g.stroke(); }
      g.fillStyle = it.done ? '#5c7d55' : '#2b2b2b'; g.font = '26px system-ui, sans-serif';
      const words = it.text.split(' '); let line = '', ly = y - 4;
      for (const w of words) { if (g.measureText(line + w).width > 390) { g.fillText(line, 90, ly); ly += 32; line = ''; } line += w + ' '; }
      g.fillText(line, 90, ly);
      if (!it.done && it.hint) { g.fillStyle = '#8a5a20'; g.font = 'italic 22px system-ui, sans-serif'; g.fillText(it.hint(), 90, ly + 30); ly += 30; }
      y = ly + 74;
    }
    if (items.every((i) => i.done)) { g.fillStyle = '#2f8f3a'; g.font = 'bold 40px system-ui, sans-serif'; g.fillText('JOB DONE!', 130, 600); }
    tex.needsUpdate = true;
  }
  let timer = 0; draw();
  return { items, texture: tex, fordWidth,
    update(dt) {
      let changed = false;
      for (const it of items) if (!it.done && it.test(dt)) { it.done = true; changed = true; if (this.onTick) this.onTick(it); }
      if (changed || (timer += dt) > 1) { timer = 0; draw(); }
    },
    get complete() { return items.every((i) => i.done); } };
}

/** The clipboard in a cab: grab it to bring it up to your face; let go and it returns to its clip. */
export class Clipboard extends Control {
  constructor(def, texture) {
    super(def); this.home = new THREE.Vector3().fromArray(def.pos); this.homeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(def.rot || [0, 0, 0])));
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.008), this.mat(0x7a5a3a)); this.root.add(board);
    const page = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.2375), new THREE.MeshBasicMaterial({ map: texture })); page.position.z = 0.0055; this.root.add(page);
    this.back = 0;
  }
  distanceTo(world) { const p = this.local(world); return Math.hypot(Math.max(0, Math.abs(p.x) - 0.1), Math.max(0, Math.abs(p.y) - 0.125), p.z); }
  grabStart(hand) { super.grabStart(hand); this.back = 0; }
  grabMove(hand) { // follows the hand freely, facing the way the hand holds it
    const parent = this.root.parent; this.root.position.copy(parent.worldToLocal(_v.copy(hand.pos)));
    parent.getWorldQuaternion(_q).invert(); this.root.quaternion.copy(_q.multiply(hand.quat)).multiply(TILT);
  }
  grabEnd(hand) { super.grabEnd(hand); this.back = 1; }
  tick(dt) { if (this.back > 0 && !this.held) { this.back = Math.max(0, this.back - dt * 3); const k = 1 - this.back; this.root.position.lerp(this.home, k); this.root.quaternion.slerp(this.homeQ, k); } }
  handlePose(hand, pos, quat) { pos.copy(hand.pos); quat.copy(hand.quat); }
}
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9, 0, 0));
