// The yard hopper: a walled pit you tip into. It is a ContainerField like any bucket or bed, so deliveries arrive
// as clods and are counted by material.
import * as THREE from 'three';
import { ContainerField } from '../terrain/containers.js';
import { ContainerRig } from '../terrain/tool.js';
import { SAND } from '../terrain/materials.js';

export function makeHopper(game, phys, def) {
  const { x, z, w, d, depth, target } = def, cs = 0.25, ground = 9;
  const obj = new THREE.Group(); obj.position.set(x, ground - depth, z); game.scene.add(obj);
  const field = new ContainerField({ name: 'hopper', nx: Math.round(w / cs), nz: Math.round(d / cs), cs, capacity: w * d * depth * 1.2, walls: {} });
  const rig = game.addContainer(new ContainerRig(field, 'hopper'), obj); rig.passes = 1;
  // walls round the pit: concrete, about a metre high, also the wheel stop when you reverse up to it
  const conc = new THREE.MeshLambertMaterial({ color: 0x9a968c, flatShading: true }), t = 0.25, hgt = 1.0;
  const wall = (sx, sz, px, pz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, hgt + depth, sz), conc); m.position.set(px, (hgt - depth) / 2 + depth, pz); obj.add(m); if (phys) phys.addStaticBox([sx, hgt + depth, sz], [x + px, ground + (hgt - depth) / 2, z + pz]); };
  wall(w + 2 * t, t, 0, -d / 2 - t / 2); wall(w + 2 * t, t, 0, d / 2 + t / 2); wall(t, d, -w / 2 - t / 2, 0); wall(t, d, w / 2 + t / 2, 0);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6b675f })); floor.position.y = 0.01; obj.add(floor);
  // sign
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); sign.position.set(0, depth + 3.2, 0); obj.add(sign);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.8, 0.15), conc); post.position.set(-w / 2 - 0.1, depth + 1.4, 0); obj.add(post);
  const hopper = { field, rig, obj, target, shown: -1,
    /** m³ of sand delivered. */
    sand() { let s = 0; for (let k = 0; k < field.fill.length; k++) if (field.mat[k] === SAND) s += field.fill[k]; return s * field.area; },
    update() {
      const v = Math.round(this.sand() * 10) / 10; if (v === this.shown) return; this.shown = v;
      const g = c.getContext('2d'); g.fillStyle = '#10161a'; g.fillRect(0, 0, 512, 128);
      g.fillStyle = v >= target ? '#8fef7a' : '#ffd25a'; g.font = 'bold 54px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText(v >= target ? `HOPPER FULL  ${v.toFixed(1)} m³` : `SAND  ${v.toFixed(1)} / ${target} m³`, 256, 84); tex.needsUpdate = true;
    } };
  hopper.update();
  return hopper;
}
