// Jobs with a spec, a tolerance and a grade (roadmap chapter 1: survey and grade).
//
// A Design is the shape the ground should have over a patch: a plane, level or sloping, over a rectangle. Score it
// against the ground and you get how much of the patch is within tolerance, and how much soil stands above it (to
// cut) and is missing below it (to fill). The ground shader draws it as a ghost with cut and fill colours
// (render/ground.js, setDesign) so you can see where to work.
//
// The first job is the site-office pad: level a 10 × 6 m patch of the yard to ±5 cm over 90 % of it. Its level is
// set once, from the ground as it lies (its median height, to the centimetre), and saved.
// It is signed off once it is within tolerance over 90 % and every machine has been off the pad for SIGN_OFF
// seconds (so you can keep working it for a better grade, and the office is never dropped on a machine). Graded on
// how it stands then (A at 97 %, B at 93 %, C at 90 %), and the site office is put on the pad: a portacabin, one draw
// call, with a collider. The MVP checklist is the next job card on the clipboard.
//
// Host-authoritative in co-op: the host decides when a job is done and its grade; clients draw the overlay and the
// live score from their own copy of the ground (it is the host's, replicated).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export class Design {
  /** {x, z} centre, {w, d} size along x and z, y the level at the centre, sx / sz the gradient (m per m), tol ± m */
  constructor({ x, z, w, d, y = 0, sx = 0, sz = 0, tol = 0.05 }) { Object.assign(this, { x, z, w, d, y, sx, sz, tol }); }
  inside(x, z) { return Math.abs(x - this.x) <= this.w / 2 && Math.abs(z - this.z) <= this.d / 2; }
  target(x, z) { return this.y + this.sx * (x - this.x) + this.sz * (z - this.z); }
  /** Compare with the ground, sampled at its own cells. */
  score(terrain, out = {}) {
    const c = terrain.cell, area = c * c, x0 = this.x - this.w / 2, z0 = this.z - this.d / 2;
    let n = 0, ok = 0, high = 0, low = 0, cut = 0, fill = 0, worst = 0;
    for (let z = z0 + c / 2; z < z0 + this.d; z += c) for (let x = x0 + c / 2; x < x0 + this.w; x += c) {
      const dh = terrain.heightAt(x, z) - this.target(x, z); n++;
      if (Math.abs(dh) <= this.tol) ok++; else if (dh > 0) high++; else low++;
      if (dh > 0) cut += dh * area; else fill -= dh * area;
      if (Math.abs(dh) > Math.abs(worst)) worst = dh;
    }
    return Object.assign(out, { n, within: n ? ok / n : 0, high: n ? high / n : 0, low: n ? low / n : 0, cut, fill, worst });
  }
  /** Level the design at the ground's median height over the patch, to the centimetre: the lie of the land round
   *  a heap or a hollow, so the job is to cut the one, fill the other and take the rest away. */
  fitLevel(terrain) {
    const c = terrain.cell, x0 = this.x - this.w / 2, z0 = this.z - this.d / 2, hs = [];
    for (let z = z0 + c / 2; z < z0 + this.d; z += c) for (let x = x0 + c / 2; x < x0 + this.w; x += c) hs.push(terrain.heightAt(x, z));
    hs.sort((a, b) => a - b); this.y = Math.round(hs[hs.length >> 1] * 100) / 100; this.sx = this.sz = 0; return this.y;
  }
}

export const GRADES = [['A', 0.97], ['B', 0.93], ['C', 0.9]];
export const SIGN_OFF = 5; // s with nothing on the pad
export const gradeOf = (within) => (GRADES.find(([, k]) => within >= k) || [null])[0];

/** The site office: a portacabin built from boxes, merged into one mesh. Its floor sits on the pad. */
function office() {
  const parts = [], col = new THREE.Color(), box = (w, h, d, x, y, z, c) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed(); col.setHex(c);
    const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.toArray(a, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); parts.push(g);
  };
  box(6.2, 0.25, 3.0, 0, 0.35, 0, 0x55595e);                // chassis rails
  for (const x of [-2.7, 0, 2.7]) for (const z of [-1.2, 1.2]) box(0.3, 0.3, 0.3, x, 0.12, z, 0x3a3a3a); // blocks it stands on
  box(6.0, 2.5, 2.8, 0, 1.75, 0, 0xd8d2c0);                 // body
  box(6.2, 0.18, 3.0, 0, 3.08, 0, 0x8a8f96);                // roof
  for (const x of [-2.9, 2.9]) box(0.12, 2.5, 2.9, x, 1.75, 0, 0x4a7a5a); // end frames
  for (const x of [-1.8, 0.6, 2.0]) box(0.9, 0.8, 0.06, x, 2.1, 1.42, 0x2a3a48); // windows, front
  box(0.9, 1.9, 0.06, -0.7, 1.45, 1.42, 0x4a7a5a);          // door
  box(1.2, 0.5, 0.9, -0.7, 0.25, 1.95, 0x6a6e72);           // steps
  box(1.8, 0.35, 0.05, 1.3, 2.75, 1.43, 0xf0b21a);          // sign board
  return new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

export class PadJob {
  constructor(game, phys, def) {
    this.game = game; this.phys = phys; this.def = def;
    this.title = 'Level the site-office pad';
    this.design = new Design({ x: def.x, z: def.z, w: def.w, d: def.d, tol: def.tol ?? 0.05 });
    this.need = def.need ?? 0.9;
    this.done = false; this.grade = null; this.result = null; this.best = 0;
    this.live = { within: 0, cut: 0, fill: 0, high: 0, low: 0, n: 0, worst: 0 };
    this.design.fitLevel(game.terrain);
    this.office = office(); this.office.visible = false; game.scene.add(this.office);
    this.onDone = null; this.t = 0; this.clear = 0;
    this.show();
  }
  /** Draw (or stop drawing) the design on the ground. */
  show() { this.game.ground.setDesign(this.done ? null : this.design); }
  /** Every few frames: the live score; on the host, finish the job when it is met. */
  update(dt, { authority = true } = {}) {
    this.t += dt; if (this.t < 0.25 && this.live.n) return; const step = this.t; this.t = 0;
    this.design.score(this.game.terrain, this.live); this.best = Math.max(this.best, this.live.within);
    if (!authority || this.done) return;
    this.clear = this.live.within >= this.need && !this.occupied() ? this.clear + step : 0;
    if (this.clear >= SIGN_OFF) this.finish(gradeOf(this.live.within), { ...this.live });
  }
  /** Is any machine on (or within 3 m of) the pad? */
  occupied() {
    const d = this.design;
    return (this.game.machines || []).some((m) => m.bodyList.some((b) => Math.abs(b.obj.position.x - d.x) < d.w / 2 + 3 && Math.abs(b.obj.position.z - d.z) < d.d / 2 + 3));
  }
  finish(grade, result) {
    if (this.done) return;
    this.done = true; this.grade = grade; this.result = result;
    this.placeOffice(); this.show(); if (this.onDone) this.onDone(this);
  }
  placeOffice() {
    const d = this.design, o = this.office; o.position.set(d.x, d.target(d.x, d.z), d.z); o.visible = true; o.updateMatrixWorld();
    if (!this.collider && this.phys) this.collider = this.phys.addStaticBox([6.2, 3.2, 3.0], [d.x, d.target(d.x, d.z) + 1.6, d.z]);
  }
  /** Saved and sent to clients: the level it was set at, and the outcome. */
  state() { return { y: this.design.y, done: this.done, grade: this.grade, result: this.result, best: this.best }; }
  restore(s) {
    if (!s) return;
    if (typeof s.y === 'number') this.design.y = s.y;
    this.best = s.best || 0;
    if (s.done && !this.done) this.finish(s.grade, s.result); else this.show();
  }
  /** The job card, drawn on the clipboard's canvas. */
  draw(g) {
    const L = this.live, d = this.design, pc = (v) => `${Math.round(v * 100)} %`;
    g.fillStyle = '#efe6cf'; g.fillRect(0, 0, 512, 640); g.fillStyle = '#6d6e70'; g.fillRect(176, 0, 160, 34);
    g.fillStyle = '#2b2b2b'; g.font = 'bold 30px system-ui, sans-serif'; g.fillText('JOB 1: SITE-OFFICE PAD', 36, 82);
    g.font = '22px system-ui, sans-serif';
    const spec = [`Level ${d.w} × ${d.d} m at ${d.y.toFixed(2)} m`, `Tolerance ±${Math.round(d.tol * 100)} cm over ${pc(this.need)}`, 'Red: too high, cut it. Blue: too low, fill it.'];
    spec.forEach((t, i) => g.fillText(t, 36, 128 + i * 30));
    g.strokeStyle = '#2b2b2b'; g.lineWidth = 2; g.strokeRect(36, 236, 440, 34);
    g.fillStyle = L.within >= this.need ? '#2f8f3a' : '#c98a3a'; g.fillRect(38, 238, 436 * Math.min(1, L.within), 30);
    g.fillStyle = '#1b1b1b'; g.fillRect(38 + 436 * this.need - 1, 232, 3, 42);
    g.fillStyle = '#2b2b2b'; g.font = 'bold 26px system-ui, sans-serif'; g.fillText(`On grade: ${pc(L.within)}`, 36, 306);
    g.font = '22px system-ui, sans-serif';
    g.fillStyle = '#a83a2a'; g.fillText(`To cut:  ${L.cut.toFixed(1)} m³  (${pc(L.high)} of it high)`, 36, 344);
    g.fillStyle = '#2a5aa8'; g.fillText(`To fill: ${L.fill.toFixed(1)} m³  (${pc(L.low)} of it low)`, 36, 376);
    if (this.done) {
      g.fillStyle = '#2f8f3a'; g.font = 'bold 40px system-ui, sans-serif'; g.fillText(`DONE · GRADE ${this.grade}`, 36, 470);
      g.font = '22px system-ui, sans-serif'; g.fillText(`${pc(this.result.within)} on grade when signed off`, 36, 506);
      g.fillText('The office is on its pad. Next job overleaf.', 36, 540);
    } else if (L.within >= this.need) {
      g.fillStyle = '#2f8f3a'; g.font = 'bold 24px system-ui, sans-serif'; g.fillText(`Good enough for grade ${gradeOf(L.within)}.`, 36, 470);
      g.font = '21px system-ui, sans-serif'; g.fillText(this.occupied() ? 'Keep at it, or drive off the pad to sign off.' : `Signing off… ${Math.max(0, Math.ceil(SIGN_OFF - this.clear))} s`, 36, 502);
    } else { g.fillStyle = '#6a5a40'; g.font = 'italic 21px system-ui, sans-serif'; g.fillText('Dozer: AUTO LEVEL holds the blade there.', 36, 470); }
  }
}

/** One clipboard canvas for the job cards in order: the first card not done is the one shown. */
export class JobBoard {
  constructor(cards) {
    this.cards = cards; this.canvas = document.createElement('canvas'); this.canvas.width = 512; this.canvas.height = 640;
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace; this.t = 1;
  }
  get current() { return this.cards.find((c) => !c.done) || this.cards[this.cards.length - 1]; }
  update(dt) {
    if ((this.t += dt) < 0.5) return; this.t = 0;
    const g = this.canvas.getContext('2d'), c = this.current;
    if (c.draw) c.draw(g); else if (c.canvas) g.drawImage(c.canvas, 0, 0);
    this.texture.needsUpdate = true;
  }
}
