// Draw-call diet for a cab full of controls: all the static bases become one mesh per parent node, and all the
// label plates become one mesh sharing one canvas atlas. (On a Quest every draw call is paid once per eye.)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BASE = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const CW = 256, CH = 48;

/** controls: Control[] already parented. Returns the Object3Ds created (so they can be hidden with the controls). */
export function buildDecor(controls, extraLabels = []) {
  const made = [], byParent = new Map();
  const group = (parent) => { if (!byParent.has(parent)) byParent.set(parent, { fixed: [], labels: [] }); return byParent.get(parent); };
  for (const c of controls) {
    c.root.updateMatrix();
    const g = group(c.root.parent);
    for (const p of c.fixedParts) g.fixed.push(p.applyMatrix4(c.root.matrix));
    if (c.label) g.labels.push({ ...c.label, matrix: c.root.matrix });
  }
  for (const l of extraLabels) group(l.parent).labels.push({ ...l, matrix: new THREE.Matrix4() });
  for (const [parent, g] of byParent) {
    if (g.fixed.length) { const m = new THREE.Mesh(mergeGeometries(g.fixed), BASE); parent.add(m); made.push(m); }
    if (!g.labels.length) continue;
    // atlas: two columns of 256 × 48 cells
    const rows = Math.ceil(g.labels.length / 2), canvas = document.createElement('canvas'); canvas.width = CW * 2; canvas.height = CH * rows;
    const ctx = canvas.getContext('2d'), quads = [], m4 = new THREE.Matrix4(), e = new THREE.Euler();
    g.labels.forEach((l, i) => {
      const cx = (i % 2) * CW, cy = Math.floor(i / 2) * CH;
      ctx.fillStyle = '#10161a'; ctx.fillRect(cx, cy, CW, CH); ctx.fillStyle = '#ffd25a'; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(l.text, cx + CW / 2, cy + CH / 2 + 1, CW - 12);
      const q = new THREE.PlaneGeometry(l.width, l.width * CH / CW), uv = q.attributes.uv;
      const u0 = cx / canvas.width, u1 = (cx + CW) / canvas.width, v1 = 1 - cy / canvas.height, v0 = 1 - (cy + CH) / canvas.height;
      uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
      m4.makeRotationFromEuler(e.set(...l.rot)).setPosition(...l.pos); q.applyMatrix4(m4).applyMatrix4(l.matrix);
      quads.push(q);
    });
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(mergeGeometries(quads), new THREE.MeshBasicMaterial({ map: tex })); parent.add(mesh); made.push(mesh);
  }
  return made;
}
