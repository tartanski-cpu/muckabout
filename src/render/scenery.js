// Sky, lights, fog and the backdrop beyond the playable map.
import * as THREE from 'three';
import { makeRng } from '../util/rng.js';
import { GRASS_COLOR } from '../terrain/materials.js';

// Times of day. Everything that lights the world reads from one of these: the two scene lights (machines, trees,
// hands), the ground and water shaders (through the shared `env` vectors), the sky dome and the fog.
export const LIGHTING = {
  day:    { sun: [30, 50, 18],  sunColor: [1.0, 0.94, 0.84], sunK: 0.62, sky: [0.44, 0.48, 0.53], ground: [0.27, 0.23, 0.17], fog: [0.66, 0.82, 0.94], zenith: [0.22, 0.47, 0.84], horizon: [0.76, 0.87, 0.96], lamps: 0 },
  golden: { sun: [-42, 21, 30], sunColor: [1.0, 0.74, 0.44], sunK: 0.86, sky: [0.36, 0.38, 0.5],  ground: [0.3, 0.22, 0.15],   fog: [0.95, 0.76, 0.58], zenith: [0.24, 0.4, 0.74],  horizon: [1.0, 0.78, 0.52],  lamps: 0.35 },
  dusk:   { sun: [-52, 7, 22],  sunColor: [0.95, 0.42, 0.3], sunK: 0.34, sky: [0.17, 0.2, 0.36],  ground: [0.1, 0.09, 0.11],   fog: [0.3, 0.26, 0.4],   zenith: [0.04, 0.07, 0.22], horizon: [0.8, 0.4, 0.3],    lamps: 1 },
};
const SKY_VERT = /* glsl */`varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0); gl_Position = p.xyww; }`;
const SKY_FRAG = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uFog; uniform vec3 uSun; uniform vec3 uSunColor;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  vec3 d = normalize(vDir); float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  col = mix(col, uFog, smoothstep(0.06, -0.04, h));                            // the haze the land fades into
  float s = max(dot(d, uSun), 0.0);
  col += uSunColor * (pow(s, 6.0) * 0.3 + pow(s, 90.0) * 0.35 + smoothstep(0.99965, 0.9998, s) * 3.0);   // glow, halo, disc
  vec2 cp = d.xz / (h + 0.18) * 1.1;                                           // thin high cloud, lit warm on the sun's side
  float c = smoothstep(0.5, 0.85, vnoise(cp) * 0.65 + vnoise(cp * 2.7 + 4.0) * 0.35) * smoothstep(0.02, 0.25, h);
  col = mix(col, mix(uHorizon, vec3(1.0), 0.4) + uSunColor * pow(s, 3.0) * 0.5, c * 0.55);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function makeEnvironment(scene, terrain) {
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  scene.fog = new THREE.Fog(0xffffff, 70, 210);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1); scene.add(sun);
  const env = { // the ground and water shaders do their own lighting from these (shared objects, updated in place)
    sunDir: new THREE.Vector3(), sunColor: new THREE.Vector3(), skyLight: new THREE.Vector3(), groundLight: new THREE.Vector3(),
    fogColor: new THREE.Vector3(), fogNear: 70, fogFar: 210, lamps: { value: 0 }, name: '',
    sunLight: sun, // the PC graphics tier (render/quality.js) casts real shadows from it
  };
  const skyU = { uZenith: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() }, uFog: { value: env.fogColor }, uSun: { value: env.sunDir }, uSunColor: { value: new THREE.Vector3() } };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: skyU, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false }));
  dome.frustumCulled = false; dome.renderOrder = -10; scene.add(dome);
  env.apply = (name) => {
    const L = LIGHTING[name] || LIGHTING.golden; env.name = LIGHTING[name] ? name : 'golden';
    env.sunDir.copy(V(L.sun)).normalize(); env.sunColor.copy(V(L.sunColor)).multiplyScalar(L.sunK); env.skyLight.copy(V(L.sky)); env.groundLight.copy(V(L.ground)); env.fogColor.copy(V(L.fog));
    env.lamps.value = L.lamps; skyU.uZenith.value.copy(V(L.zenith)); skyU.uHorizon.value.copy(V(L.horizon)); skyU.uSunColor.value.copy(V(L.sunColor));
    sun.position.copy(env.sunDir).multiplyScalar(80); sun.color.setRGB(...L.sunColor); sun.intensity = L.sunK * 3.4;
    hemi.color.setRGB(L.sky[0], L.sky[1], L.sky[2]); hemi.groundColor.setRGB(L.ground[0], L.ground[1], L.ground[2]); hemi.intensity = 3.4;
    scene.fog.color.setRGB(L.fog[0], L.fog[1], L.fog[2]); scene.background = scene.fog.color;
    // how bright unlit things (smoke, dust) should look
    env.ambient = (L.sky[0] + L.sky[1] + L.sky[2]) / 3 + L.sunK * 0.45;
    env.flat = [L.sky[0] * 1.1 + L.sunColor[0] * L.sunK * 0.55, L.sky[1] * 1.1 + L.sunColor[1] * L.sunK * 0.55, L.sky[2] * 1.1 + L.sunColor[2] * L.sunK * 0.55]; // light on an upward-facing unlit surface (grass blades)
  };
  env.next = () => { const names = Object.keys(LIGHTING); env.apply(names[(names.indexOf(env.name) + 1) % names.length]); return env.name; };
  env.apply('golden');
  // backdrop: ground carried on outwards from every point of the map's edge at that point's height, rising a little
  // into low hills, so a map of any size or shape of edge (a valley 30 m high at its head) meets it without a cliff;
  // trees along it, and in the map's own woods (map.woods). One mesh, two instanced meshes.
  const ex0 = terrain.ox, ex1 = terrain.ox + (terrain.nx - 1) * terrain.cell, ez0 = terrain.oz, ez1 = terrain.oz + (terrain.nz - 1) * terrain.cell;
  const rim = []; // {x, z, nx, nz, h}: points round the edge, anticlockwise from the north-west corner, with the outward normal
  const side = (ax, az, bx, bz, nx, nz) => { const L = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(L / 4)); for (let k = 0; k < n; k++) { const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; rim.push({ x, z, nx, nz }); } };
  const corner = (x, z, a0) => { for (let k = 1; k < 4; k++) { const a = a0 + k * Math.PI / 8; rim.push({ x, z, nx: Math.cos(a), nz: Math.sin(a) }); } };
  side(ex0, ez0, ex0, ez1, -1, 0); corner(ex0, ez1, Math.PI); side(ex0, ez1, ex1, ez1, 0, 1); corner(ex1, ez1, Math.PI / 2); side(ex1, ez1, ex1, ez0, 1, 0); corner(ex1, ez0, 0); side(ex1, ez0, ex0, ez0, 0, -1); corner(ex0, ez0, -Math.PI / 2);
  for (const p of rim) p.h = terrain.heightAt(Math.min(ex1, Math.max(ex0, p.x)), Math.min(ez1, Math.max(ez0, p.z)));
  const RINGS = [[0, 0], [6, 0.3], [30, 2.5], [90, 7], [420, 9]]; // [out m, rise m above that point of the edge]
  const pos = [], col = [], idx = [], base = new THREE.Color(...GRASS_COLOR).multiplyScalar(0.9), far = new THREE.Color(...GRASS_COLOR).multiplyScalar(0.75);
  rim.forEach((p) => RINGS.forEach(([r, rise], q) => { pos.push(p.x + p.nx * r, p.h + rise - (q === 0 ? 0.25 : 0), p.z + p.nz * r); const cc = q < 2 ? base : far; col.push(cc.r, cc.g, cc.b); }));
  const R = RINGS.length; for (let i = 0; i < rim.length; i++) { const j = (i + 1) % rim.length; for (let q = 0; q < R - 1; q++) { const a = i * R + q, b = j * R + q; idx.push(a, a + 1, b, b, a + 1, b + 1); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const skirt = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })); skirt.name = 'backdrop'; scene.add(skirt);
  const backdropAt = (p, r) => { let i = 0; while (i < RINGS.length - 2 && RINGS[i + 1][0] < r) i++; const [r0, s0] = RINGS[i], [r1, s1] = RINGS[i + 1], t = Math.min(1, (r - r0) / (r1 - r0)); return p.h + s0 + (s1 - s0) * t; };
  const rnd = makeRng(99), woods = terrain.map?.woods || [], NW = woods.reduce((a, w) => a + w.n, 0), NT = 220 + NW;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.22, 1.6, 5).translate(0, 0.8, 0), new THREE.MeshLambertMaterial({ color: 0x5a3a22 }), NT);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 4.5, 6).translate(0, 3.6, 0), new THREE.MeshLambertMaterial({ color: 0x2f6b2c }), NT);
  const o = new THREE.Object3D(), c = new THREE.Color();
  const tree = (n, x, y, z, s) => { o.position.set(x, y - 0.1, z); o.scale.setScalar(s); o.rotation.y = rnd() * 6; o.updateMatrix(); trunks.setMatrixAt(n, o.matrix); crowns.setMatrixAt(n, o.matrix); crowns.setColorAt(n, c.setHSL(0.31 + rnd() * 0.05, 0.45, 0.22 + rnd() * 0.1)); };
  for (let n = 0; n < 220; n++) { const p = rim[Math.floor(rnd() * rim.length)], r = 12 + rnd() * 45; tree(n, p.x + p.nx * r, backdropAt(p, r), p.z + p.nz * r, 1.2 + rnd() * 1.6); }
  let n = 220; for (const w of woods) for (let k = 0; k < w.n; k++, n++) { const x = w.x0 + rnd() * (w.x1 - w.x0), z = w.z0 + rnd() * (w.z1 - w.z0); tree(n, x, terrain.heightAt(x, z), z, 1.0 + rnd() * 1.4); }
  scene.add(trunks, crowns);
  return env;
}
