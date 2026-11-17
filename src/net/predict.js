// A client's own machine, drawn where it is now rather than where it was (roadmap 0b).
// Everything else a client sees is drawn INTERP_DELAY behind the host's newest state (snapshot.js), which is smooth
// but late: on top of the trip to the host and back, the machine you are driving answered about 0.15 s after your
// hand. The host stays the only one that simulates (terrain, digging and containers must agree for everyone), so this
// does not run the machine locally. It draws it ahead instead:
//   bodies     the newest host state carried forward along its own motion by how old it is (its age on arrival
//              plus half the round trip), so a moving machine is where the host now has it;
//   functions  boom, bucket, blade and bed: the newest host position plus what your own lever has asked for since
//              that state was made and until your input reaches the host (its age, a whole round trip, and half an
//              input interval), at the rate the host will move it. A lever moved here moves the part here, at once,
//              and the host's own answer then takes over as it arrives.
// The round trip is measured (session.js echoes each client's clock back in the host's snapshots).
// Both are eased towards their targets over FOLLOW⁻¹ s, so a correction (the host stopped the machine against a
// pile, say) slides rather than jumps.
import { nlerpQuat } from './snapshot.js';

export const PREDICT = { maxLead: 0.3, inputDelay: 0.025, follow: 18 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Machine hydraulic rate as the host's Machine.pre works it out, from the engine figures it sends. */
export function oilFlow(def, e) {
  const running = e[2] > 0.5, ed = def.engine;
  return running ? 0.4 + 0.6 * clamp((e[0] - ed.idleRpm) / (ed.maxRpm - ed.idleRpm), 0, 1) : 0;
}

export class OwnMachine {
  constructor() { this.state = null; this.lead = 0; this.rtt = 0.1; }
  reset() { this.state = null; }
  /**
   * @param {import('./snapshot.js').SnapshotBuffer} buf the host's states for this machine
   * @param {number} now local seconds  @param {number} dt frame time
   * @param {{def: any, fnList: any[], inp: object}} m the machine, whose `inp` holds this player's controls
   * @returns {{b: number[], f: number[], w: number[], e: number[]} | null}
   */
  step(buf, now, m, dt) {
    const n = buf.snaps.length; if (!n) return null;
    const B = buf.snaps[n - 1], A = n > 1 ? buf.snaps[n - 2] : B;
    const age = Math.max(0, now + buf.offset - B.t), lead = this.lead = Math.min(PREDICT.maxLead, age + this.rtt / 2), fLead = Math.min(PREDICT.maxLead, age + this.rtt + PREDICT.inputDelay);
    const span = B.t - A.t, k = span > 1e-3 ? 1 + Math.min(lead, span * 4) / span : 1; // never carry a motion more than four intervals past what was seen
    const a = A.s, b = B.s, want = { b: new Array(b.b.length), f: new Array(b.f.length), w: b.w, e: b.e };
    for (let i = 0; i < b.b.length; i += 7) {
      for (let q = 0; q < 3; q++) want.b[i + q] = a.b[i + q] + (b.b[i + q] - a.b[i + q]) * k;
      nlerpQuat(a.b, b.b, k, want.b, i + 3);
    }
    const flow = oilFlow(m.def, b.e);
    m.fnList.forEach((f, i) => {
      const cmd = clamp(m.inp[f.input ?? f.name] || 0, -1, 1) * (f.sign ?? 1), rate = f.manual ? f.rate : f.rate * flow;
      want.f[i] = clamp(b.f[i] + (Math.abs(cmd) > 0.05 ? cmd * rate * fLead : 0), f.min, f.max);
    });
    const s = this.state;
    if (!s || s.b.length !== want.b.length) { this.state = want; return want; }
    const t = Math.min(1, dt * PREDICT.follow);
    for (let i = 0; i < want.b.length; i += 7) {
      for (let q = 0; q < 3; q++) s.b[i + q] += (want.b[i + q] - s.b[i + q]) * t;
      nlerpQuat(s.b, want.b, t, s.b, i + 3);
    }
    for (let i = 0; i < want.f.length; i++) s.f[i] += (want.f[i] - s.f[i]) * t;
    s.w = want.w; s.e = want.e;
    return s;
  }
}
