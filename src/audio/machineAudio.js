// Sound for one machine: a diesel engine voice (AudioWorklet, dieselProcessor.js) plus
// hydraulic pump whine, relief-valve squeal, valve clunks, end-stop clanks, dig noise and horn.
// Placeholder quality: everything is synthesised, no samples.
import processorSource from './dieselProcessor.js?raw';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
let moduleUrl = null;
const processorUrl = () => (moduleUrl ??= URL.createObjectURL(new Blob([processorSource], { type: 'text/javascript' })));

export class MachineAudio {
  constructor({ cylinders = 6, idleRpm = 800, maxRpm = 2200, volume = 0.5 } = {}) {
    this.opts = { cylinders, idleRpm, maxRpm, volume };
    this.rpm = idleRpm;
    this.load = 0;
    this.ctx = null;
    this.engine = null; // AudioWorkletNode once loaded
  }

  /** Create (or resume) the audio graph. Must first be called from a user gesture. */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    let ac;
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    this.ctx = ac;
    const master = this.master = ac.createGain(); master.gain.value = this.opts.volume;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    master.connect(comp); comp.connect(ac.destination);

    const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    const loopNoise = () => { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };

    // hydraulic pump whine: pitch follows engine speed, level follows demand
    const pump = this.pump = ac.createOscillator(); pump.type = 'sawtooth';
    const pumpLp = ac.createBiquadFilter(); pumpLp.type = 'lowpass'; pumpLp.frequency.value = 1400;
    const pumpG = this.pumpGain = ac.createGain(); pumpG.gain.value = 0;
    pump.connect(pumpLp); pumpLp.connect(pumpG); pumpG.connect(master); pump.start();
    // oil hiss through the valve block
    const hissBp = ac.createBiquadFilter(); hissBp.type = 'bandpass'; hissBp.frequency.value = 3200; hissBp.Q.value = 0.8;
    const hissG = this.hissGain = ac.createGain(); hissG.gain.value = 0;
    loopNoise().connect(hissBp); hissBp.connect(hissG); hissG.connect(master);
    // relief valve squeal: a narrow, slightly wobbling whistle
    const sq = this.squeal = ac.createOscillator(); sq.type = 'sawtooth'; sq.frequency.value = 1750;
    const wob = ac.createOscillator(); wob.frequency.value = 23; const wobG = ac.createGain(); wobG.gain.value = 35;
    wob.connect(wobG); wobG.connect(sq.frequency); wob.start();
    const sqBp = ac.createBiquadFilter(); sqBp.type = 'bandpass'; sqBp.frequency.value = 1750; sqBp.Q.value = 9;
    const sqG = this.squealGain = ac.createGain(); sqG.gain.value = 0;
    sq.connect(sqBp); sqBp.connect(sqG); sqG.connect(master); sq.start();
    // digging / spilling soil
    const digBp = ac.createBiquadFilter(); digBp.type = 'bandpass'; digBp.frequency.value = 500; digBp.Q.value = 0.6;
    const digG = this.digGain = ac.createGain(); digG.gain.value = 0;
    loopNoise().connect(digBp); digBp.connect(digG); digG.connect(master);

    ac.audioWorklet?.addModule(processorUrl()).then(() => {
      const { cylinders, idleRpm } = this.opts;
      this.engine = new AudioWorkletNode(ac, 'diesel', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { cylinders, idleRpm } });
      const g = ac.createGain(); g.gain.value = 0.0001;
      g.gain.exponentialRampToValueAtTime(0.9, ac.currentTime + 0.6); // fade in instead of popping
      this.engine.connect(g); g.connect(master);
    }).catch((e) => console.warn('diesel worklet failed to load', e));
  }

  /**
   * Per-frame update. All inputs 0..1.
   * @param {{throttle: number, demand: number, relief: number, dig: number, spill: number}} s
   */
  update(dt, s) {
    const { idleRpm, maxRpm } = this.opts;
    // Simple governor: throttle sets the target, hydraulic demand nudges it up, load drags it down.
    const load = this.load = clamp(s.throttle * 0.35 + s.demand * 0.3 + s.relief * 0.45 + s.dig * 0.6, 0, 1);
    const target = idleRpm + (maxRpm - idleRpm) * clamp(s.throttle * 0.85 + s.demand * 0.3, 0, 1) - load * 160;
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 2.4 : 1.5));
    const ac = this.ctx;
    if (!ac) return;
    const t = ac.currentTime;
    if (this.engine) {
      this.engine.parameters.get('rpm').setTargetAtTime(this.rpm, t, 0.03);
      this.engine.parameters.get('load').setTargetAtTime(load, t, 0.05);
    }
    this.pump.frequency.setTargetAtTime(this.rpm / 60 * 9, t, 0.05); // nine-piston pump
    this.pumpGain.gain.setTargetAtTime(s.demand * 0.03 + s.relief * 0.02, t, 0.06);
    this.hissGain.gain.setTargetAtTime(s.demand * 0.02, t, 0.05);
    this.squealGain.gain.setTargetAtTime(s.relief * 0.05, t, s.relief > 0 ? 0.12 : 0.04);
    this.digGain.gain.setTargetAtTime(Math.min(1, s.dig * 0.9 + s.spill * 0.5) * 0.5, t, 0.06);
  }

  /** Play a HydraulicFeel event. */
  play(ev) {
    if (ev.type === 'clank') this.clank(ev.strength); else this.clunk(ev.strength);
  }

  _burst(freq, q, dur, gain, type = 'bandpass') {
    const ac = this.ctx, t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 1.5, dur + 0.02);
  }

  _tone(f0, f1, dur, gain, type = 'sine') {
    const ac = this.ctx, t = ac.currentTime;
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  /** Valve spool / linkage clunk: a dull knock with a small click on top. */
  clunk(strength = 0.6) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const k = 0.9 + Math.random() * 0.2;
    this._tone(125 * k, 48, 0.09, 0.45 * strength);
    this._burst(1500 * k, 1.2, 0.025, 0.22 * strength);
    this._burst(320 * k, 2, 0.06, 0.25 * strength);
  }

  /** Cylinder hitting its end stop: thud plus ringing steel. */
  clank(strength = 0.8) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const k = 0.94 + Math.random() * 0.12;
    this._tone(95, 42, 0.16, 0.6 * strength);
    this._burst(2600, 0.7, 0.018, 0.4 * strength, 'highpass');
    const partials = [311, 523, 842, 1377, 2203, 3170]; // inharmonic, like a struck plate
    partials.forEach((f, i) => this._tone(f * k, f * k * 0.995, 0.5 / (1 + i * 0.45), 0.11 * strength / Math.sqrt(i + 1)));
  }

  horn() {
    const ac = this.ctx; if (!ac) return;
    const t = ac.currentTime, g = ac.createGain(); g.gain.value = 0.12; g.connect(this.master);
    for (const f of [330, 415]) { const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + 0.45); }
  }
}

/** Render the engine voice offline and report its level; used by the scripted test. */
export async function renderEngine({ seconds = 1, rpm = 800, load = 0, cylinders = 6 } = {}) {
  const sr = 48000, ac = new OfflineAudioContext(1, sr * seconds, sr);
  await ac.audioWorklet.addModule(processorUrl());
  const node = new AudioWorkletNode(ac, 'diesel', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { cylinders, idleRpm: rpm } });
  node.parameters.get('rpm').value = rpm; node.parameters.get('load').value = load;
  node.connect(ac.destination);
  const d = (await ac.startRendering()).getChannelData(0);
  let sum = 0, peak = 0, finite = true;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) finite = false; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  return { rms: Math.sqrt(sum / d.length), peak, finite };
}
