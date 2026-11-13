// Per-subsystem frame timing. No DOM or three.js dependency, so it runs on the
// main thread, in workers and in unit tests alike.
//
//   perf.begin('relax'); ...; perf.end('relax');   // may be called several times a frame
//   perf.count('clods', n);                        // gauges shown alongside the timings
//   perf.frame();                                  // once per rendered frame
//
// Timings are accumulated over a frame, then folded into an exponential moving
// average plus a worst-case over the last `window` frames. Averaging matters on
// the Quest: performance.now() is coarsened to ~0.1 ms there, which is the same
// order as some of the things we measure.

export class PerfMonitor {
  /**
   * @param {string[]} names timer names, in display order
   * @param {{now?: () => number, alpha?: number, window?: number}} [opts]
   */
  constructor(names, opts = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.alpha = opts.alpha ?? 0.1;
    this.window = opts.window ?? 72;
    this.names = [...names];
    this.timers = new Map();
    for (const n of this.names) this.timers.set(n, this._timer());
    this.counters = new Map();
    this.frameTimer = this._timer();
    this._lastFrame = -1;
    this.frames = 0;
  }

  _timer() {
    return { start: -1, acc: 0, avg: 0, max: 0, hist: new Float32Array(this.window), primed: false };
  }

  begin(name) {
    const t = this.timers.get(name);
    if (t) t.start = this.now();
  }

  end(name) {
    const t = this.timers.get(name);
    if (!t || t.start < 0) return;
    t.acc += this.now() - t.start;
    t.start = -1;
  }

  /** Add an externally measured duration (e.g. reported by a worker). */
  add(name, ms) {
    const t = this.timers.get(name);
    if (t) t.acc += ms;
  }

  /** Drop timings accumulated since the last frame() (e.g. after a fast-forward batch). */
  discard() {
    for (const t of this.timers.values()) { t.acc = 0; t.start = -1; }
  }

  count(name, value) {
    this.counters.set(name, value);
  }

  _fold(t, ms) {
    t.avg = t.primed ? t.avg + (ms - t.avg) * this.alpha : ms;
    t.primed = true;
    t.hist[this.frames % this.window] = ms;
    let m = 0;
    for (let i = 0; i < t.hist.length; i++) if (t.hist[i] > m) m = t.hist[i];
    t.max = m;
  }

  /** Close the current frame. */
  frame() {
    const now = this.now();
    if (this._lastFrame >= 0) this._fold(this.frameTimer, now - this._lastFrame);
    this._lastFrame = now;
    for (const t of this.timers.values()) {
      this._fold(t, t.acc);
      t.acc = 0;
      t.start = -1;
    }
    this.frames++;
  }

  snapshot() {
    const timers = this.names.map((name) => {
      const t = this.timers.get(name);
      return { name, avg: t.avg, max: t.max };
    });
    const f = this.frameTimer;
    return {
      fps: f.avg > 0 ? 1000 / f.avg : 0,
      frameMs: f.avg,
      frameMaxMs: f.max,
      timers,
      counters: [...this.counters].map(([name, value]) => ({ name, value })),
    };
  }
}
