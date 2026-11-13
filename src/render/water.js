// The river surface: one translucent grid mesh over the water cells, re-posed from the sim's 10 Hz snapshots.
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
    this.terrain = terrain; this.mesh = null; this.env = env; this.time = 0;
    terrain.onWater((w) => this.apply(w)); if (terrain.water) this.apply(terrain.water);
  }
  _build(w) {
    const g = new THREE.BufferGeometry(), n = w.nx * w.nz, idx = [];
    this.pos = new Float32Array(n * 3); this.flow = new Float32Array(n * 2); this.depth = new Float32Array(n);
    for (let j = 0; j < w.nz; j++) for (let i = 0; i < w.nx; i++) { const k = j * w.nx + i; this.pos[k * 3] = w.ox + (i + 0.5) * w.cell; this.pos[k * 3 + 2] = w.oz + (j + 0.5) * w.cell; }
    for (let j = 0; j < w.nz - 1; j++) for (let i = 0; i < w.nx - 1; i++) { const a = j * w.nx + i; idx.push(a, a + w.nx, a + 1, a + 1, a + w.nx, a + w.nx + 1); }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('flow', new THREE.BufferAttribute(this.flow, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('depth', new THREE.BufferAttribute(this.depth, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uFogColor: { value: this.env.fogColor }, uFogNear: { value: this.env.fogNear }, uFogFar: { value: this.env.fogFar }, uSun: { value: this.env.sunDir } } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    if (this.onReady) this.onReady(this.mesh);
  }
  apply(w) {
    if (!this.mesh) this._build(w);
    const { pos, flow, depth } = this, n = w.nx * w.nz;
    for (let k = 0; k < n; k++) {
      const d = w.depth[k]; depth[k] = d;
      pos[k * 3 + 1] = w.bed[k] + (d > 0.025 ? d : -0.15); // dry cells tuck under the ground
      flow[k * 2] = w.vx[k]; flow[k * 2 + 1] = w.vz[k];
    }
    const a = this.mesh.geometry.attributes; a.position.needsUpdate = true; a.flow.needsUpdate = true; a.depth.needsUpdate = true;
  }
  update(dt) { this.time += dt; if (this.mat) this.mat.uniforms.uTime.value = this.time; }
}
