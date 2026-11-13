// Snapshot interpolation for things the host owns (machines, the other player). Follows SWVR's client
// (src/net/clientSession.ts): keep a few timestamped states, estimate the host clock offset (snap down to smaller
// samples at once, drift up slowly), and draw at host-now − 0.12 s by blending the two states either side.
export const INTERP_DELAY = 0.12;

export class SnapshotBuffer {
  constructor(max = 12) { this.max = max; this.snaps = []; this.offset = null; }
  /** @param {number} hostTime seconds on the host's clock  @param {number} now local seconds  @param {object} state numbers / arrays of numbers */
  push(hostTime, now, state) {
    const off = hostTime - now;
    this.offset = this.offset === null || off < this.offset ? off : this.offset + (off - this.offset) * 0.05;
    this.snaps.push({ t: hostTime, s: state }); if (this.snaps.length > this.max) this.snaps.shift();
  }
  /** Returns {a, b, k}: the two states round the render time and the blend 0..1, or null if empty. */
  bracket(now) {
    const n = this.snaps.length; if (!n) return null;
    const t = now + this.offset - INTERP_DELAY;
    if (t <= this.snaps[0].t) return { a: this.snaps[0].s, b: this.snaps[0].s, k: 0 };
    for (let i = 1; i < n; i++) if (t <= this.snaps[i].t) { const a = this.snaps[i - 1], b = this.snaps[i]; return { a: a.s, b: b.s, k: (t - a.t) / Math.max(1e-6, b.t - a.t) }; }
    return { a: this.snaps[n - 1].s, b: this.snaps[n - 1].s, k: 0 }; // past the newest: hold
  }
}
export const lerpArr = (a, b, k, out) => { for (let i = 0; i < a.length; i++) out[i] = a[i] + (b[i] - a[i]) * k; return out; };
/** Normalised lerp of quaternions stored as [x, y, z, w] at offset o (fine for small steps between snapshots). */
export function nlerpQuat(a, b, k, out, o = 0) {
  let dot = a[o] * b[o] + a[o + 1] * b[o + 1] + a[o + 2] * b[o + 2] + a[o + 3] * b[o + 3]; const s = dot < 0 ? -1 : 1; let l = 0;
  for (let i = 0; i < 4; i++) { out[o + i] = a[o + i] + (b[o + i] * s - a[o + i]) * k; l += out[o + i] * out[o + i]; }
  l = Math.sqrt(l) || 1; for (let i = 0; i < 4; i++) out[o + i] /= l; return out;
}
