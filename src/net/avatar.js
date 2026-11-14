// The other player, as SWVR draws its crew (src/net/avatarView.ts and avatarOutfits.ts there, ported): a head with a
// face and a hat, a torso hung from the neck that turns after the head, two-part arms whose elbows are worked out
// from shoulder and hand, the faceted hands, and legs. Each player gets a look from their id (an outfit, a skin
// tone, a beard or not), the same for everyone, with their own colour as an accent on hat and collar.
// Poses are eased as SWVR's are: root dt·15, hands dt·20. Built from boxes and cylinders with vertex colours, one
// shared material. Original designs: generic working gear, no brand marks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { handShape } from '../xr/handShapes.js';

/** SWVR's CONFIG.avatar. */
const C = { neckDrop: 0.13, torsoLength: 0.55, shoulderHalf: 0.18, shoulderDrop: 0.07, upperArm: 0.3, forearm: 0.29, bodyTurnRate: 4, maxTwist: 50 * Math.PI / 180,
  thigh: 0.47, shin: 0.47, hipHalf: 0.09 };
const COLORS = [0xd8582a, 0x2a8ad8, 0x3aa84a, 0xc8a020, 0x9a4ad0, 0x20a8a0];
export const OUTFITS = [
  { name: 'Hi-vis vest over work blues, hard hat', jacket: 0x2c4a78, trim: 0xd8f020, trimKind: 'vest', gloves: 0x3a3e44, hat: 'hardhat', hatColor: 0xf2f2ee, trousers: 0x2c4a78, boots: 0x3a2a1e },
  { name: 'Orange float coat and beanie', jacket: 0xf06418, trim: 0xd8dcd8, trimKind: 'bands', gloves: 0x2a2e33, hat: 'beanie', hatColor: 0x1d2a44, trousers: 0x1d2a44, boots: 0x22262b },
  { name: 'Yellow oilskins and sou’wester', jacket: 0xf0c020, trim: 0xd8a810, trimKind: 'bib', gloves: 0xe86a1a, hat: 'souwester', hatColor: 0xf0c020, trousers: 0xf0c020, boots: 0x1f3a2a },
  { name: 'Navy jumper and flat cap', jacket: 0x1f2b48, trim: 0x2a385a, trimKind: 'yoke', gloves: 0x5a4a3a, hat: 'flatcap', hatColor: 0x4a4038, trousers: 0x3a3a3e, boots: 0x2a2e33 },
  { name: 'Green bib-and-brace, check shirt', jacket: 0x9a2a2a, trim: 0x2f6a3a, trimKind: 'bib', gloves: 0xe86a1a, hat: 'beanie', hatColor: 0x2f6a3a, trousers: 0x2f6a3a, boots: 0x1f3a2a },
  { name: 'Red crew jacket and cap', jacket: 0xc42a22, trim: 0x22262c, trimKind: 'collar', gloves: 0x2a2e33, hat: 'cap', hatColor: 0x22262c, trousers: 0x22262c, boots: 0x2a2e33 },
];
const SKINS = [0xf0c8a8, 0xe0aa84, 0xc68a62, 0x9a6440, 0x6e4630], BEARDS = [0x6a4a2a, 0x3a2a1e, 0xb8b0a4, 0xa0522d];

export function decodeLook(look) {
  const n = Math.abs(Math.floor(look)), outfit = OUTFITS[n % OUTFITS.length];
  const skin = SKINS[Math.floor(n / OUTFITS.length) % SKINS.length], b = Math.floor(n / (OUTFITS.length * SKINS.length)) % (BEARDS.length * 2);
  return { outfit, skin, beard: b < BEARDS.length ? BEARDS[b] : null };
}
/** A look and a colour from a player's id, so everyone sees the same figure. */
export function lookFromId(id) { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
export const playerColor = (id) => COLORS[lookFromId(id) % COLORS.length];

const _col = new THREE.Color();
function part(geo, colour) {
  const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute('uv'); _col.setHex(colour);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
}
const Bx = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const Cy = (r0, r1, h, seg, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z);

/** The head: face toward -z, centred on the head's position; eyes and a nose so you see which way they look. */
function headGeometry(l, accent) {
  const p = [part(Bx(0.17, 0.21, 0.2), l.skin), part(Bx(0.03, 0.045, 0.03, 0, -0.005, -0.112), l.skin),
    ...[-1, 1].map((s) => part(Bx(0.02, 0.013, 0.01, s * 0.04, 0.03, -0.101), 0x1a1d22)), ...[-1, 1].map((s) => part(Bx(0.02, 0.045, 0.04, s * 0.092, 0, 0), l.skin))];
  if (l.beard !== null) p.push(part(Bx(0.175, 0.08, 0.06, 0, -0.075, -0.08), l.beard), part(Bx(0.06, 0.016, 0.012, 0, -0.035, -0.105), l.beard));
  const hc = l.outfit.hatColor;
  switch (l.outfit.hat) {
    case 'souwester': p.push(part(Cy(0.1, 0.11, 0.1, 10, 0, 0.12, 0.005), hc), part(new THREE.CylinderGeometry(0.16, 0.17, 0.015, 12).rotateX(-0.25).translate(0, 0.085, 0.03), hc), part(Bx(0.18, 0.012, 0.02, 0, 0.075, -0.075), accent)); break;
    case 'beanie': p.push(part(Cy(0.075, 0.098, 0.1, 10, 0, 0.13, 0), hc), part(Cy(0.1, 0.1, 0.035, 10, 0, 0.09, 0), accent), part(new THREE.SphereGeometry(0.03, 6, 4).translate(0, 0.19, 0), accent)); break;
    case 'cap': p.push(part(Cy(0.085, 0.097, 0.07, 10, 0, 0.125, 0), hc), part(Bx(0.15, 0.012, 0.09, 0, 0.095, -0.13), accent)); break;
    case 'hardhat': p.push(part(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.09, 0), hc), part(Cy(0.125, 0.125, 0.012, 12, 0, 0.09, -0.01), hc), part(Bx(0.03, 0.03, 0.2, 0, 0.19, 0), accent)); break;
    default: p.push(part(new THREE.CylinderGeometry(0.1, 0.1, 0.045, 10).scale(1, 1, 1.15).rotateX(0.12).translate(0, 0.12, -0.01), hc), part(Bx(0.14, 0.01, 0.06, 0, 0.1, -0.12), hc), part(Bx(0.2, 0.01, 0.01, 0, 0.104, -0.095), accent));
  }
  return mergeGeometries(p);
}
/** The torso: hangs from the neck (the origin) down -y, front toward -z; a collar of the player's colour. */
function torsoGeometry(l, accent) {
  const o = l.outfit, L = C.torsoLength, sw = C.shoulderHalf * 2 + 0.06;
  const p = [part(Bx(sw, 0.16, 0.22, 0, -0.1, 0), o.jacket), part(Bx(sw - 0.08, L - 0.16, 0.2, 0, -0.18 - (L - 0.16) / 2 + 0.02, 0), o.jacket),
    part(Cy(0.06, 0.07, 0.05, 8, 0, -0.015, 0), l.skin), part(Cy(0.085, 0.09, 0.04, 8, 0, -0.035, 0), accent)];
  switch (o.trimKind) {
    case 'bib': p.push(part(Bx(0.22, L - 0.2, 0.02, 0, -0.2 - (L - 0.2) / 2 + 0.05, -0.105), o.trim)); for (const s of [-1, 1]) p.push(part(Bx(0.04, 0.02, 0.24, s * 0.08, -0.025, 0), o.trim)); break;
    case 'vest': p.push(part(Bx(sw - 0.06, L - 0.14, 0.215, 0, -0.12 - (L - 0.14) / 2 + 0.02, 0), o.trim), part(Bx(sw - 0.05, 0.03, 0.225, 0, -L + 0.12, 0), 0xc8ccd0)); break;
    case 'bands': for (const y of [-0.16, -L + 0.1]) p.push(part(Bx(sw - (y < -0.2 ? 0.07 : 0), 0.03, 0.225, 0, y, 0), o.trim)); break;
    case 'yoke': p.push(part(Bx(sw + 0.005, 0.06, 0.225, 0, -0.06, 0), o.trim)); break;
    default: p.push(part(Bx(0.2, 0.06, 0.23, 0, -0.05, 0), o.trim), part(Bx(0.015, L - 0.1, 0.01, 0, -0.08 - (L - 0.1) / 2, -0.105), o.trim));
  }
  return mergeGeometries(p);
}
/** An arm segment from the origin down -y; the forearm has a cuff. */
function armGeometry(l, length, cuff) {
  const p = [part(Cy(0.045, cuff ? 0.04 : 0.045, length, 7, 0, -length / 2, 0), l.outfit.jacket)];
  if (cuff) p.push(part(Cy(0.043, 0.043, 0.03, 7, 0, -length + 0.02, 0), l.outfit.trimKind === 'yoke' ? l.outfit.trim : 0x2a2e33));
  return mergeGeometries(p);
}
/** A leg segment from the origin down -y; the shin ends in a boot, toe forward (-z). */
function legGeometry(l, length, boot) {
  const p = [part(Cy(boot ? 0.055 : 0.07, boot ? 0.05 : 0.06, length, 7, 0, -length / 2, 0), l.outfit.trousers)];
  if (boot) p.push(part(Cy(0.058, 0.058, 0.2, 7, 0, -length + 0.12, 0), l.outfit.boots), part(Bx(0.11, 0.07, 0.24, 0, -length + 0.035, -0.05), l.outfit.boots));
  return mergeGeometries(p);
}

const MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const DOWN = new THREE.Vector3(0, -1, 0), FWD = new THREE.Vector3(0, 0, -1), Y = new THREE.Vector3(0, 1, 0);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _neck = new THREE.Vector3(), _waist = new THREE.Vector3(), _dir = new THREE.Vector3(), _bend = new THREE.Vector3(),
  _sh = new THREE.Vector3(), _el = new THREE.Vector3(), _hand = new THREE.Vector3(), _yawQ = new THREE.Quaternion(), _bodyQ = new THREE.Quaternion(), _foot = new THREE.Vector3(), _m = new THREE.Matrix4();

export class Avatar {
  /**
   * @param {THREE.Object3D} scene
   * @param {string} [id] the player's id: picks their look and colour
   * @param {(x: number, z: number) => number} [ground] ground height, to stand the legs on
   */
  constructor(scene, id = 'player', ground = null) {
    const look = this.look = decodeLook(lookFromId(id)), accent = playerColor(id), mesh = (g) => { const m = new THREE.Mesh(g, MAT); this.root.add(m); return m; };
    this.ground = ground;
    this.root = new THREE.Group(); scene.add(this.root);
    this.head = mesh(headGeometry(look, accent)); this.torso = mesh(torsoGeometry(look, accent));
    this.upper = [0, 1].map(() => mesh(armGeometry(look, C.upperArm, false))); this.fore = [0, 1].map(() => mesh(armGeometry(look, C.forearm, true)));
    this.thigh = [0, 1].map(() => mesh(legGeometry(look, C.thigh, false))); this.shin = [0, 1].map(() => mesh(legGeometry(look, C.shin, true)));
    const g = look.outfit.gloves, cuff = new THREE.Color(g).multiplyScalar(0.7).getHex();
    this.hands = [-1, 1].map((s) => mesh(handShape(g, cuff, s, 'rest')));
    this.first = true; this.bodyYaw = 0;
  }
  /** Two bones of fixed length from a to b, bent toward `bend`: places upper and lower, the lower stretching if out of reach. */
  _limb(up, low, a, b, L1, L2, bend) {
    _dir.subVectors(b, a); const dist = _dir.length(); _dir.divideScalar(dist || 1);
    const reach = Math.min(Math.max(dist, Math.abs(L1 - L2) + 0.01), (L1 + L2) * 0.999), along = (L1 * L1 - L2 * L2 + reach * reach) / (2 * reach), out = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    bend.addScaledVector(_dir, -bend.dot(_dir)); if (bend.lengthSq() < 1e-6) bend.set(1, 0, 0).applyQuaternion(_bodyQ); bend.normalize();
    _el.copy(a).addScaledVector(_dir, along).addScaledVector(bend, out);
    up.position.copy(a); up.quaternion.setFromUnitVectors(DOWN, _t.subVectors(_el, a).normalize());
    _t.subVectors(b, _el); const fl = _t.length();
    low.position.copy(_el); low.quaternion.setFromUnitVectors(DOWN, _t.divideScalar(fl || 1)); low.scale.set(1, Math.max(0.2, fl / L2), 1);
    return _t; // the lower bone's direction
  }
  /** pose: {h:[x,y,z,qx,qy,qz,qw], l: same|null, r: same|null} in world space. */
  update(pose, dt) {
    if (!pose) { this.root.visible = false; return; }
    this.root.visible = true;
    const k = this.first ? 1 : Math.min(1, dt * 15), kh = this.first ? 1 : Math.min(1, dt * 20);
    const head = this.head; head.position.lerp(_t.fromArray(pose.h), k); head.quaternion.slerp(_q.fromArray(pose.h, 3), k);
    // the torso's heading: toward the head's, lagging, never twisted more than maxTwist
    _dir.copy(FWD).applyQuaternion(head.quaternion); const headYaw = Math.atan2(-_dir.x, -_dir.z);
    if (this.first) this.bodyYaw = headYaw; this.first = false;
    let d = wrap(headYaw - this.bodyYaw); this.bodyYaw += d * Math.min(1, dt * C.bodyTurnRate); d = wrap(headYaw - this.bodyYaw);
    if (Math.abs(d) > C.maxTwist) this.bodyYaw = headYaw - Math.sign(d) * C.maxTwist;
    _neck.copy(head.position); _neck.y -= C.neckDrop;
    _yawQ.setFromAxisAngle(Y, this.bodyYaw); _bodyQ.copy(_yawQ);
    this.torso.position.copy(_neck); this.torso.quaternion.copy(_bodyQ);
    // arms
    [pose.l, pose.r].forEach((p, i) => {
      const s = i ? 1 : -1, hand = this.hands[i];
      _sh.set(s * C.shoulderHalf, -C.shoulderDrop, 0).applyQuaternion(_bodyQ).add(_neck);
      if (p) hand.position.lerp(_t.fromArray(p), kh); else hand.position.copy(_t.set(s * 0.03, -(C.upperArm + C.forearm) * 0.97, -0.06).applyQuaternion(_bodyQ).add(_sh)); // not tracked: hanging at the side
      _hand.copy(hand.position);
      const fore = this._limb(this.upper[i], this.fore[i], _sh, _hand, C.upperArm, C.forearm, _bend.set(s * 0.5, -1, 0.4).applyQuaternion(_bodyQ)); // elbows down, out and back
      if (p) hand.quaternion.slerp(_q.fromArray(p, 3), kh); else hand.quaternion.setFromUnitVectors(FWD, fore);
    });
    // legs: standing on the ground if it is within reach of the hips, otherwise sitting (in a cab)
    _waist.set(0, -C.torsoLength, 0).applyQuaternion(_bodyQ).add(_neck);
    const gy = this.ground ? this.ground(_waist.x, _waist.z) : _waist.y - 0.9, drop = _waist.y - gy, standing = drop > 0.45 && drop < C.thigh + C.shin + 0.12;
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, hip = _sh.set(s * C.hipHalf, 0, 0).applyQuaternion(_bodyQ).add(_waist);
      if (standing) _foot.set(s * C.hipHalf, 0, -0.02).applyQuaternion(_bodyQ).add(_waist).setY(gy);
      else _foot.set(s * (C.hipHalf + 0.03), -C.shin * 0.92, -C.thigh * 0.95).applyQuaternion(_bodyQ).add(_waist);                               // seated: thighs forward, shins down
      this._limb(this.thigh[i], this.shin[i], hip, _foot, C.thigh, C.shin, _bend.set(0, 0.2, -1).applyQuaternion(_bodyQ));                         // knees forward
      // turn the shin about its own length so the boot's toe points the way the body faces
      const sd = _t.clone().negate(), f = _dir.copy(FWD).applyQuaternion(_bodyQ).negate(); f.addScaledVector(sd, -f.dot(sd)).normalize();
      this.shin[i].quaternion.setFromRotationMatrix(_m.makeBasis(_bend.crossVectors(sd, f), sd, f));
    }
  }
  dispose() { this.root.removeFromParent(); }
}
