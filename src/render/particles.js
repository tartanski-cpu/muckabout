// Soft round billboards for smoke, dust, spray and splashes: one instanced draw call for all of them.
// Cosmetic only (not part of the sim, so it may use Math.random and real frame time).
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec3 iPos; attribute float iSize; attribute vec4 iColor;
varying vec2 vUv; varying vec4 vColor; varying float vDist;
void main() { vec4 mv = viewMatrix * vec4(iPos, 1.0); mv.xy += position.xy * iSize; vUv = position.xy; vColor = iColor; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`;
const FRAG = /* glsl */`
uniform float uLight; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
varying vec2 vUv; varying vec4 vColor; varying float vDist;
void main() {
  float r = dot(vUv, vUv); if (r > 1.0) discard;
  float a = vColor.a * (1.0 - r) * (1.0 - r);
  vec3 col = mix(vColor.rgb * uLight, uFogColor, smoothstep(uFogNear, uFogFar, vDist));
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

export class Particles {
  constructor(scene, env, max = 700) {
    this.max = max; this.n = 0; this.env = env;
    const f = (k) => new Float32Array(max * k);
    this.p = f(3); this.v = f(3); this.age = f(1); this.life = f(1); this.s0 = f(1); this.s1 = f(1); this.col = f(4); this.grav = f(1); this.drag = f(1);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(f(3), 3).setUsage(THREE.DynamicDrawUsage); this.aSize = new THREE.InstancedBufferAttribute(f(1), 1).setUsage(THREE.DynamicDrawUsage); this.aCol = new THREE.InstancedBufferAttribute(f(4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSize', this.aSize); g.setAttribute('iColor', this.aCol); g.instanceCount = 0;
    this.u = { uLight: { value: 1 }, uFogColor: { value: env.fogColor }, uFogNear: { value: env.fogNear }, uFogFar: { value: env.fogFar } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthWrite: false }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; scene.add(this.mesh);
  }
  /** o: {x,y,z, vx,vy,vz, life, s0, s1, r,g,b,a, grav (m/s², + falls, − rises), drag (1/s)} */
  emit(o) {
    let i = this.n; if (i >= this.max) i = Math.floor(Math.random() * this.max); else this.n++; // full: overwrite one at random
    this.p[i * 3] = o.x; this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z; this.v[i * 3] = o.vx || 0; this.v[i * 3 + 1] = o.vy || 0; this.v[i * 3 + 2] = o.vz || 0;
    this.age[i] = 0; this.life[i] = o.life; this.s0[i] = o.s0; this.s1[i] = o.s1; this.col[i * 4] = o.r; this.col[i * 4 + 1] = o.g; this.col[i * 4 + 2] = o.b; this.col[i * 4 + 3] = o.a;
    this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 1;
  }
  update(dt) {
    const { p, v, age, life, s0, s1, col, grav, drag } = this, P = this.aPos.array, S = this.aSize.array, C = this.aCol.array;
    for (let i = 0; i < this.n; i++) {
      age[i] += dt;
      if (age[i] >= life[i]) { const l = --this.n; for (const [arr, k] of [[p, 3], [v, 3], [col, 4]]) for (let q = 0; q < k; q++) arr[i * k + q] = arr[l * k + q]; age[i] = age[l]; life[i] = life[l]; s0[i] = s0[l]; s1[i] = s1[l]; grav[i] = grav[l]; drag[i] = drag[l]; i--; continue; }
      const k = Math.max(0, 1 - drag[i] * dt); v[i * 3] = v[i * 3] * k + 0.25 * dt; v[i * 3 + 1] = v[i * 3 + 1] * k - grav[i] * dt; v[i * 3 + 2] *= k; // a breath of wind along +x
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      const t = age[i] / life[i];
      P[i * 3] = p[i * 3]; P[i * 3 + 1] = p[i * 3 + 1]; P[i * 3 + 2] = p[i * 3 + 2]; S[i] = s0[i] + (s1[i] - s0[i]) * Math.sqrt(t);
      C[i * 4] = col[i * 4]; C[i * 4 + 1] = col[i * 4 + 1]; C[i * 4 + 2] = col[i * 4 + 2]; C[i * 4 + 3] = col[i * 4 + 3] * Math.min(1, t * 8) * (1 - t);
    }
    this.mesh.geometry.instanceCount = this.n; this.aPos.needsUpdate = this.aSize.needsUpdate = this.aCol.needsUpdate = true;
    this.u.uLight.value = Math.min(1.15, this.env.ambient ?? 1);
  }
}
