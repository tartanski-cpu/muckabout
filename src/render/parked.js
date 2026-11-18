// Parked machines drawn in a handful of draw calls. A machine is drawn as one merged mesh per part that moves (boom,
// bucket, wheels, ...) plus its ink outline, glass, cap, labels and load: some 20 draw calls each, and four parked in
// the yard cost the Quest some 70 of its 150. Once a machine has stood still for a moment, every mesh on it that is
// drawn the same way is baked into one world-space mesh per material, and the originals are taken off the render
// layers (not hidden: other code owns `visible`). The bake is undone the same frame anything on the machine moves or
// changes (a pose, a load, shadows switched on), so nobody ever sees a stale pose. Drawing only: the sim never sees it.
//
// Parts painted one plain colour (handrails, the exhaust cap) are baked together, their colour moved into the vertices.
// Left live, not baked: the cab controls (they move under your hands, and are only drawn within reach), a handrail
// while a hand lights it up, anything in the seat (a player), and instanced meshes with their own per-instance colours
// (the clods in a load).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const STILL = 1.0;   // seconds without a change before a machine is baked
const TOL = 0.004;   // drift from the baked pose that is let pass (m, or about rad): a parked machine still settles a hair
const MAX_INST = 400; // instanced meshes with more instances than this stay live
const _m = new THREE.Matrix4(), _im = new THREE.Matrix4();
// one shared material for every plain Lambert part, its colour carried per vertex (per side, as two-sided parts differ)
const PLAIN = new Map();
function plainMat(M) {
  if (!M.isMeshLambertMaterial || M.map || M.transparent || M.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || (M.emissive && M.emissive.getHex())) return null;
  const k = M.side; // flat shaded, smooth ones too: thin rails and caps, where the difference does not show
  if (!PLAIN.has(k)) PLAIN.set(k, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: M.side }));
  return PLAIN.get(k);
}

export class ParkedMachines {
  /** extra(): a number folded into every machine's signature, so a change to it (shadows on or off) undoes all bakes. */
  constructor(scene, machines, extra = () => 0) {
    this.scene = scene; this.extra = extra; this.enabled = true; this.undone = 0;
    this.st = machines.map((m) => ({ m, sig: null, buf: null, src: [], still: 0, baked: null, hidden: [] })); // buffers reused: no garbage each frame
  }
  get count() { return this.st.filter((s) => s.baked).length; }
  isBaked(m) { return !!this.st.find((s) => s.m === m)?.baked; }

  /** The meshes of a machine that can be baked: visible, single-material, not under its controls or seat. */
  _sources(m, out = []) {
    out.length = 0;
    const rails = m.rails || [], ctl = m.controlRoots || [];
    const walk = (o) => {
      if (!o.visible || o === m.seat || (ctl.includes(o) && !rails.some((c) => c.root === o))) return;
      if (o.material?.emissive && o.material.emissive.getHex() !== 0) return; // a handrail lit up under a hand: drawn live
      if ((o.isMesh || o.isInstancedMesh) && !Array.isArray(o.material) && !(o.isInstancedMesh && (o.instanceColor || o.count > MAX_INST))) out.push(o);
      for (const c of o.children) walk(c);
    };
    walk(m.root);
    return out;
  }
  _signature(m, src, into) {
    let n = src.length * 16 + 2 + m.rigs.length; for (const o of src) if (o.isInstancedMesh) n += o.count * 3;
    const s = into && into.length === n ? into : new Float64Array(n); let k = 0;
    for (const o of src) {
      s.set(o.matrixWorld.elements, k); k += 16;
      if (o.isInstancedMesh) { const a = o.instanceMatrix.array; for (let i = 0; i < o.count; i++) { s[k++] = a[i * 16 + 12]; s[k++] = a[i * 16 + 13]; s[k++] = a[i * 16 + 14]; } } // the track pads, carried round as the tracks turn
    }
    s[k++] = src.length; s[k++] = this.extra();
    for (const r of m.rigs) s[k++] = r.field.rev || 0;
    return s;
  }
  _same(a, b) {
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > TOL) return false;
    return true;
  }

  update(dt) {
    for (const s of this.st) {
      // compared with where it was when it came to rest (not with the last frame), so a slow creep still counts
      const src = this._sources(s.m, s.src), sig = s.buf = this._signature(s.m, src, s.buf), same = this._same(s.sig, sig);
      if (!same || !this.enabled) { s.buf = s.sig; s.sig = sig; s.still = 0; if (s.baked) { this._undo(s); this.undone++; } continue; }
      s.still += dt;
      if (!s.baked && s.still >= STILL) this._bake(s, src);
    }
  }

  _bake(s, src) {
    const groups = new Map();
    for (const o of src) {
      const g = o.geometry, M = o.material, plain = plainMat(M), names = plain ? 'color,normal,position' : Object.keys(g.attributes).sort().join(',');
      const key = (plain ? plain.uuid : M.uuid) + '|' + names + '|' + o.renderOrder;
      if (!groups.has(key)) groups.set(key, { mat: plain || M, from: o, parts: [], srcs: [] });
      const G = groups.get(key); G.srcs.push(o);
      const one = (mat) => { const p = g.index ? g.toNonIndexed() : g.clone(); for (const n of Object.keys(p.morphAttributes)) delete p.morphAttributes[n]; p.groups = []; p.applyMatrix4(mat);
        if (plain) { // its colour (times its vertex colours, if it has them) into the vertices
          const vc = M.vertexColors && p.attributes.color, c = new Float32Array(p.attributes.position.count * 3);
          for (let i = 0, v = 0; i < c.length; i += 3, v++) { c[i] = M.color.r * (vc ? vc.getX(v) : 1); c[i + 1] = M.color.g * (vc ? vc.getY(v) : 1); c[i + 2] = M.color.b * (vc ? vc.getZ(v) : 1); }
          for (const n of Object.keys(p.attributes)) if (n !== 'position' && n !== 'normal') p.deleteAttribute(n);
          p.setAttribute('color', new THREE.BufferAttribute(c, 3));
        }
        if (mat.determinant() < 0) for (const a of Object.values(p.attributes)) { const w = a.itemSize, A = a.array; for (let v = 0; v + 2 < a.count; v += 3) for (let c = 0; c < w; c++) { const t = A[(v + 1) * w + c]; A[(v + 1) * w + c] = A[(v + 2) * w + c]; A[(v + 2) * w + c] = t; } } // mirrored: keep the faces facing out
        G.parts.push(p); };
      if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, _im); one(_m.multiplyMatrices(o.matrixWorld, _im)); }
      else one(o.matrixWorld);
    }
    const meshes = [];
    for (const G of groups.values()) {
      if (!G.parts.length) continue;
      const geo = mergeGeometries(G.parts); for (const p of G.parts) p.dispose();
      if (!geo) { for (const o of G.srcs) o._unbaked = true; continue; } // could not merge: leave these drawn as they are
      const mesh = new THREE.Mesh(geo, G.mat), f = G.from;
      mesh.matrixAutoUpdate = false; mesh.castShadow = f.castShadow; mesh.receiveShadow = f.receiveShadow; mesh.renderOrder = f.renderOrder;
      mesh.onBeforeRender = f.onBeforeRender; mesh.name = `${s.m.id}.parked`;
      geo.computeBoundingSphere(); meshes.push(mesh);
    }
    const hidden = [];
    for (const o of src) { if (o._unbaked) { delete o._unbaked; continue; } hidden.push([o, o.layers.mask]); o.layers.mask = 0; }
    const root = new THREE.Group(); root.name = `${s.m.id}.parked`; for (const x of meshes) root.add(x);
    root.updateMatrixWorld(true); this.scene.add(root);
    s.baked = root; s.hidden = hidden;
  }
  _undo(s) {
    for (const [o, mask] of s.hidden) o.layers.mask = mask;
    s.hidden = [];
    this.scene.remove(s.baked); for (const x of s.baked.children) x.geometry.dispose();
    s.baked = null;
  }
}
