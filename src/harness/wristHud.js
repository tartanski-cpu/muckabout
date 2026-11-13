// On-device perf HUD: a small panel worn on the left wrist in VR, and the same
// canvas shown as a corner overlay on desktop. Draws a PerfMonitor snapshot.
import * as THREE from 'three';

const W = 512, H = 400;
const FRAME_BUDGET_MS = 1000 / 72;

export class WristHud {
  /** @param {import('./perf.js').PerfMonitor} perf */
  constructor(perf, { hz = 4 } = {}) {
    this.perf = perf;
    this.interval = 1 / hz;
    this.t = 0;
    this.visible = true;
    this.note = '';

    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // 16 cm wide panel, floating just above the back of the controller and tilted toward the face.
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.16, 0.16 * H / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0.95, depthTest: false }),
    );
    this.mesh.renderOrder = 999;
    this.mesh.position.set(0, 0.09, 0.05);
    this.mesh.rotation.set(-0.9, 0, 0);
    this.mesh.visible = false; // until attached to a controller

    // Desktop overlay uses the very same canvas.
    Object.assign(this.canvas.style, {
      position: 'fixed', right: '12px', bottom: '12px', width: '300px', borderRadius: '8px', pointerEvents: 'none',
    });
    document.body.appendChild(this.canvas);
  }

  /** Parent the panel to a controller (target-ray or grip space). */
  attachTo(controller) {
    controller.add(this.mesh);
    this.mesh.visible = this.visible;
  }

  setVisible(v) {
    this.visible = v;
    this.mesh.visible = v && !!this.mesh.parent;
    this.canvas.style.display = v ? '' : 'none';
    if (v) this.draw();
  }

  toggle() { this.setVisible(!this.visible); }

  update(dt) {
    if (!this.visible) return;
    this.t += dt;
    if (this.t < this.interval) return;
    this.t = 0;
    this.draw();
  }

  draw() {
    const c = this.ctx, s = this.perf.snapshot();
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(16,22,26,0.88)';
    c.beginPath(); c.roundRect(0, 0, W, H, 18); c.fill();

    const over = s.frameMaxMs > FRAME_BUDGET_MS * 1.15;
    c.fillStyle = over ? '#ff7a5a' : '#8fef7a';
    c.font = 'bold 34px monospace';
    c.fillText(`${s.fps.toFixed(0)} fps`, 16, 42);
    c.fillStyle = '#f3ead8'; c.font = '22px monospace';
    c.fillText(`${s.frameMs.toFixed(1)} ms  worst ${s.frameMaxMs.toFixed(1)}`, 180, 40);

    // timers: name, avg bar against the 13.9 ms frame, avg / worst numbers
    let y = 78;
    c.font = '20px monospace';
    for (const t of s.timers) {
      c.fillStyle = '#ffd25a'; c.fillText(t.name, 16, y);
      c.fillStyle = '#2b3a40'; c.fillRect(120, y - 14, 180, 14);
      c.fillStyle = '#c98a3a'; c.fillRect(120, y - 14, 180 * Math.min(1, t.max / FRAME_BUDGET_MS), 14);
      c.fillStyle = '#ffd25a'; c.fillRect(120, y - 14, 180 * Math.min(1, t.avg / FRAME_BUDGET_MS), 14);
      c.fillStyle = '#f3ead8';
      c.fillText(`${t.avg.toFixed(2)} / ${t.max.toFixed(1)}`, 312, y);
      y += 26;
    }
    y += 6;
    c.fillStyle = '#9fe08a';
    let x = 16;
    for (const k of s.counters) {
      const txt = `${k.name} ${k.value}`;
      const w = c.measureText(txt).width + 22;
      if (x + w > W - 8) { x = 16; y += 26; }
      c.fillText(txt, x, y); x += w;
    }
    if (this.note) { c.fillStyle = '#ff7a5a'; c.font = 'bold 20px monospace'; c.fillText(this.note, 16, H - 14); }
    this.texture.needsUpdate = true;
  }
}
