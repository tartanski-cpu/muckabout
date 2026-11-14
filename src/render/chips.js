// Surface detail: instanced chips scattered by a hash of cell + material (gravel shards, mud/clay clumps,
// grass tufts), for chunks near the viewer. A chunk's list is rebuilt only when that chunk changes.
import * as THREE from 'three';
import { CHUNK } from '../terrain/core.js';
import { MATERIALS, GRASS_COLOR, TOPSOIL } from '../terrain/materials.js';
import { hash2 } from '../util/rng.js';

const RANGE = 24, CAP = 9000;
const _o = new THREE.Object3D(), STONE = [0.5, 0.49, 0.46];
/** Knock a regular solid about so no two faces match: stones and clods rather than dice. */
function lumpy(g, amount, seed) {
  const p = g.attributes.position, seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 1 + (hash2(seen.size, seed, 3) - 0.5) * 2 * amount);
    const k = seen.get(key); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  g.computeVertexNormals(); return g;
}
export { lumpy };

export class Chips {
  constructor(terrain) {
    this.t = terrain; this.cnx = Math.ceil(terrain.nx / CHUNK); this.cnz = Math.ceil(terrain.nz / CHUNK);
    const shard = lumpy(new THREE.TetrahedronGeometry(0.075, 0), 0.35, 3), clump = lumpy(new THREE.DodecahedronGeometry(0.07, 0), 0.3, 5);
    // a grass tuft: three thin blades fanned out, each a tapering strip (far better than a cone, same cost)
    const blades = []; for (let b = 0; b < 3; b++) { const a = b * 2.1 + 0.3, lean = 0.05 + b * 0.03, w = 0.022, h = 0.2 + b * 0.05, c = Math.cos(a), s = Math.sin(a);
      blades.push(-w * c, 0, -w * s, w * c, 0, w * s, lean * -s, h, lean * c); }
    const tuft = new THREE.BufferGeometry(); tuft.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3)); tuft.computeVertexNormals();
    { const nn = tuft.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0); } // lit like the ground they stand on
    // blades are unlit (a two-sided lit blade goes black on its back face); stones and clods are lit
    const mk = (g) => { const m = new THREE.InstancedMesh(g, g === tuft ? new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ flatShading: true }), CAP); m.count = 0; m.frustumCulled = false; m.setColorAt(0, new THREE.Color(1, 1, 1)); return m; };
    this.meshes = [null, mk(shard), mk(clump), mk(tuft)]; // index = chip type
    this.group = new THREE.Group(); this.group.add(this.meshes[1], this.meshes[2], this.meshes[3]);
    this.lists = new Map(); this.dirty = new Set(); this.near = []; this.nearKey = ''; this.rebuild = true;
    terrain.onChunks((chunks) => { for (const c of chunks) if (this.lists.has(c.id)) this.dirty.add(c.id); });
  }
  _build(id) { // per chip type: instance matrices and colours, ready to be copied straight into the instanced buffers
    const t = this.t, ci = id % this.cnx, cj = (id / this.cnx) | 0, tmp = [null, [], [], []];
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
      const gi = ci * CHUNK + i, gj = cj * CHUNK + j, c = gj * t.nx + gi, m = t.info[c * 4]; if (!m) continue;
      const worked = t.info[c * 4 + 1] > 0, r = hash2(gi, gj, m);
      let type = MATERIALS[m].chip, dens = type === 1 ? 0.7 : 0.22, col = MATERIALS[m].color, big = 1;
      if (m === TOPSOIL && !worked) { dens = 0.42; col = GRASS_COLOR; if (r > 0.415) { type = 1; col = STONE; big = 1.6; } } // grass, with the odd stone
      else if (m === TOPSOIL) { type = 2; dens = 0.2; }
      else if (worked && type === 2) dens = 0.34;                 // freshly worked soil is cloddy
      else if (m === 4) { type = 1; dens = 0.05; col = STONE; }   // a few pebbles on sand
      if (!type || r > dens) continue;
      const a = hash2(gi, gj, 7), b = hash2(gi, gj, 13), k = 0.7 + 0.5 * a;
      const g2 = type === 3 ? [0.8 + 0.45 * b, 1.08, 0.75 + 0.3 * a] : [1, 1, 1]; // grass varies in tone
      tmp[type].push(t.ox + (gi + a - 0.5) * t.cell, t.h[c] + (type === 3 ? -0.01 : 0.012), t.oz + (gj + b - 0.5) * t.cell, (0.6 + b * 1.1) * big, a * 6.283, col[0] * k * g2[0], col[1] * k * g2[1], col[2] * k * g2[2]);
    }
    return tmp.map((l, type) => {
      if (!l) return null;
      const n = l.length / 8, mat = new Float32Array(n * 16), col = new Float32Array(n * 3);
      for (let q = 0; q < n; q++) {
        const o = q * 8; _o.position.set(l[o], l[o + 1], l[o + 2]); _o.scale.setScalar(l[o + 3]); _o.rotation.set(type === 3 ? 0 : l[o + 4], l[o + 4], 0); _o.updateMatrix();
        mat.set(_o.matrix.elements, q * 16); col[q * 3] = l[o + 5]; col[q * 3 + 1] = l[o + 6]; col[q * 3 + 2] = l[o + 7];
      }
      return { n, mat, col };
    });
  }
  /** Call once per frame. Rebuilds at most one chunk's list a frame and refills the instance buffers at most ~8 times a second. */
  update(camPos) {
    const t = this.t, ci = Math.floor((camPos.x - t.ox) / t.cell / CHUNK), cj = Math.floor((camPos.z - t.oz) / t.cell / CHUNK);
    const key = ci + ',' + cj; this.frame = (this.frame || 0) + 1;
    if (key !== this.nearKey) {
      this.nearKey = key; this.near.length = 0; const rc = Math.ceil(RANGE / (CHUNK * t.cell));
      for (let b = cj - rc; b <= cj + rc; b++) for (let a = ci - rc; a <= ci + rc; a++) if (a >= 0 && b >= 0 && a < this.cnx && b < this.cnz) this.near.push(b * this.cnx + a);
      for (const id of [...this.lists.keys()]) if (!this.near.includes(id)) this.lists.delete(id);
      this.rebuild = true;
    }
    for (const id of this.near) if (!this.lists.has(id) || this.dirty.has(id)) { this.lists.set(id, this._build(id)); this.dirty.delete(id); this.rebuild = true; break; }
    if (!this.rebuild || this.frame % 9) return;
    this.rebuild = false;
    for (let type = 1; type <= 3; type++) {
      const mesh = this.meshes[type], M = mesh.instanceMatrix.array, C = mesh.instanceColor.array; let n = 0;
      for (const id of this.near) {
        const l = this.lists.get(id)?.[type]; if (!l || !l.n) continue;
        const take = Math.min(l.n, CAP - n); if (take <= 0) break;
        M.set(take === l.n ? l.mat : l.mat.subarray(0, take * 16), n * 16); C.set(take === l.n ? l.col : l.col.subarray(0, take * 3), n * 3); n += take;
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    }
  }
}
