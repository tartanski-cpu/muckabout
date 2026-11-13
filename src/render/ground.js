// Ground renderer: static grids displaced in the vertex shader from a world-sized R32F height texture.
// Terrain edits arrive as 32×32 chunk payloads and are written with texSubImage2D; no geometry is rebuilt.
import * as THREE from 'three';
import { CHUNK } from '../terrain/core.js';
import { MATERIALS, GRASS_COLOR, NMAT } from '../terrain/materials.js';

const VERT = /* glsl */`
uniform highp sampler2D uH; uniform highp sampler2D uInfo;
uniform vec3 uOrigin; // ox, oz, cell
uniform vec3 uPalette[${NMAT}]; uniform vec3 uGrass;
attribute float skirt;
varying vec3 vWorld; varying vec3 vColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  ivec2 tc = ivec2(position.xz);
  float h = texelFetch(uH, tc, 0).r;
  vec4 info = texelFetch(uInfo, tc, 0);
  int m = int(info.r * 255.0 + 0.5);
  vec3 col = uPalette[m];
  if (m == 1) col = mix(uGrass, col, info.g);                 // undisturbed topsoil is grass
  else col *= mix(1.0, 0.86, info.g);                         // worked ground is a little darker
  col *= mix(1.0, 0.62, info.b);                              // wet
  col *= 0.88 + 0.24 * hash(position.xz);
  vColor = col;
  vec3 w = vec3(uOrigin.x + position.x * uOrigin.z, h - skirt, uOrigin.y + position.z * uOrigin.z);
  vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const FRAG = /* glsl */`
uniform vec3 uSun; uniform vec3 uSunColor; uniform vec3 uSky; uniform vec3 uGroundLight;
uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
varying vec3 vWorld; varying vec3 vColor;
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;
  float d = max(dot(n, uSun), 0.0);
  vec3 light = uSunColor * d + mix(uGroundLight, uSky, n.y * 0.5 + 0.5);
  vec3 col = vColor * light;
  float fog = smoothstep(uFogNear, uFogFar, length(vWorld - cameraPosition));
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
  #include <colorspace_fragment>
}`;

export class Ground {
  /** @param {THREE.WebGLRenderer} renderer @param {import('../terrain/client.js').TerrainClient} terrain */
  constructor(renderer, terrain, env) {
    this.renderer = renderer; this.terrain = terrain;
    const { nx, nz, cell, ox, oz } = terrain;
    this.hTex = new THREE.DataTexture(terrain.h, nx, nz, THREE.RedFormat, THREE.FloatType);
    this.infoTex = new THREE.DataTexture(terrain.info, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    for (const t of [this.hTex, this.infoTex]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = false; t.unpackAlignment = 1; t.needsUpdate = true; }
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uH: { value: this.hTex }, uInfo: { value: this.infoTex }, uOrigin: { value: new THREE.Vector3(ox, oz, cell) },
        uPalette: { value: MATERIALS.map((m) => new THREE.Vector3(...m.color)) }, uGrass: { value: new THREE.Vector3(...GRASS_COLOR) },
        uSun: { value: env.sunDir }, uSunColor: { value: env.sunColor }, uSky: { value: env.skyLight }, uGroundLight: { value: env.groundLight },
        uFogColor: { value: env.fogColor }, uFogNear: { value: env.fogNear }, uFogFar: { value: env.fogFar },
      },
    });
    this.group = new THREE.Group(); this.tiles = [];
    const tx = Math.ceil(nx / 96), tz = Math.ceil(nz / 96), T = Math.ceil((nx - 1) / tx), U = Math.ceil((nz - 1) / tz);
    for (let b = 0; b < tz; b++) for (let a = 0; a < tx; a++) {
      const i0 = a * T, j0 = b * U, i1 = Math.min(nx - 1, i0 + T), j1 = Math.min(nz - 1, j0 + U);
      const geos = [this._grid(i0, j0, i1, j1, 1), this._grid(i0, j0, i1, j1, 2)];
      const mesh = new THREE.Mesh(geos[0], this.material);
      const box = new THREE.Box3(new THREE.Vector3(ox + i0 * cell, -8, oz + j0 * cell), new THREE.Vector3(ox + i1 * cell, 16, oz + j1 * cell));
      for (const g of geos) { g.boundingBox = box; g.boundingSphere = box.getBoundingSphere(new THREE.Sphere()); }
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh); this.tiles.push({ mesh, geos, center: box.getCenter(new THREE.Vector3()) });
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
    for (const t of this.tiles) {
      const far = Math.hypot(t.center.x - camPos.x, t.center.z - camPos.z) > 48;
      const g = t.geos[far ? 1 : 0]; if (t.mesh.geometry !== g) t.mesh.geometry = g;
    }
  }
}
