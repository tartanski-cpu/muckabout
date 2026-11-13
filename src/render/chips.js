// Surface detail: instanced chips scattered by a hash of cell + material (gravel shards, mud/clay clumps,
// grass tufts), for chunks near the viewer. A chunk's list is rebuilt only when that chunk changes.
import * as THREE from 'three';
import { CHUNK } from '../terrain/core.js';
import { MATERIALS, GRASS_COLOR, TOPSOIL } from '../terrain/materials.js';
import { hash2 } from '../util/rng.js';

const RANGE = 22, CAP = 7000;
const _o = new THREE.Object3D();

export class Chips {
  constructor(terrain) {
    this.t = terrain; this.cnx = Math.ceil(terrain.nx / CHUNK); this.cnz = Math.ceil(terrain.nz / CHUNK);
    const shard = new THREE.TetrahedronGeometry(0.075, 0), clump = new THREE.DodecahedronGeometry(0.07, 0);
    const tuft = new THREE.ConeGeometry(0.05, 0.22, 4).translate(0, 0.1, 0);
    const mk = (g) => { const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ flatShading: true }), CAP); m.count = 0; m.frustumCulled = false; m.setColorAt(0, new THREE.Color(1, 1, 1)); return m; };
    this.meshes = [null, mk(shard), mk(clump), mk(tuft)]; // index = chip type
    this.group = new THREE.Group(); this.group.add(this.meshes[1], this.meshes[2], this.meshes[3]);
    this.lists = new Map(); this.dirty = new Set(); this.near = []; this.nearKey = ''; this.rebuild = true;
    terrain.onChunks((chunks) => { for (const c of chunks) if (this.lists.has(c.id)) this.dirty.add(c.id); });
  }
  _build(id) { // per chip type: packed [x,y,z,scale,rot,r,g,b]
    const t = this.t, ci = id % this.cnx, cj = (id / this.cnx) | 0, out = [null, [], [], []];
    for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
      const gi = ci * CHUNK + i, gj = cj * CHUNK + j, c = gj * t.nx + gi, m = t.info[c * 4]; if (!m) continue;
      const worked = t.info[c * 4 + 1] > 0, r = hash2(gi, gj, m);
      let type = MATERIALS[m].chip, dens = type === 1 ? 0.55 : 0.16, col = MATERIALS[m].color;
      if (m === TOPSOIL && !worked) { dens = 0.11; col = GRASS_COLOR; } else if (m === TOPSOIL) { type = 2; dens = 0.12; }
      if (!type || r > dens) continue;
      const a = hash2(gi, gj, 7), b = hash2(gi, gj, 13), k = 0.7 + 0.5 * a;
      out[type].push(t.ox + (gi + a - 0.5) * t.cell, t.h[c] + (type === 3 ? 0 : 0.015), t.oz + (gj + b - 0.5) * t.cell, 0.7 + b * 0.9, a * 6.283, col[0] * k, col[1] * k, col[2] * k);
    }
    return out;
  }
  /** Call once per frame. Rebuilds at most `budget` chunk lists. */
  update(camPos, budget = 2) {
    const t = this.t, ci = Math.floor((camPos.x - t.ox) / t.cell / CHUNK), cj = Math.floor((camPos.z - t.oz) / t.cell / CHUNK);
    const key = ci + ',' + cj;
    if (key !== this.nearKey) {
      this.nearKey = key; this.near.length = 0; const rc = Math.ceil(RANGE / (CHUNK * t.cell));
      for (let b = cj - rc; b <= cj + rc; b++) for (let a = ci - rc; a <= ci + rc; a++) if (a >= 0 && b >= 0 && a < this.cnx && b < this.cnz) this.near.push(b * this.cnx + a);
      for (const id of [...this.lists.keys()]) if (!this.near.includes(id)) this.lists.delete(id);
      this.rebuild = true;
    }
    for (const id of this.near) {
      if (budget <= 0) break;
      if (!this.lists.has(id) || this.dirty.has(id)) { this.lists.set(id, this._build(id)); this.dirty.delete(id); this.rebuild = true; budget--; }
    }
    if (!this.rebuild) return;
    this.rebuild = false;
    for (let type = 1; type <= 3; type++) {
      const mesh = this.meshes[type], col = mesh.instanceColor.array; let n = 0;
      for (const id of this.near) {
        const l = this.lists.get(id)?.[type]; if (!l) continue;
        for (let q = 0; q < l.length && n < CAP; q += 8, n++) {
          _o.position.set(l[q], l[q + 1], l[q + 2]); _o.scale.setScalar(l[q + 3]); _o.rotation.set(type === 3 ? 0 : l[q + 4], l[q + 4], 0);
          _o.updateMatrix(); mesh.setMatrixAt(n, _o.matrix);
          col[n * 3] = l[q + 5]; col[n * 3 + 1] = l[q + 6]; col[n * 3 + 2] = l[q + 7];
        }
      }
      mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    }
  }
}
