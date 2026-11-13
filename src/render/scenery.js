// Sky, lights, fog and the backdrop beyond the playable map.
import * as THREE from 'three';
import { makeRng } from '../util/rng.js';
import { GRASS_COLOR } from '../terrain/materials.js';

export function makeEnvironment(scene, terrain) {
  const sky = new THREE.Color(0x9fcbee);
  scene.background = sky; scene.fog = new THREE.Fog(sky, 70, 210);
  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x6b5636, 1.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.2); sun.position.set(30, 50, 18); scene.add(sun);
  const env = { // the ground shader does its own lighting with numbers matched to the lights above
    sunDir: sun.position.clone().normalize(), sunColor: new THREE.Vector3(1.0, 0.94, 0.84).multiplyScalar(0.62),
    skyLight: new THREE.Vector3(0.44, 0.48, 0.53), groundLight: new THREE.Vector3(0.27, 0.23, 0.17),
    fogColor: new THREE.Vector3(sky.r, sky.g, sky.b), fogNear: 70, fogFar: 210,
  };
  // backdrop: a wide skirt sloping away from the map edge, and a ring of trees to hide the seam
  const half = terrain.nx * terrain.cell / 2, cx = terrain.ox + half, cz = terrain.oz + half;
  const skirt = new THREE.Mesh(new THREE.RingGeometry(half * 0.98, 320, 48, 1).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: new THREE.Color(...GRASS_COLOR).multiplyScalar(0.9) }));
  skirt.position.set(cx, -2.5, cz); scene.add(skirt);
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
