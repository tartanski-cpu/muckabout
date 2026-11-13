// Turns hydraulic function state into "feel" events, with no audio or DOM dependency so it
// runs inside the deterministic sim step and in unit tests.
//
//   clunk  the valve spool opening, closing or reversing as a lever leaves or returns to neutral
//   clank  a cylinder slamming into its end stop
//
// Also tracks `demand` (how hard the pump is being asked to work, 0..1) and `relief`
// (0..1, a function is being held against its stop so oil is blowing over the relief valve).

const ON = 0.15, OFF = 0.08;

export class HydraulicFeel {
  constructor() {
    this.state = new Map();
    this.demand = 0;
    this.relief = 0;
    this.counts = { clunk: 0, clank: 0 };
    this._events = [];
  }

  /**
   * @param {number} dt seconds
   * @param {{name: string, cmd: number, pos: number, min: number, max: number}[]} fns
   *        cmd is the lever (-1..1), positive driving pos toward max
   * @returns {{type: 'clunk'|'clank', name: string, strength: number}[]} valid until the next call
   */
  update(dt, fns) {
    const ev = this._events; ev.length = 0;
    let demand = 0, relief = 0;
    for (const f of fns) {
      let s = this.state.get(f.name);
      if (!s) { s = { dir: 0, stop: 0 }; this.state.set(f.name, s); }
      const mag = Math.abs(f.cmd), eps = (f.max - f.min) * 0.002;
      // spool: hysteresis so a hand hovering at the threshold doesn't chatter
      const dir = mag > ON ? Math.sign(f.cmd) : mag < OFF ? 0 : s.dir;
      if (dir !== s.dir) {
        ev.push({ type: 'clunk', name: f.name, strength: dir === 0 ? 0.45 : s.dir === 0 ? 0.6 + 0.4 * mag : 1 });
        s.dir = dir;
      }
      // end stops: -1 at min, +1 at max, 0 in between
      const stop = f.pos <= f.min + eps ? -1 : f.pos >= f.max - eps ? 1 : 0;
      const into = stop !== 0 && dir === stop;
      if (stop !== 0 && s.stop === 0 && into) ev.push({ type: 'clank', name: f.name, strength: 0.4 + 0.6 * mag });
      s.stop = stop;
      if (into) relief = Math.max(relief, mag);
      if (dir !== 0) demand = Math.max(demand, mag);
    }
    this.demand = demand; this.relief = relief;
    for (const e of ev) this.counts[e.type]++;
    return ev;
  }
}
