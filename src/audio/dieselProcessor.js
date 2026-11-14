// The engine room, synthesised: a turbo-diesel, its cooling fan, its hydraulic pump and relief valve, and the starter.
// Runs in the audio thread (AudioWorkletGlobalScope); machineAudio.js loads it as raw text, so it must stay
// self-contained: no imports. tests/engineVoice.test.js runs the same file under Node and measures what comes out.
//
// The structure follows the physically informed engine models (Baldan et al. 2015: per-cylinder sources feeding
// pipe resonators) rather than looping samples, so every sound follows crank speed and load continuously:
//
//   exhaust     each cylinder's blow-down is a pressure pulse sized by the fuel burnt. The pulses run through two
//               pipe resonators (manifold and stack: delay lines closed at the engine, open at the tip) and a
//               silencer whose cutoff opens with load, which is the "bark" of an engine that is working.
//               Cylinders differ a little and every cycle varies, more so at idle: the lumpy tick-over.
//   combustion  diesel knock: the sharp pressure rise rings the block (fixed modes) once per firing.
//   intake      the breathing side: a low resonance and rushing air that grows with boost.
//   turbo       a whistle whose pitch follows boost (shaft speed), and compressed-air hiss.
//   fan         blade-pass tone and broadband roar, with speed squared.
//   pump        piston-pass harmonics of the hydraulic pump (nine pistons, geared up so it sits between engine orders): level follows pressure, so lifting a full bucket
//               sounds harder than an empty one; a groan at high pressure and low flow; oil hiss with flow.
//   relief      the squeal of oil blowing over the relief valve when a cylinder is held against its stop.
//   starter     gear whine that slows on each compression while cranking.
//   cab         0..1: heard from the seat. The exhaust is muffled, the block and a cab boom come up.
//
// Everything is driven by k-rate parameters set from Machine.audioState(): the sound engine has no model of its
// own, it plays what the powertrain (src/vehicles/powertrain.js) is doing.
class DieselProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, defaultValue, minValue, maxValue) => ({ name, defaultValue, minValue, maxValue, automationRate: 'k-rate' });
    return [k('rpm', 0, 0, 4000), k('load', 0, 0, 1), k('boost', 0, 0, 1), k('fire', 0, 0, 1), k('starter', 0, 0, 1),
      k('hydP', 0, 0, 1), k('hydQ', 0, 0, 1), k('relief', 0, 0, 1), k('cab', 0, 0, 1)];
  }

  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const sr = this.sr = sampleRate;
    this.cyl = o.cylinders || 6;
    this.maxRpm = o.maxRpm || 2200;
    const size = o.size || 1;            // bigger engine: everything tuned lower
    // firing order, as fractions of the 720 degree cycle (even firing)
    const order = this.cyl === 6 ? [0, 4, 1, 5, 2, 3] : this.cyl === 4 ? [0, 2, 3, 1] : Array.from({ length: this.cyl }, (_, i) => i);
    this.order = order;
    // each cylinder: its own strength (injector and compression spread) and its own path length to the collector
    this.cylGain = []; this.cylLag = [];
    for (let i = 0; i < this.cyl; i++) { this.cylGain.push(0.82 + 0.36 * (((i * 7919 + 13) % 17) / 16)); this.cylLag.push(((i * 5 + 2) % this.cyl) / this.cyl * 0.0016 * sr | 0); }
    // pipes: round-trip delay in samples = 2 L / c
    const pipe = (len, g, damp) => ({ buf: new Float32Array(4096), n: Math.max(8, Math.min(4000, Math.round(2 * len * size / 343 * sr))), i: 0, g, damp, lp: 0 });
    this.stack = pipe(o.pipe || 1.7, 0.62, 0.42);
    this.manifold = pipe((o.pipe || 1.7) * 0.31, 0.5, 0.3);
    this.pending = new Float32Array(256); this.pi = 0;         // pulses on their way down the runners
    // block and structure modes rung by each combustion: [Hz, Q, gain]
    this.block = (o.block || [[430, 7, 1.0], [790, 8, 0.8], [1340, 9, 0.7], [2150, 8, 0.5], [3300, 6, 0.3]]).map(([f, q, g]) => this.bp(f / size, q, g));
    this.intakeRes = this.bp(175 / size, 2.2, 1); this.intakeAir = this.bp(900, 0.7, 1);
    this.fanBand = this.bp(520, 0.6, 1); this.hiss = this.bp(3400, 0.9, 1); this.sq = this.bp(1900, 14, 1);
    this.turboAir = this.bp(5200, 1.2, 1); this.boom = this.bp(58 / size, 3.5, 1); this.groan = this.bp(140, 5, 1);
    this.muf = { x1: 0, x2: 0, y1: 0, y2: 0, b0: 0, b1: 0, b2: 0, a1: 0, a2: 0 };
    // state
    this.rpm = 0; this.load = 0; this.boost = 0; this.fire = 0; this.hydP = 0; this.hydQ = 0; this.relief = 0; this.cab = 0; this.starter = 0;
    this.cycle = 0; this.next = 0;                              // 0..1 over two crank revolutions; index of the next cylinder to fire
    this.e1 = 0; this.e2 = 0; this.knock = 0; this.tick = 0;    // exhaust pulse (two-stage), combustion knock, injector tick
    this.inl = 0; this.exLp = 0; this.dc = 0; this.dcIn = 0; this.nLp = 0; this.nLp2 = 0; this.rough = 0;
    this.turboPh = 0; this.fanPh = 0; this.pumpPh = 0; this.sqPh = 0; this.stPh = 0; this.wob = 0;
    this.seed = 22222;
    this.silent = 0;
  }

  /** Band-pass resonator (constant peak gain). */
  bp(f, q, g) {
    const w = 2 * Math.PI * Math.min(f, this.sr * 0.45) / this.sr, a = Math.sin(w) / (2 * q), a0 = 1 + a;
    return { b0: a / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - a) / a0, g, x1: 0, x2: 0, y1: 0, y2: 0 };
  }
  run(r, x) { const y = r.b0 * (x - r.x2) - r.a1 * r.y1 - r.a2 * r.y2; r.x2 = r.x1; r.x1 = x; r.y2 = r.y1; r.y1 = y; return y; }
  noise() { let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s; return (s >>> 0) / 2147483648 - 1; }
  /** Pipe closed at the engine and open at the far end: the reflection comes back inverted and duller. */
  pipeRun(p, x) {
    const back = p.buf[p.i]; p.lp += (back - p.lp) * (1 - p.damp);
    const y = x - p.g * p.lp; p.buf[p.i] = y; if (++p.i >= p.n) p.i = 0; return y;
  }

  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const N = out.length, sr = this.sr;
    const rpmT = params.rpm[0], starter = params.starter[0];
    if (rpmT < 20 && this.rpm < 20 && starter < 0.01) { // stopped: silence, and no work
      if (this.silent < 4) { this.silent++; this.e1 = this.e2 = this.knock = 0; }
      return true;
    }
    this.silent = 0;
    // block-rate smoothing of the slow controls
    const kb = 1 - Math.exp(-N / (0.025 * sr));
    this.load += (params.load[0] - this.load) * kb; this.boost += (params.boost[0] - this.boost) * kb; this.fire += (params.fire[0] - this.fire) * kb;
    this.hydP += (params.hydP[0] - this.hydP) * kb; this.hydQ += (params.hydQ[0] - this.hydQ) * kb; this.relief += (params.relief[0] - this.relief) * kb;
    this.cab += (params.cab[0] - this.cab) * (1 - Math.exp(-N / (0.2 * sr))); this.starter += (starter - this.starter) * kb;
    const load = this.load, boost = this.boost, fire = this.fire, cab = this.cab, hydP = this.hydP, hydQ = this.hydQ, relief = this.relief, st = this.starter;
    const x = Math.min(1.3, this.rpm / this.maxRpm);            // speed as a fraction of rated
    // silencer: opens up with load (more gas, hotter, faster) and a little with speed
    {
      const fc = Math.min(5200, 300 + 2900 * Math.pow(load, 1.4) + 700 * x), w = 2 * Math.PI * fc / sr, q = 0.8, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al, m = this.muf;
      m.b0 = (1 - c) / 2 / a0; m.b1 = (1 - c) / a0; m.b2 = m.b0; m.a1 = -2 * c / a0; m.a2 = (1 - al) / a0;
    }
    // blow-down lasts a fixed share of the cycle, so the pulse shortens as the engine speeds up
    const period = 120 / Math.max(this.rpm, 60) / this.cyl;     // seconds between firings
    const d1 = Math.exp(-1 / (Math.max(0.0018, period * 0.42) * sr)), k2 = 1 - Math.exp(-1 / (Math.max(0.0004, period * 0.03) * sr));
    const dKnock = Math.exp(-1 / (0.0013 * sr)), dTick = Math.exp(-1 / (0.0003 * sr));
    const kr = 1 - Math.exp(-1 / (0.02 * sr));
    // gains for this block
    const gEx = (0.3 + load) * (0.55 + 0.75 * x), gKnock = (1.2 + 1.5 * load) * (2.4 - 1.5 * x), jitter = 0.07 + 0.2 * (1 - x) * (1 - load); // idle is lumpier
    const gFan = x * x, gTurbo = Math.pow(boost, 1.5), turboHz = 1500 + 6800 * Math.pow(boost, 0.8) + 600 * x;
    const pumpHz = this.rpm / 60 * 9 * 1.27, gPump = hydP * (0.35 + 0.65 * hydQ) + 0.04, gGroan = Math.max(0, hydP - 0.45) * (1.2 - hydQ * 0.7);
    const stHz = 120 + this.rpm * 2.1;
    const exOut = 1 - 0.45 * cab, exMuff = 0.9 * cab, gBlock = 0.55 + 0.5 * cab, gBoom = 0.6 * cab;
    const P2 = 2 * Math.PI, pend = this.pending;

    for (let i = 0; i < N; i++) {
      this.rpm += (rpmT - this.rpm) * kr;
      const n = this.noise();
      this.nLp += (n - this.nLp) * 0.12; this.nLp2 += (n - this.nLp2) * 0.02;
      // crank: every cylinder fires once per two revolutions
      this.cycle += this.rpm / 120 / sr;
      if (this.cycle >= 1) this.cycle -= 1;
      const due = this.next / this.cyl;
      if (this.cycle >= due && (this.next > 0 || this.cycle < 0.5)) {
        const c = this.order[this.next]; this.next = (this.next + 1) % this.cyl;
        this.rough += (this.noise() - this.rough) * 0.5;       // cycle-to-cycle variation drifts, it does not flicker
        const a = this.cylGain[c] * (1 + jitter * (this.rough * 1.6 + 0.4 * this.noise()));
        const comb = a * fire, comp = 0.16 * (1 - fire) + 0.05; // burning, or just compression chuffing through
        pend[(this.pi + this.cylLag[c]) & 255] += comb * gEx + comp;
        this.knock += comb * gKnock; this.tick += comb * 0.5;
        this.wob = a;                                           // the starter labours against this compression
      }
      // exhaust: pulse → runners → manifold and stack → silencer
      this.e1 = this.e1 * d1 + pend[this.pi]; pend[this.pi] = 0; this.pi = (this.pi + 1) & 255;
      this.e2 += (this.e1 - this.e2) * k2;
      const gas = this.e2 * (1 + 0.55 * this.nLp * (0.4 + load));   // turbulent, the more so the harder it blows
      const man = this.pipeRun(this.manifold, gas), stk = this.pipeRun(this.stack, gas + 0.35 * man);
      const pre = stk * 0.7 + man * 0.45, m = this.muf;
      let ex = m.b0 * pre + m.b1 * m.x1 + m.b2 * m.x2 - m.a1 * m.y1 - m.a2 * m.y2; m.x2 = m.x1; m.x1 = pre; m.y2 = m.y1; m.y1 = ex;
      ex += this.e2 * n * 0.05 * load;                              // stack chuff
      this.exLp += (ex - this.exLp) * 0.055;
      // combustion knock rings the block; the injectors tick on top
      const hit = this.knock * (0.55 + 0.45 * n) + this.tick * n * 0.3;
      this.knock *= dKnock; this.tick *= dTick;
      let blk = 0; for (let k = 0; k < this.block.length; k++) blk += this.run(this.block[k], hit) * this.block[k].g;
      // intake
      const intake = this.run(this.intakeRes, -this.e2) * 0.5 + this.run(this.intakeAir, n) * (0.02 + 0.1 * boost) * x;
      // turbo: whistle wandering a little, and the hiss of charge air
      this.turboPh += (turboHz * (1 + 0.012 * this.nLp2 * 8)) / sr; if (this.turboPh >= 1) this.turboPh -= 1;
      const turbo = (Math.sin(P2 * this.turboPh) * 0.035 + this.run(this.turboAir, n) * 0.11) * gTurbo;
      // fan: blade pass tone, roar chopped by the blades
      this.fanPh += this.rpm / 60 * 1.15 * 7 / sr; if (this.fanPh >= 1) this.fanPh -= 1;
      const fs = Math.sin(P2 * this.fanPh), fan = (fs * 0.02 + this.run(this.fanBand, n) * 0.2 * (1 + 0.45 * fs)) * gFan;
      // hydraulic pump: nine pistons a turn; pressure sets the level, a groan when it strains, hiss with flow
      this.pumpPh += pumpHz / sr; if (this.pumpPh >= 1) this.pumpPh -= 1;
      const pp = P2 * this.pumpPh;
      let hyd = (Math.sin(pp) + 0.5 * Math.sin(2 * pp + 0.6) + 0.28 * Math.sin(3 * pp + 1.1) + 0.12 * Math.sin(5 * pp)) * 0.05 * gPump;
      hyd += this.run(this.groan, (Math.sin(pp * 0.5) > 0 ? 1 : -1) * (0.6 + 0.8 * this.nLp)) * 0.09 * gGroan;
      hyd += this.run(this.hiss, n) * 0.07 * hydQ * (0.4 + 0.6 * hydP);
      // relief valve
      if (relief > 0.002) {
        this.sqPh += (1750 + 260 * this.nLp2 * 6 + 120 * hydP) / sr; if (this.sqPh >= 1) this.sqPh -= 1;
        hyd += (this.run(this.sq, Math.sin(P2 * this.sqPh) + 0.7 * n) * 0.16 + this.run(this.hiss, n) * 0.05) * relief;
      }
      // starter motor
      let starterS = 0;
      if (st > 0.002) {
        this.stPh += stHz / sr; if (this.stPh >= 1) this.stPh -= 1;
        const sp = P2 * this.stPh;
        starterS = (Math.sin(sp) + 0.6 * Math.sin(2 * sp) + 0.4 * Math.sin(3.02 * sp) + 0.5 * n * 0.4) * 0.11 * st * (0.7 + 0.3 * Math.sin(P2 * this.cycle * this.cyl));
      }
      // heard from outside or from the seat
      const boom = this.run(this.boom, ex) * gBoom;
      let y = ex * exOut + this.exLp * exMuff + boom + blk * gBlock + intake * 0.6 + turbo * (1 - 0.4 * cab) + fan * (1 - 0.5 * cab) + hyd + starterS;
      // remove the standing pressure the one-way pulses leave
      this.dc += (y - this.dc) * 0.0065; y -= this.dc; // (and the lowest rumble no headset speaker can play)
      out[i] = Math.tanh(y * 1.25) * 0.72;
    }
    return true;
  }
}
registerProcessor('diesel', DieselProcessor);
