// Ground renderer: static grids displaced in the vertex shader from a world-sized R32F height texture.
// Terrain edits arrive as 32×32 chunk payloads and are written with texSubImage2D; no geometry is rebuilt.
//
// Detail by distance (each mesh is a draw call, the Quest's main cost, so far ground is drawn in fewer, coarser ones):
//   tiles     96 × 96 cells (24 m), every cell within LOD.full m, every 2nd within LOD.half, every 4th beyond
//   blocks    2 × 2 tiles as one mesh at every 4th cell, used when the whole block is beyond LOD.block
//   regions   4 × 4 tiles as one mesh at every 8th cell, beyond LOD.region
// Anything wholly beyond the haze is not drawn. A skirt round every mesh hides the cracks where detail changes.
import * as THREE from 'three';
import { CHUNK } from '../terrain/core.js';
import { MATERIALS, GRASS_COLOR, NMAT } from '../terrain/materials.js';

// Per material: x = speckle (gravel grit), y = strata on steep cut faces (clay), z = ripples (sand)
export const LOD = { full: 22, half: 44, block: 56, region: 104 };
const DETAIL = [[0, 0, 0], [0.2, 0.3, 0], [0.15, 0.25, 0], [0.15, 1.0, 0], [0.1, 0.1, 1.0], [1.0, 0, 0], [0.5, 0.6, 0], [0.35, 0.45, 0], [0.1, 0.2, 0], [1.0, 0.15, 0]];

const VERT = /* glsl */`
uniform highp sampler2D uH; uniform highp sampler2D uInfo;
uniform vec3 uOrigin; // ox, oz, cell
uniform vec2 uSize;   // nx, nz
uniform vec3 uPalette[${NMAT}]; uniform vec3 uDetail[${NMAT}]; uniform vec3 uGrass;
attribute float skirt;
varying vec3 vWorld; varying vec3 vColor; varying vec3 vSmooth; varying vec4 vDetail; // xyz = detail weights, w = grass
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  ivec2 tc = ivec2(position.xz), hi = ivec2(uSize) - 1;
  float h = texelFetch(uH, tc, 0).r;
  // a smooth normal from the neighbouring heights, blended with the facet normal in the fragment shader
  float hl = texelFetch(uH, clamp(tc + ivec2(-1, 0), ivec2(0), hi), 0).r, hr = texelFetch(uH, clamp(tc + ivec2(1, 0), ivec2(0), hi), 0).r;
  float hd = texelFetch(uH, clamp(tc + ivec2(0, -1), ivec2(0), hi), 0).r, hu = texelFetch(uH, clamp(tc + ivec2(0, 1), ivec2(0), hi), 0).r;
  vSmooth = vec3(hl - hr, 2.0 * uOrigin.z, hd - hu);
  vec4 info = texelFetch(uInfo, tc, 0);
  int m = int(info.r * 255.0 + 0.5);
  vec3 col = uPalette[m];
  float grass = m == 1 ? 1.0 - info.g : 0.0;
  if (m == 1) col = mix(uGrass, col, info.g);                 // undisturbed topsoil is grass
  else col *= mix(1.0, 0.86, info.g);                         // worked ground is a little darker
  col *= mix(1.0, 0.6, info.b);                               // wet
  col *= 0.9 + 0.2 * hash(position.xz);
  vColor = col; vDetail = vec4(uDetail[m], grass);
  vec3 w = vec3(uOrigin.x + position.x * uOrigin.z, h - skirt, uOrigin.y + position.z * uOrigin.z);
  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const FRAG = /* glsl */`
uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uSky; uniform vec3 uGroundLight;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
uniform vec4 uShadow[8];   // x, z, radius, strength: a soft pool of shade under each machine half
uniform vec4 uLamp[4];     // x, z, dir x, dir z: headlamp pools on the ground
uniform float uLampOn;
// PC graphics tier (render/quality.js): the sun's shadow map, cast by the machines, players and tools
uniform float uSMOn; uniform sampler2D uSM; uniform mat4 uSMMat; uniform float uSMTexel;
// a design to work to (game/jobs.js): centre and half size, and the plane (level at the centre, gradient, tolerance)
uniform float uDOn; uniform vec4 uDRect; uniform vec4 uDPlane;
varying vec3 vWorld; varying vec3 vColor; varying vec3 vSmooth; varying vec4 vDetail;
#include <packing>
float sunShadow() {
  if (uSMOn < 0.5) return 1.0;
  vec4 sc = uSMMat * vec4(vWorld, 1.0); vec3 c = sc.xyz / sc.w;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float z = c.z - 0.0012, s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += step(z, unpackRGBAToDepth(texture2D(uSM, c.xy + vec2(float(i), float(j)) * uSMTexel)));
  return s / 9.0;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  vec3 nf = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (nf.y < 0.0) nf = -nf;
  vec3 n = normalize(mix(nf, normalize(vSmooth), 0.5));       // still chunky, but rolling ground reads as ground
  float steep = 1.0 - n.y, dist = length(vWorld - cameraPosition), near = 1.0 - smoothstep(25.0, 60.0, dist);
  float n1 = vnoise(vWorld.xz * 0.33), n2 = vnoise(vWorld.xz * 2.1 + 7.0), n3 = vnoise(vWorld.xz * 9.0);
  vec3 col = vColor * (0.9 + 0.2 * n1);                                                   // broad mottling
  col = mix(col, col * vec3(0.78, 0.92, 0.66), vDetail.w * smoothstep(0.45, 0.75, n2) * 0.7);   // darker clumps in the grass
  col = mix(col, col * vec3(1.12, 1.06, 0.8), vDetail.w * smoothstep(0.6, 0.9, n1) * 0.5);      // and dry patches
  col *= 1.0 + vDetail.x * (n3 - 0.5) * 0.9 * near;                                       // grit
  float band = smoothstep(0.3, 0.5, abs(fract(vWorld.y * 2.3 + n1 * 0.7) - 0.5));         // strata show where clay is cut steep
  col *= 1.0 - vDetail.y * smoothstep(0.08, 0.5, steep) * (0.28 * band + 0.1);
  col *= 1.0 + vDetail.z * 0.07 * sin(vWorld.x * 6.0 + vWorld.z * 2.6 + n1 * 7.0) * near; // wind ripples in sand
  col *= 1.0 - 0.22 * smoothstep(0.12, 0.6, steep);                                       // steep faces sit a little in shade
  float d = max(dot(n, uSun), 0.0);
  vec3 light = uSunColor * d + mix(uGroundLight, uSky, n.y * 0.5 + 0.5);
  float shade = 1.0;
  for (int i = 0; i < 8; i++) { vec4 s = uShadow[i]; if (s.w > 0.0) shade *= 1.0 - s.w * smoothstep(1.0, 0.45, length(vWorld.xz - s.xy) / s.z); }
  float sun = uSMOn > 0.5 ? sunShadow() * mix(1.0, shade, 0.35) : shade; // with real shadows the pools only darken a little underneath
  light = uSunColor * d * sun + mix(uGroundLight, uSky, n.y * 0.5 + 0.5) * (0.55 + 0.45 * shade);
  if (uLampOn > 0.01) for (int i = 0; i < 4; i++) { vec2 v = vWorld.xz - uLamp[i].xy; float al = dot(v, uLamp[i].zw), lat = length(v - uLamp[i].zw * al);
    light += vec3(1.0, 0.88, 0.62) * uLampOn * 1.1 * smoothstep(0.0, 2.5, al) * smoothstep(18.0, 5.0, al) * smoothstep(al * 0.42 + 1.2, 0.0, lat); }
  col *= light;
  if (uDOn > 0.5) { // cut and fill: red where the ground stands above the design, blue where it is below, green on grade
    vec2 q = vWorld.xz - uDRect.xy, o = abs(q) - uDRect.zw;
    float edge = max(o.x, o.y);
    if (edge < 0.0) {
      float dh = vWorld.y - (uDPlane.x + uDPlane.y * q.x + uDPlane.z * q.y), tol = uDPlane.w;
      vec3 tint = abs(dh) <= tol ? vec3(0.25, 0.85, 0.3) : dh > 0.0 ? vec3(0.95, 0.25, 0.18) : vec3(0.2, 0.45, 1.0);
      float k = abs(dh) <= tol ? 0.35 : 0.3 + 0.4 * smoothstep(tol, 0.4, abs(dh));
      float ring = 1.0 - smoothstep(0.0, 0.012, abs(fract(dh / 0.1 + 0.5) - 0.5) * 0.1);  // a contour every 10 cm off grade
      col = mix(col, tint * (0.6 + 0.4 * light), k) * (1.0 - 0.35 * ring * step(tol, abs(dh)));
    }
    if (abs(edge) < 0.06) col = mix(col, vec3(1.0, 0.85, 0.2), 0.85);                 // the pad's edge, as if pegged out
  }
  float fog = smoothstep(uFogNear, uFogFar, dist);
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  #include <colorspace_fragment>
}`;

export class Ground {
  /** @param {THREE.WebGLRenderer} renderer @param {import('../terrain/client.js').TerrainClient} terrain */
  constructor(renderer, terrain, env) {
    this.renderer = renderer; this.terrain = terrain; this.env = env;
    const { nx, nz, cell, ox, oz } = terrain;
    this.hTex = new THREE.DataTexture(terrain.h, nx, nz, THREE.RedFormat, THREE.FloatType);
    this.infoTex = new THREE.DataTexture(terrain.info, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const t of [this.hTex, this.infoTex]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = false; t.unpackAlignment = 1; t.needsUpdate = true; }
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uH: { value: this.hTex }, uInfo: { value: this.infoTex }, uOrigin: { value: new THREE.Vector3(ox, oz, cell) },
        uPalette: { value: MATERIALS.map((m) => new THREE.Vector3(...m.color)) }, uGrass: { value: new THREE.Vector3(...GRASS_COLOR) },
        uDetail: { value: DETAIL.map((d) => new THREE.Vector3(...d)) }, uSize: { value: new THREE.Vector2(nx, nz) },
        uSun: { value: env.sunDir }, uSunColor: { value: env.sunColor }, uSky: { value: env.skyLight }, uGroundLight: { value: env.groundLight },
        uFogColor: { value: env.fogColor }, uFogNear: { value: env.fogNear }, uFogFar: { value: env.fogFar },
        uShadow: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) }, uLamp: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 1, 0)) }, uLampOn: env.lamps,
        uSMOn: { value: 0 }, uSM: { value: null }, uSMMat: { value: new THREE.Matrix4() }, uSMTexel: { value: 1 / 2048 },
        uDOn: { value: 0 }, uDRect: { value: new THREE.Vector4() }, uDPlane: { value: new THREE.Vector4() },
      },
    });
    this.group = new THREE.Group(); this.tiles = []; this.blocks = []; this.regions = [];
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < terrain.h.length; i += 7) { const v = terrain.h[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    this.yRange = [Math.min(-8, lo - 10), Math.max(16, hi + 30)]; // room for digging down and heaping up
    const tx = Math.ceil(nx / 96), tz = Math.ceil(nz / 96), T = Math.ceil((nx - 1) / tx), U = Math.ceil((nz - 1) / tz);
    const span = (a0, b0, a1, b1) => [a0 * T, b0 * U, Math.min(nx - 1, a1 * T), Math.min(nz - 1, b1 * U)];
    const piece = (rect, steps) => {
      const [i0, j0, i1, j1] = rect, geos = steps.map((st) => this._grid(i0, j0, i1, j1, st)), mesh = new THREE.Mesh(geos[0], this.material);
      const box = new THREE.Box3(new THREE.Vector3(ox + i0 * cell, this.yRange[0], oz + j0 * cell), new THREE.Vector3(ox + i1 * cell, this.yRange[1], oz + j1 * cell));
      for (const g of geos) { g.boundingBox = box; g.boundingSphere = box.getBoundingSphere(new THREE.Sphere()); }
      mesh.matrixAutoUpdate = false; mesh.visible = false; this.group.add(mesh);
      return { mesh, geos, x0: box.min.x, z0: box.min.z, x1: box.max.x, z1: box.max.z, center: box.getCenter(new THREE.Vector3()) };
    };
    for (let c = 0; c < tz; c += 4) for (let r = 0; r < tx; r += 4) {
      const region = piece(span(r, c, Math.min(tx, r + 4), Math.min(tz, c + 4)), [8]); region.blocks = []; this.regions.push(region);
      for (let b = c; b < Math.min(tz, c + 4); b += 2) for (let a = r; a < Math.min(tx, r + 4); a += 2) {
        const block = piece(span(a, b, Math.min(tx, a + 2), Math.min(tz, b + 2)), [4]); block.tiles = []; region.blocks.push(block); this.blocks.push(block);
        for (let jj = b; jj < Math.min(tz, b + 2); jj++) for (let ii = a; ii < Math.min(tx, a + 2); ii++) { const t = piece(span(ii, jj, ii + 1, jj + 1), [1, 2, 4]); block.tiles.push(t); this.tiles.push(t); }
      }
    }
    this._queue = [];
    terrain.onChunks((chunks) => { for (const c of chunks) this._queue.push(c); });
    this._ready = false;
  }

  _grid(i0, j0, i1, j1, step) { // positions are cell coordinates; a skirt ring hides LOD cracks
    const xs = [], zs = [];
    for (let i = i0; i < i1; i += step) xs.push(i); xs.push(i1);
    for (let j = j0; j < j1; j += step) zs.push(j); zs.push(j1);
    const w = xs.length, d = zs.length, pos = [], skirt = [], idx = [];
    for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) { pos.push(xs[a], 0, zs[b]); skirt.push(0); }
    for (let b = 0; b < d - 1; b++) for (let a = 0; a < w - 1; a++) {
      const p = b * w + a, q = p + 1, r = p + w, s = r + 1;
      if ((a + b) & 1) idx.push(p, r, q, q, r, s); else idx.push(p, r, s, p, s, q);
    }
    const ring = [];
    for (let a = 0; a < w; a++) ring.push(a); for (let b = 1; b < d; b++) ring.push(b * w + w - 1);
    for (let a = w - 2; a >= 0; a--) ring.push((d - 1) * w + a); for (let b = d - 2; b >= 1; b--) ring.push(b * w);
    const base = pos.length / 3;
    for (const v of ring) { pos.push(pos[v * 3], 0, pos[v * 3 + 2]); skirt.push(0.6); }
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], b = ring[(k + 1) % ring.length], c = base + k, e = base + (k + 1) % ring.length;
      idx.push(a, b, c, b, e, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('skirt', new THREE.Float32BufferAttribute(skirt, 1));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    return g;
  }

  /** Draw a design (game/jobs.js Design) as cut and fill colours over its patch, or nothing (null). */
  setDesign(d) {
    const u = this.material.uniforms; u.uDOn.value = d ? 1 : 0;
    if (d) { u.uDRect.value.set(d.x, d.z, d.w / 2, d.d / 2); u.uDPlane.value.set(d.y, d.sx, d.sz, d.tol); }
  }

  /** Shade and lamp pools for the machines: list of {x, z, r} (up to 8) and {x, z, dx, dz} (up to 4). */
  setMachineLighting(shadows, lamps) {
    const S = this.material.uniforms.uShadow.value, Lm = this.material.uniforms.uLamp.value, sun = this.env.sunDir;
    const k = Math.min(2.2, 1.1 / Math.max(sun.y, 0.25)); // shade falls away from the sun, further when it is low
    for (let i = 0; i < 8; i++) { const s = shadows[i]; if (s) S[i].set(s.x - sun.x * k, s.z - sun.z * k, s.r, 0.62); else S[i].set(0, 0, 1, 0); }
    for (let i = 0; i < 4; i++) { const l = lamps[i]; if (l) Lm[i].set(l.x, l.z, l.dx, l.dz); else Lm[i].set(1e6, 1e6, 1, 0); }
  }

  /** Upload queued chunk edits and pick LODs. Call once per frame before render. */
  update(camPos) {
    const r = this.renderer, gl = r.getContext();
    if (!this._ready) { r.initTexture(this.hTex); r.initTexture(this.infoTex); this._ready = true; this._queue.length = 0; }
    else if (this._queue.length) {
      const cnx = Math.ceil(this.terrain.nx / CHUNK);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const hT = r.properties.get(this.hTex).__webglTexture, iT = r.properties.get(this.infoTex).__webglTexture;
      r.state.activeTexture(gl.TEXTURE0);
      r.state.bindTexture(gl.TEXTURE_2D, hT);
      for (const c of this._queue) gl.texSubImage2D(gl.TEXTURE_2D, 0, (c.id % cnx) * CHUNK, ((c.id / cnx) | 0) * CHUNK, CHUNK, CHUNK, gl.RED, gl.FLOAT, c.h);
      r.state.bindTexture(gl.TEXTURE_2D, iT);
      for (const c of this._queue) gl.texSubImage2D(gl.TEXTURE_2D, 0, (c.id % cnx) * CHUNK, ((c.id / cnx) | 0) * CHUNK, CHUNK, CHUNK, gl.RGBA, gl.UNSIGNED_BYTE, c.info);
      r.state.bindTexture(gl.TEXTURE_2D, null);
      this._queue.length = 0;
    }
    this.pickLod(camPos);
  }
  /** Which meshes to draw, and how finely, for a viewer at camPos. */
  pickLod(camPos) {
    const LOD_ = this.lod || LOD, fog = this.material.uniforms.uFogFar.value + 10, near = (p) => Math.hypot(Math.max(p.x0 - camPos.x, 0, camPos.x - p.x1), Math.max(p.z0 - camPos.z, 0, camPos.z - p.z1));
    const show = (p, on) => { p.mesh.visible = on; };
    let n = 0;
    for (const R of this.regions) {
      const dR = near(R);
      if (dR > fog) { show(R, false); for (const B of R.blocks) { show(B, false); for (const t of B.tiles) show(t, false); } continue; }
      if (dR > LOD_.region) { show(R, true); n++; for (const B of R.blocks) { show(B, false); for (const t of B.tiles) show(t, false); } continue; }
      show(R, false);
      for (const B of R.blocks) {
        const dB = near(B);
        if (dB > fog) { show(B, false); for (const t of B.tiles) show(t, false); continue; }
        if (dB > LOD_.block) { show(B, true); n++; for (const t of B.tiles) show(t, false); continue; }
        show(B, false);
        for (const t of B.tiles) {
          const d = near(t); if (d > fog) { show(t, false); continue; }
          const g = t.geos[d < LOD_.full ? 0 : d < LOD_.half ? 1 : 2]; if (t.mesh.geometry !== g) t.mesh.geometry = g;
          show(t, true); n++;
        }
      }
    }
    this.drawn = n;
  }
}
