// Machine sound, fully synthesised (no samples):
//   AudioBus      one shared AudioContext, master chain, the site's echo, a noise buffer and the engine worklet module
//   MachineVoice  one machine. The engine room (diesel, turbo, fan, hydraulic pump, relief valve, starter) is one
//                 AudioWorklet, dieselProcessor.js, driven by what the powertrain is doing. Round it, built from
//                 ordinary nodes: soil on steel by material, tracks, tyres and transmission, valve clunks, end-stop
//                 clanks, reverse beeper, horn. Placed in the world through a PannerNode, dulled by distance.
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
    // the site's echo: sound coming back off the tree line and the far bank (a made-up impulse: a few slaps, then a soft tail)
    const ir = ac.createBuffer(2, ac.sampleRate * 1.4, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0;
      for (let i = 0; i < d.length; i++) { const tt = i / ac.sampleRate; lp += ((Math.random() * 2 - 1) - lp) * 0.25; d[i] = lp * Math.exp(-tt * 4.2) * Math.min(1, tt / 0.05) * 0.5; }
      for (const [tt, a] of c ? [[0.09, 0.5], [0.21, 0.3], [0.37, 0.18]] : [[0.12, 0.5], [0.17, 0.3], [0.33, 0.2]]) d[tt * ac.sampleRate | 0] += a; }
    this.echo = ac.createConvolver(); this.echo.buffer = ir; this.echo.connect(this.master);
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
    const l = this.ctx?.listener; if (!l) return; this.ear = { x: p.x, y: p.y, z: p.z };
    if (l.positionX) { const t = this.ctx.currentTime; l.positionX.setTargetAtTime(p.x, t, 0.05); l.positionY.setTargetAtTime(p.y, t, 0.05); l.positionZ.setTargetAtTime(p.z, t, 0.05);
      l.forwardX.setTargetAtTime(f.x, t, 0.05); l.forwardY.setTargetAtTime(f.y, t, 0.05); l.forwardZ.setTargetAtTime(f.z, t, 0.05); l.upX.setTargetAtTime(u.x, t, 0.05); l.upY.setTargetAtTime(u.y, t, 0.05); l.upZ.setTargetAtTime(u.z, t, 0.05); }
    else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }
}

export class MachineVoice {
  constructor(bus, { cylinders = 6, idleRpm = 800, maxRpm = 2200, voice = {}, positional = true } = {}) {
    this.bus = bus; this.opts = { cylinders, idleRpm, maxRpm, voice, positional };
    this.rpm = idleRpm; this.load = 0; this.engine = null; this.built = false; this.boost = 0; this.last = 0;
    bus.voices.push(this); if (bus.ctx) this._build();
  }
  _build() {
    if (this.built) return; this.built = true;
    const bus = this.bus, ac = bus.ctx;
    const out = this.out = ac.createGain();
    // distance: the air takes the top off a far machine, and a little of every voice goes to the site's echo
    const air = this.air = ac.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 18000; air.Q.value = 0.5;
    out.connect(air);
    if (this.opts.positional) {
      const p = this.panner = ac.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.2; p.maxDistance = 200;
      air.connect(p); p.connect(bus.master);
      this.send = ac.createGain(); this.send.gain.value = 0.1; p.connect(this.send); this.send.connect(bus.echo);
    } else air.connect(bus.master);
    const noiseBand = (type, f, q) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; const g = ac.createGain(); g.gain.value = 0; bus.loopNoise().connect(b); b.connect(g); return [b, g]; };
    // digging / spilling soil; the band moves with the material, and a heavy fall of soil has a low rumble under it
    [this.digBp, this.digGain] = noiseBand('bandpass', 500, 0.6); this.digGain.connect(out);
    [, this.rumbleGain] = noiseBand('lowpass', 170, 0.7); this.rumbleGain.connect(out);
    // tracks: each pad slapping down (a gate whose rate follows track speed), over the grind of the running gear
    const gate = ac.createGain(); gate.gain.value = 0.5; this.clatterGain = ac.createGain(); this.clatterGain.gain.value = 0;
    const lfo = this.clatterLfo = ac.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 4; const depth = ac.createGain(); depth.gain.value = 0.5;
    lfo.connect(depth); depth.connect(gate.gain); lfo.start();
    const [, slap] = noiseBand('bandpass', 1300, 1.5), [, thump] = noiseBand('bandpass', 210, 1.2); slap.gain.value = 1; thump.gain.value = 1.4;
    slap.connect(gate); thump.connect(gate); gate.connect(this.clatterGain); this.clatterGain.connect(out);
    [this.squeakBp, this.squeakGain] = noiseBand('bandpass', 2900, 18); this.squeakGain.connect(out);
    // wheels: tyre roar, and the whine of the transmission rising with road speed
    [this.rollLp, this.rollGain] = noiseBand('lowpass', 220, 0.9); this.rollGain.connect(out);
    this.whine = ac.createOscillator(); this.whine.type = 'triangle'; this.whine2 = ac.createOscillator(); this.whine2.type = 'sine';
    this.whineGain = ac.createGain(); this.whineGain.gain.value = 0; this.whine.connect(this.whineGain); this.whine2.connect(this.whineGain); this.whineGain.connect(out);
    this.whine.start(); this.whine2.start();
    // reverse beeper
    const bp = ac.createOscillator(); bp.type = 'square'; bp.frequency.value = 1050; const bGate = ac.createGain(); bGate.gain.value = 0.5;
    const bLfo = ac.createOscillator(); bLfo.type = 'square'; bLfo.frequency.value = 1.4; const bDepth = ac.createGain(); bDepth.gain.value = 0.5;
    bLfo.connect(bDepth); bDepth.connect(bGate.gain); bLfo.start(); this.beepGain = ac.createGain(); this.beepGain.gain.value = 0;
    bp.connect(bGate); bGate.connect(this.beepGain); this.beepGain.connect(out); bp.start();
  }
  _engine() {
    if (this.engine || !this.bus.workletReady) return;
    const ac = this.bus.ctx, { cylinders, idleRpm, maxRpm, voice } = this.opts;
    this.engine = new AudioWorkletNode(ac, 'diesel', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { cylinders, idleRpm, maxRpm, ...voice } });
    this.engineGain = ac.createGain(); this.engineGain.gain.value = 0.9;
    this.engine.connect(this.engineGain); this.engineGain.connect(this.out);
    this.par = {}; for (const k of ['rpm', 'load', 'boost', 'fire', 'starter', 'hydP', 'hydQ', 'relief', 'cab']) this.par[k] = this.engine.parameters.get(k);
  }

  /**
   * Drive from Machine.audioState(): {running, cranking, rpm, load, boost, hydP, hydQ, relief, dig, spill, speed, wheels,
   * tracks, reverse, digMat, cab}. boost, hydP and hydQ are optional (the POC page has no powertrain): they are then
   * estimated from load, demand and relief. pos: world position of the machine (ignored for unpositioned voices).
   */
  drive(s, pos) {
    const ac = this.bus.ctx; if (!ac || !this.built) return;
    const t = ac.currentTime, dt = Math.min(0.1, Math.max(0, t - this.last)); this.last = t; this._engine();
    const set = (p, v, tc = 0.05) => p.setTargetAtTime(v, t, tc);
    if (this.panner && pos) {
      const p = this.panner; if (p.positionX) { set(p.positionX, pos.x); set(p.positionY, pos.y); set(p.positionZ, pos.z); } else p.setPosition(pos.x, pos.y, pos.z);
      const l = this.bus.ear, d = l ? Math.hypot(pos.x - l.x, pos.y - l.y, pos.z - l.z) : 0;
      set(this.air.frequency, 18000 / (1 + d / 28), 0.2); set(this.send.gain, s.cab ? 0.04 : 0.1 + Math.min(0.25, d / 200), 0.2);
    }
    const live = s.running ? 1 : 0, demand = s.demand || 0, relief = s.relief || 0;
    this.boost += ((s.load || 0) * live - this.boost) * Math.min(1, dt / 0.7);                    // stand-in turbo when the caller has none
    if (this.engine) {
      const P = this.par;
      set(P.rpm, s.rpm || 0, 0.03); set(P.fire, live, 0.02); set(P.starter, s.cranking ? 1 : 0, 0.03);
      set(P.load, s.cranking ? 0 : s.load || 0); set(P.boost, s.boost ?? this.boost);
      set(P.hydP, live * (s.hydP ?? Math.min(1, demand * 0.45 + relief * 0.55))); set(P.hydQ, live * (s.hydQ ?? demand));
      set(P.relief, live * relief, relief > 0 ? 0.1 : 0.04); set(P.cab, s.cab ? 1 : 0, 0.15);
    }
    set(this.digBp.frequency, DIG_TONE[s.digMat || 0] || 500, 0.1);
    set(this.digGain.gain, Math.min(1, s.dig * 0.9 + s.spill * 0.5) * 0.5, 0.06);
    set(this.rumbleGain.gain, Math.min(1, s.spill * 0.8 + s.dig * 0.35) * 0.5, 0.08);
    const trk = s.tracks || 0;
    set(this.clatterLfo.frequency, 2 + trk * 9, 0.1); set(this.clatterGain.gain, Math.min(1, trk * 1.2) * 0.12, 0.08);
    set(this.squeakBp.frequency, 2500 + 500 * Math.sin(t * 2.3), 0.1); set(this.squeakGain.gain, Math.min(1, trk) * 0.05 * (0.5 + 0.5 * Math.sin(t * 5.1)), 0.05);
    const road = s.wheels ? s.speed || 0 : 0;
    set(this.rollLp.frequency, 160 + road * 45, 0.1); set(this.rollGain.gain, Math.min(1, road / 6) * 0.35, 0.1);
    set(this.whine.frequency, 150 + road * 85, 0.08); set(this.whine2.frequency, (150 + road * 85) * 2.52, 0.08);
    set(this.whineGain.gain, live * Math.min(1, road / 1.5) * (0.006 + 0.012 * (s.load || 0)), 0.1);
    set(this.beepGain.gain, s.reverse ? 0.05 : 0, 0.02);
  }

  /** Play a HydraulicFeel event. */
  play(ev) {
    if (ev.type === 'clank') this.clank(ev.strength); else if (ev.type === 'clunk') this.clunk(ev.strength);
    else if (!this.bus.running || !this.built) return;
    else if (ev.type === 'start') { this._tone(70, 38, 0.35, 0.5); this._burst(260, 0.8, 0.3, 0.3); }             // it catches: a cough down the stack
    else if (ev.type === 'stop') { this._tone(52, 30, 0.5, 0.4); this._burst(900, 1.5, 0.05, 0.12); }             // fuel cut: the shudder as it stops
  }
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
    const t = ac.currentTime, g = ac.createGain(), f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.04); g.gain.setValueAtTime(0.3, t + 0.42); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    f.connect(g); g.connect(this.out);
    for (const hz of [311, 370, 313]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.connect(f); o.start(t); o.stop(t + 0.62); }
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
  for (const [k, v] of Object.entries({ rpm, load, boost: load * 0.8, fire: 1 })) node.parameters.get(k).value = v;
  node.connect(ac.destination);
  const d = (await ac.startRendering()).getChannelData(0);
  let sum = 0, peak = 0, finite = true;
  for (let i = 0; i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) finite = false; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  return { rms: Math.sqrt(sum / d.length), peak, finite };
}
