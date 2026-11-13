// Machine sound, fully synthesised (placeholder quality, no samples):
//   AudioBus      one shared AudioContext, master chain, noise buffer and the diesel worklet module
//   MachineVoice  one machine: diesel engine voice (AudioWorklet, dieselProcessor.js), hydraulic pump whine,
//                 relief squeal, valve clunks, end-stop clanks, dig noise, track clatter, reverse beeper, horn;
//                 positioned in the world through a PannerNode
//   MachineAudio  bus + one unpositioned voice with its own simple engine governor (used by the POC page)
import processorSource from './dieselProcessor.js?raw';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
let moduleUrl = null;
const processorUrl = () => (moduleUrl ??= URL.createObjectURL(new Blob([processorSource], { type: 'text/javascript' })));
const DIG_TONE = [500, 450, 260, 380, 900, 1900, 2400, 420]; // band centre per material id: mud dull, sand hissy, gravel crunchy

export class AudioBus {
  constructor(volume = 0.5) { this.volume = volume; this.ctx = null; this.voices = []; this.workletReady = false; }
  /** Create or resume. Must first be called from a user gesture (key, click, or entering VR). */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    let ac; try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    this.ctx = ac;
    this.master = ac.createGain(); this.master.gain.value = this.volume;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(ac.destination);
    const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    for (const v of this.voices) v._build();
    ac.audioWorklet?.addModule(processorUrl()).then(() => { this.workletReady = true; }).catch((e) => console.warn('diesel worklet failed to load', e));
  }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  /** River ambience: a soft wash placed at the nearest point of the river. Call every frame with that point. */
  river(pos) {
    const ac = this.ctx; if (!ac) return;
    if (!this._river) {
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
      const g = ac.createGain(); g.gain.value = 0.22;
      const p = ac.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 5; p.rolloffFactor = 1.4; p.maxDistance = 150;
      this.loopNoise().connect(hp); hp.connect(lp); lp.connect(g); g.connect(p); p.connect(this.master); this._river = p;
    }
    const p = this._river, t = ac.currentTime;
    if (p.positionX) { p.positionX.setTargetAtTime(pos.x, t, 0.1); p.positionY.setTargetAtTime(pos.y, t, 0.1); p.positionZ.setTargetAtTime(pos.z, t, 0.1); } else p.setPosition(pos.x, pos.y, pos.z);
  }
  loopNoise() { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(); return s; }
  /** Listener pose from camera world position and forward/up vectors. */
  setListener(p, f, u) {
    const l = this.ctx?.listener; if (!l) return;
    if (l.positionX) { const t = this.ctx.currentTime; l.positionX.setTargetAtTime(p.x, t, 0.05); l.positionY.setTargetAtTime(p.y, t, 0.05); l.positionZ.setTargetAtTime(p.z, t, 0.05);
      l.forwardX.setTargetAtTime(f.x, t, 0.05); l.forwardY.setTargetAtTime(f.y, t, 0.05); l.forwardZ.setTargetAtTime(f.z, t, 0.05); l.upX.setTargetAtTime(u.x, t, 0.05); l.upY.setTargetAtTime(u.y, t, 0.05); l.upZ.setTargetAtTime(u.z, t, 0.05); }
    else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }
}

export class MachineVoice {
  constructor(bus, { cylinders = 6, idleRpm = 800, maxRpm = 2200, positional = true } = {}) {
    this.bus = bus; this.opts = { cylinders, idleRpm, maxRpm, positional };
    this.rpm = idleRpm; this.load = 0; this.engine = null; this.built = false; this.engineOn = false;
    bus.voices.push(this); if (bus.ctx) this._build();
  }
  _build() {
    if (this.built) return; this.built = true;
    const bus = this.bus, ac = bus.ctx;
    const out = this.out = ac.createGain();
    if (this.opts.positional) {
      const p = this.panner = ac.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.2; p.maxDistance = 200;
      out.connect(p); p.connect(bus.master);
    } else out.connect(bus.master);
    // hydraulic pump whine: pitch follows engine speed, level follows demand
    const pump = this.pump = ac.createOscillator(); pump.type = 'sawtooth';
    const pumpLp = ac.createBiquadFilter(); pumpLp.type = 'lowpass'; pumpLp.frequency.value = 1400;
    this.pumpGain = ac.createGain(); this.pumpGain.gain.value = 0;
    pump.connect(pumpLp); pumpLp.connect(this.pumpGain); this.pumpGain.connect(out); pump.start();
    // oil hiss through the valve block
    const hissBp = ac.createBiquadFilter(); hissBp.type = 'bandpass'; hissBp.frequency.value = 3200; hissBp.Q.value = 0.8;
    this.hissGain = ac.createGain(); this.hissGain.gain.value = 0;
    bus.loopNoise().connect(hissBp); hissBp.connect(this.hissGain); this.hissGain.connect(out);
    // relief valve squeal: a narrow, slightly wobbling whistle
    const sq = ac.createOscillator(); sq.type = 'sawtooth'; sq.frequency.value = 1750;
    const wob = ac.createOscillator(); wob.frequency.value = 23; const wobG = ac.createGain(); wobG.gain.value = 35;
    wob.connect(wobG); wobG.connect(sq.frequency); wob.start();
    const sqBp = ac.createBiquadFilter(); sqBp.type = 'bandpass'; sqBp.frequency.value = 1750; sqBp.Q.value = 9;
    this.squealGain = ac.createGain(); this.squealGain.gain.value = 0;
    sq.connect(sqBp); sqBp.connect(this.squealGain); this.squealGain.connect(out); sq.start();
    // digging / spilling soil; the band moves with the material
    const digBp = this.digBp = ac.createBiquadFilter(); digBp.type = 'bandpass'; digBp.frequency.value = 500; digBp.Q.value = 0.6;
    this.digGain = ac.createGain(); this.digGain.gain.value = 0;
    bus.loopNoise().connect(digBp); digBp.connect(this.digGain); this.digGain.connect(out);
    // track clatter: noise gated by a square LFO whose rate follows track speed
    const clBp = ac.createBiquadFilter(); clBp.type = 'bandpass'; clBp.frequency.value = 1300; clBp.Q.value = 1.5;
    const clGate = ac.createGain(); clGate.gain.value = 0.5; this.clatterGain = ac.createGain(); this.clatterGain.gain.value = 0;
    const clLfo = this.clatterLfo = ac.createOscillator(); clLfo.type = 'square'; clLfo.frequency.value = 4; const clDepth = ac.createGain(); clDepth.gain.value = 0.5;
    clLfo.connect(clDepth); clDepth.connect(clGate.gain); clLfo.start();
    bus.loopNoise().connect(clBp); clBp.connect(clGate); clGate.connect(this.clatterGain); this.clatterGain.connect(out);
    // reverse beeper
    const bp = ac.createOscillator(); bp.type = 'square'; bp.frequency.value = 1050; const bGate = ac.createGain(); bGate.gain.value = 0.5;
    const bLfo = ac.createOscillator(); bLfo.type = 'square'; bLfo.frequency.value = 1.4; const bDepth = ac.createGain(); bDepth.gain.value = 0.5;
    bLfo.connect(bDepth); bDepth.connect(bGate.gain); bLfo.start(); this.beepGain = ac.createGain(); this.beepGain.gain.value = 0;
    bp.connect(bGate); bGate.connect(this.beepGain); this.beepGain.connect(out); bp.start();
  }
  _engine() {
    if (this.engine || !this.bus.workletReady) return;
    const ac = this.bus.ctx, { cylinders, idleRpm } = this.opts;
    this.engine = new AudioWorkletNode(ac, 'diesel', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { cylinders, idleRpm } });
    this.engineGain = ac.createGain(); this.engineGain.gain.value = 0;
    this.engine.connect(this.engineGain); this.engineGain.connect(this.out);
    this.engine.port.postMessage({ on: false });
  }

  /**
   * Drive from a machine's state: {running, cranking, rpm, load, demand, relief, dig, spill, tracks, reverse, digMat}.
   * pos: world position {x, y, z} of the machine (ignored for unpositioned voices).
   */
  drive(s, pos) {
    const ac = this.bus.ctx; if (!ac || !this.built) return;
    const t = ac.currentTime; this._engine();
    if (this.panner && pos) { const p = this.panner; if (p.positionX) { p.positionX.setTargetAtTime(pos.x, t, 0.05); p.positionY.setTargetAtTime(pos.y, t, 0.05); p.positionZ.setTargetAtTime(pos.z, t, 0.05); } else p.setPosition(pos.x, pos.y, pos.z); }
    const on = s.running || s.cranking;
    if (this.engine) {
      if (on !== this.engineOn) { this.engineOn = on; this.engine.port.postMessage({ on }); this.engineGain.gain.setTargetAtTime(on ? 0.9 : 0, t, on ? 0.15 : 0.25); }
      this.engine.parameters.get('rpm').setTargetAtTime(s.cranking ? 240 : s.rpm, t, 0.03);
      this.engine.parameters.get('load').setTargetAtTime(s.cranking ? 0.5 : s.load, t, 0.05);
    }
    const live = s.running ? 1 : 0;
    this.pump.frequency.setTargetAtTime(Math.max(200, s.rpm) / 60 * 9, t, 0.05); // nine-piston pump
    this.pumpGain.gain.setTargetAtTime(live * (s.demand * 0.03 + s.relief * 0.02), t, 0.06);
    this.hissGain.gain.setTargetAtTime(live * s.demand * 0.02, t, 0.05);
    this.squealGain.gain.setTargetAtTime(live * s.relief * 0.05, t, s.relief > 0 ? 0.12 : 0.04);
    this.digBp.frequency.setTargetAtTime(DIG_TONE[s.digMat || 0] || 500, t, 0.1);
    this.digGain.gain.setTargetAtTime(Math.min(1, s.dig * 0.9 + s.spill * 0.5) * 0.5, t, 0.06);
    this.clatterLfo.frequency.setTargetAtTime(2 + (s.tracks || 0) * 9, t, 0.1);
    this.clatterGain.gain.setTargetAtTime(Math.min(1, (s.tracks || 0) * 1.2) * 0.12, t, 0.08);
    this.beepGain.gain.setTargetAtTime(s.reverse ? 0.05 : 0, t, 0.02);
  }

  /** Play a HydraulicFeel event. */
  play(ev) { if (ev.type === 'clank') this.clank(ev.strength); else if (ev.type === 'clunk') this.clunk(ev.strength); }
  _burst(freq, q, dur, gain, type = 'bandpass') {
    const ac = this.bus.ctx, t = ac.currentTime, s = ac.createBufferSource(); s.buffer = this.bus.noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(t, Math.random() * 1.5, dur + 0.02);
  }
  _tone(f0, f1, dur, gain, type = 'sine') {
    const ac = this.bus.ctx, t = ac.currentTime, o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }
  /** Valve spool / linkage clunk: a dull knock with a small click on top. */
  clunk(strength = 0.6) {
    if (!this.bus.running || !this.built) return;
    const k = 0.9 + Math.random() * 0.2;
    this._tone(125 * k, 48, 0.09, 0.45 * strength); this._burst(1500 * k, 1.2, 0.025, 0.22 * strength); this._burst(320 * k, 2, 0.06, 0.25 * strength);
  }
  /** Cylinder hitting its end stop: thud plus ringing steel. */
  clank(strength = 0.8) {
    if (!this.bus.running || !this.built) return;
    const k = 0.94 + Math.random() * 0.12;
    this._tone(95, 42, 0.16, 0.6 * strength); this._burst(2600, 0.7, 0.018, 0.4 * strength, 'highpass');
    [311, 523, 842, 1377, 2203, 3170].forEach((f, i) => this._tone(f * k, f * k * 0.995, 0.5 / (1 + i * 0.45), 0.11 * strength / Math.sqrt(i + 1))); // inharmonic, like a struck plate
  }
  horn() {
    const ac = this.bus.ctx; if (!ac || !this.built) return;
    const t = ac.currentTime, g = ac.createGain(); g.gain.value = 0.12; g.connect(this.out);
    for (const f of [330, 415]) { const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + 0.45); }
  }
}

/** One self-contained machine sound with its own engine governor (the POC page). */
export class MachineAudio {
  constructor(opts = {}) { this.bus = new AudioBus(opts.volume ?? 0.5); this.voice = new MachineVoice(this.bus, { ...opts, positional: false }); this.opts = { idleRpm: 800, maxRpm: 2200, ...opts }; this.rpm = this.opts.idleRpm; this.load = 0; }
  get ctx() { return this.bus.ctx; } get engine() { return this.voice.engine; }
  start() { this.bus.start(); }
  /** Per-frame update; inputs 0..1: {throttle, demand, relief, dig, spill}. */
  update(dt, s) {
    const { idleRpm, maxRpm } = this.opts;
    const load = this.load = clamp(s.throttle * 0.35 + s.demand * 0.3 + s.relief * 0.45 + s.dig * 0.6, 0, 1);
    const target = idleRpm + (maxRpm - idleRpm) * clamp(s.throttle * 0.85 + s.demand * 0.3, 0, 1) - load * 160;
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 2.4 : 1.5));
    this.voice.drive({ running: true, rpm: this.rpm, load, demand: s.demand, relief: s.relief, dig: s.dig, spill: s.spill });
  }
  play(ev) { this.voice.play(ev); } clunk(s) { this.voice.clunk(s); } clank(s) { this.voice.clank(s); } horn() { this.voice.horn(); }
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
