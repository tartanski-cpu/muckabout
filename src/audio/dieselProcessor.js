// Placeholder diesel engine voice. Runs in the audio thread (AudioWorkletGlobalScope) and
// is loaded as raw text by machineAudio.js, so it must stay self-contained: no imports.
//
// Model: each cylinder firing kicks a short pressure pulse into a bank of fixed resonators
// (the exhaust and block), plus a burst of bright noise for injector/valve clatter and a
// sub-harmonic at crank speed for the lumpy idle. Per-cylinder gain differences and a little
// cycle-to-cycle jitter stop it sounding like an oscillator. `load` makes it louder, brighter
// and knockier, which is what an engine lugging under hydraulic or digging load does.
class DieselProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 800, minValue: 200, maxValue: 4000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.cyl = o.cylinders || 6;
    // resonances: [Hz, Q, gain, extra gain per unit load]
    const res = o.resonances || [[58, 2.5, 1.0, 0.2], [118, 4, 0.8, 0.4], [236, 3, 0.45, 0.5], [410, 2.5, 0.22, 0.5], [960, 1.5, 0.08, 0.3]];
    this.res = res.map(([f, q, g, gl]) => {
      const w = 2 * Math.PI * f / sampleRate, a = Math.sin(w) / (2 * q), a0 = 1 + a;
      return { b0: a / a0, a1: -2 * Math.cos(w) / a0, a2: (1 - a) / a0, g, gl, x1: 0, x2: 0, y1: 0, y2: 0 };
    });
    this.cylGain = [];
    for (let i = 0; i < this.cyl; i++) this.cylGain.push(0.78 + 0.44 * (((i * 7919 + 13) % 17) / 16));
    this.rpm = o.idleRpm || 800; this.load = 0;
    this.phase = 0; this.sub = 0; this.idx = 0;
    this.pulse = 0; this.knock = 0; this.lp = 0;
    this.seed = 22222;
    this.pulseDecay = Math.exp(-1 / (0.005 * sampleRate));
    this.knockDecay = Math.exp(-1 / (0.0016 * sampleRate));
    this.smooth = 1 - Math.exp(-1 / (0.03 * sampleRate));
  }

  noise() { // xorshift, -1..1
    let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s;
    return (s >>> 0) / 2147483648 - 1;
  }

  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const rpmT = params.rpm[0], loadT = params.load[0], sr = sampleRate;
    for (let i = 0; i < out.length; i++) {
      this.rpm += (rpmT - this.rpm) * this.smooth;
      this.load += (loadT - this.load) * this.smooth;
      const load = this.load, crank = this.rpm / 60;
      // four-stroke: every cylinder fires once per two crank revolutions
      this.phase += crank * this.cyl / 2 / sr;
      if (this.phase >= 1) {
        this.phase -= 1;
        this.idx = (this.idx + 1) % this.cyl;
        const g = this.cylGain[this.idx] * (1 + 0.12 * this.noise());
        this.pulse += g;
        this.knock = g * (0.35 + 0.65 * load);
      }
      this.sub += crank / 2 / sr; if (this.sub >= 1) this.sub -= 1;
      const n = this.noise();
      this.lp += (n - this.lp) * 0.25;
      const exc = this.pulse * (0.75 + 0.25 * n);
      this.pulse *= this.pulseDecay; this.knock *= this.knockDecay;
      let y = 0;
      for (let k = 0; k < this.res.length; k++) {
        const r = this.res[k];
        const v = r.b0 * (exc - r.x2) - r.a1 * r.y1 - r.a2 * r.y2;
        r.x2 = r.x1; r.x1 = exc; r.y2 = r.y1; r.y1 = v;
        y += v * (r.g + r.gl * load);
      }
      y *= 2.2 * (0.7 + 0.5 * load);
      y += (n - this.lp) * this.knock * (0.10 + 0.22 * load);   // clatter
      y += Math.sin(2 * Math.PI * this.sub) * 0.06;               // half-order lump
      y += this.lp * 0.02 * (0.5 + this.rpm / 2000);              // intake / fan wash
      out[i] = Math.tanh(y * 1.3) * 0.7;
    }
    return true;
  }
}
registerProcessor('diesel', DieselProcessor);
