// The water surface: one translucent mesh over the tiles that have water (terrain/water.js), re-posed from the sim's
// 10 Hz snapshots. Each wet tile is a (TILE+1)² grid of water-cell centres, reaching one cell into its neighbours so
// tiles join without seams; all tiles share one mesh and one draw call, grown when more tiles are wet. Each tile keeps
// its slot in the mesh, and only the tiles that changed (and the neighbours whose edge they share) are rewritten and
// re-uploaded: a river running steadily costs next to nothing.
// Ripples scroll along the local flow direction; no refraction.
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec2 flow; attribute float depth;
varying vec3 vWorld; varying vec2 vFlow; varying float vDepth;
void main() { vWorld = position; vFlow = flow; vDepth = depth; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */`
uniform float uTime; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar; uniform vec3 uSun;
varying vec3 vWorld; varying vec2 vFlow; varying float vDepth;
void main() {
  if (vDepth < 0.025) discard;
  float sp = length(vFlow); vec2 dir = sp > 0.01 ? vFlow / sp : vec2(1.0, 0.0);
  float along = dot(vWorld.xz, dir), across = dot(vWorld.xz, vec2(-dir.y, dir.x));
  float r = sin(along * 5.0 - uTime * (1.5 + sp * 4.0) + sin(across * 3.1) * 1.3) * 0.5 + sin(along * 11.0 - uTime * (3.0 + sp * 6.0) + across * 2.3) * 0.25;
  vec3 deep = vec3(0.16, 0.30, 0.34), shallow = vec3(0.45, 0.50, 0.42);
  vec3 col = mix(shallow, deep, smoothstep(0.05, 0.9, vDepth));
  col += vec3(0.75, 0.8, 0.8) * smoothstep(0.55, 0.75, r) * (0.15 + min(sp, 2.5) * 0.25);   // glints, whiter where it runs fast
  float fog = smoothstep(uFogNear, uFogFar, length(vWorld - cameraPosition));
  gl_FragColor = vec4(mix(col, uFogColor, fog), mix(0.55, 0.9, smoothstep(0.03, 0.7, vDepth)));
  #include <colorspace_fragment>
}`;

export class WaterMesh {
  constructor(terrain, env) {
    this.terrain = terrain; this.mesh = null; this.env = env; this.time = 0; this.cap = 0;
    this.slotOf = new Map(); this.free = []; this.top = 0; this.tiles = 0;
    terrain.onWater((w, changed) => this.apply(w, changed)); if (terrain.water) this.apply(terrain.water, null);
  }
  _build(cap) {
    const V = (this.T + 1) ** 2, g = new THREE.BufferGeometry(), idx = new Uint32Array(cap * this.T * this.T * 6); let o = 0;
    for (let s = 0; s < cap; s++) for (let j = 0; j < this.T; j++) for (let i = 0; i < this.T; i++) {
      const a = s * V + j * (this.T + 1) + i, b = a + this.T + 1; idx[o++] = a; idx[o++] = b; idx[o++] = a + 1; idx[o++] = a + 1; idx[o++] = b; idx[o++] = b + 1;
    }
    this.pos = new Float32Array(cap * V * 3); this.flow = new Float32Array(cap * V * 2); this.depth = new Float32Array(cap * V);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('flow', new THREE.BufferAttribute(this.flow, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('depth', new THREE.BufferAttribute(this.depth, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage)); this.idx = idx;
    if (!this.mat) this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uFogColor: { value: this.env.fogColor }, uFogNear: { value: this.env.fogNear }, uFogFar: { value: this.env.fogFar }, uSun: { value: this.env.sunDir } } });
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.geometry = g; }
    else { this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; if (this.onReady) this.onReady(this.mesh); }
    this.cap = cap; this.slotOf.clear(); this.free.length = 0; this.top = 0;
  }
  /** @param w the WaterMirror  @param changed tiles that changed (null: all of them) */
  apply(w, changed) {
    this.T = w.tile; const T = this.T, V = (T + 1) ** 2;
    if (!this.mesh || w.wet.size > this.cap) { this._build(Math.max(16, Math.ceil(w.wet.size * 1.5))); changed = null; }
    // what to rewrite: the changed tiles, and the tiles west and north of them (their last row and column of vertices lie in these)
    const todo = new Set();
    if (changed === null) { for (const t of this.slotOf.keys()) todo.add(t); for (const t of w.wet) todo.add(t); }
    else for (const t of changed) { todo.add(t); if (t % w.tnx) todo.add(t - 1); if (t >= w.tnx) todo.add(t - w.tnx); if (t % w.tnx && t >= w.tnx) todo.add(t - w.tnx - 1); }
    const { pos, flow, depth } = this, ranges = [], Q6 = T * T * 6;
    for (const t of todo) {
      let s = this.slotOf.get(t);
      if (!w.wet.has(t)) { // dry now: empty its slot (no triangles) and give the slot back
        if (s === undefined) continue;
        depth.fill(0, s * V, (s + 1) * V); this.idx.fill(s * V, s * Q6, (s + 1) * Q6); ranges.push(s); this.slotOf.delete(t); this.free.push(s); continue;
      }
      if (s === undefined) { s = this.free.length ? this.free.pop() : this.top++; this.slotOf.set(t, s); }
      const i0 = (t % w.tnx) * T, j0 = ((t / w.tnx) | 0) * T;
      for (let jj = 0; jj <= T; jj++) for (let ii = 0; ii <= T; ii++) {
        const i = Math.min(w.nx - 1, i0 + ii), j = Math.min(w.nz - 1, j0 + jj), c = j * w.nx + i, v = s * V + jj * (T + 1) + ii, d = w.depth[c];
        pos[v * 3] = w.ox + (i + 0.5) * w.cell; pos[v * 3 + 2] = w.oz + (j + 0.5) * w.cell;
        pos[v * 3 + 1] = w.bed[c] + (d > 0.025 ? d : -0.15); // dry cells tuck under the ground
        depth[v] = d; flow[v * 2] = w.vx[c]; flow[v * 2 + 1] = w.vz[c];
      }
      // triangles only where there is water: a stream 3 m wide leaves most of its 8 m tile dry, and a dry square drawn
      // and thrown away pixel by pixel still costs the headset its fill
      let o = s * Q6; const base = s * V, W1 = T + 1;
      for (let jj = 0; jj < T; jj++) for (let ii = 0; ii < T; ii++) {
        const a = base + jj * W1 + ii, b = a + W1;
        if (depth[a] > 0.02 || depth[a + 1] > 0.02 || depth[b] > 0.02 || depth[b + 1] > 0.02) { this.idx[o++] = a; this.idx[o++] = b; this.idx[o++] = a + 1; this.idx[o++] = a + 1; this.idx[o++] = b; this.idx[o++] = b + 1; }
        else for (let q = 0; q < 6; q++) this.idx[o++] = base; // a degenerate triangle: nothing drawn
      }
      ranges.push(s);
    }
    this.mesh.geometry.setDrawRange(0, this.top * T * T * 6);
    const a = this.mesh.geometry.attributes;
    for (const [attr, n] of [[a.position, 3], [a.flow, 2], [a.depth, 1]]) {
      attr.clearUpdateRanges(); for (const s of ranges) attr.addUpdateRange(s * V * n, V * n); if (ranges.length) attr.needsUpdate = true;
    }
    const ix = this.mesh.geometry.index; ix.clearUpdateRanges(); for (const s of ranges) ix.addUpdateRange(s * Q6, Q6); if (ranges.length) ix.needsUpdate = true;
    let wetQuads = 0; for (let k = 0; k < this.top * Q6; k += 6) if (this.idx[k] !== this.idx[k + 1]) wetQuads++; this.quads = wetQuads; // (for the tests and the HUD)
    this.tiles = this.slotOf.size; this.updated = ranges.length;
  }
  update(dt) { this.time += dt; if (this.mat) this.mat.uniforms.uTime.value = this.time; }
}
