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
  // backdrop: a wide skirt sloping away from the map edge, and a ring of trees to hide the seam
  const half = terrain.nx * terrain.cell / 2, cx = terrain.ox + half, cz = terrain.oz + half;
  const skirt = new THREE.Mesh(new THREE.CircleGeometry(320, 48).rotateX(-Math.PI / 2), // a full disc: nothing but ground under and around the map
    new THREE.MeshLambertMaterial({ color: new THREE.Color(...GRASS_COLOR).multiplyScalar(0.9) }));
  skirt.position.set(cx, -2.6, cz); scene.add(skirt);
  const rnd = makeRng(99), NT = 220;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.22, 1.6, 5).translate(0, 0.8, 0), new THREE.MeshLambertMaterial({ color: 0x5a3a22 }), NT);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1.4, 4.5, 6).translate(0, 3.6, 0), new THREE.MeshLambertMaterial({ color: 0x2f6b2c }), NT);
  const o = new THREE.Object3D(), c = new THREE.Color();
  for (let n = 0; n < NT; n++) {
    const a = rnd() * Math.PI * 2, r = half * 1.45 + rnd() * 40, s = 1.2 + rnd() * 1.6;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    o.position.set(x, -2.5, z); o.scale.setScalar(s); o.rotation.y = rnd() * 6; o.updateMatrix();
    trunks.setMatrixAt(n, o.matrix); crowns.setMatrixAt(n, o.matrix);
    crowns.setColorAt(n, c.setHSL(0.31 + rnd() * 0.05, 0.45, 0.22 + rnd() * 0.1));
  }
  scene.add(trunks, crowns);
  return env;
}
