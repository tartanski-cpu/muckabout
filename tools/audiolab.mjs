// Runs the engine-room audio worklet (src/audio/dieselProcessor.js) under Node, with no browser: the same code the
// headset runs, rendered to arrays so tests can measure it and tools/audiodemo.mjs can write it out as a WAV.
import fs from 'node:fs';
const SRC = fs.readFileSync(new URL('../src/audio/dieselProcessor.js', import.meta.url), 'utf8');

/** One engine voice. render(seconds, params | (t) => params) → Float32Array. */
export function engineVoice(opts = {}, sampleRate = 48000) {
  let Proc = null;
  class AudioWorkletProcessor { constructor() { this.port = { postMessage() {}, onmessage: null }; } }
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', SRC)(AudioWorkletProcessor, (_, c) => { Proc = c; }, sampleRate);
  const node = new Proc({ processorOptions: opts }), names = Proc.parameterDescriptors.map((d) => d.name);
  return {
    sampleRate, node,
    render(seconds, params) {
      const n = Math.round(seconds * sampleRate / 128) * 128, out = new Float32Array(n), p = {};
      for (let i = 0; i < n; i += 128) {
        const v = typeof params === 'function' ? params(i / sampleRate) : params;
        for (const k of names) p[k] = [v[k] ?? 0];
        node.process([], [[out.subarray(i, i + 128)]], p);
      }
      return out;
    },
  };
}

export const rms = (a, from = 0) => { let s = 0; for (let i = from; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length - from)); };
/** Power spectrum (Hann window, radix-2) of the last `size` samples: {bin(hz), band(lo, hi), peak(lo, hi), centroid()}. */
export function spectrum(a, sampleRate = 48000, size = 32768) {
  const re = new Float64Array(size), im = new Float64Array(size), off = a.length - size;
  for (let i = 0; i < size; i++) re[i] = a[off + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  for (let i = 1, j = 0; i < size; i++) { let b = size >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  for (let len = 2; len <= size; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < size; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
      re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
  const pw = new Float64Array(size / 2); for (let i = 0; i < size / 2; i++) pw[i] = re[i] * re[i] + im[i] * im[i];
  const hz = sampleRate / size, ix = (f) => Math.max(1, Math.min(size / 2 - 1, Math.round(f / hz)));
  return {
    band(lo, hi) { let s = 0; for (let i = ix(lo); i <= ix(hi); i++) s += pw[i]; return s; },
    peak(lo, hi) { let m = ix(lo); for (let i = ix(lo); i <= ix(hi); i++) if (pw[i] > pw[m]) m = i; return m * hz; },
    centroid() { let s = 0, w = 0; for (let i = 1; i < size / 2; i++) { s += pw[i] * i * hz; w += pw[i]; } return s / w; },
  };
}
const db = (x) => (10 * Math.log10(x + 1e-30)).toFixed(1);

if (import.meta.url === `file://${process.argv[1]}`) { // node tools/audiolab.mjs: a table of what the voice does in each state
  const states = { crank: { rpm: 230, starter: 1 }, idle: { rpm: 800, load: 0.08, boost: 0.03, fire: 1 }, 'idle cab': { rpm: 800, load: 0.08, boost: 0.03, fire: 1, cab: 1 }, 'high idle': { rpm: 2180, load: 0.15, boost: 0.2, fire: 1 },
    'full load': { rpm: 1950, load: 0.95, boost: 0.85, fire: 1 }, lugging: { rpm: 1300, load: 1, boost: 0.7, fire: 1 }, 'lift heavy': { rpm: 1500, load: 0.6, boost: 0.5, fire: 1, hydP: 0.9, hydQ: 0.8 },
    'lift empty': { rpm: 1500, load: 0.3, boost: 0.25, fire: 1, hydP: 0.3, hydQ: 0.8 }, relief: { rpm: 1500, load: 0.8, boost: 0.6, fire: 1, hydP: 1, hydQ: 1, relief: 1 } };
  console.log('state        rms    peak  <120Hz 120-500 0.5-2k  2-6k   6k+   centroid  firing');
  for (const [name, p] of Object.entries(states)) {
    const v = engineVoice({}), a = v.render(2.5, p), s = spectrum(a); let pk = 0; for (const x of a) pk = Math.max(pk, Math.abs(x));
    const tot = s.band(20, 20000), fire = (p.rpm || 0) / 120 * 6;
    console.log(name.padEnd(12), rms(a, 24000).toFixed(3), pk.toFixed(2), ...[[20, 120], [120, 500], [500, 2000], [2000, 6000], [6000, 20000]].map(([l, h]) => db(s.band(l, h) / tot).padStart(6)), s.centroid().toFixed(0).padStart(7), `${fire.toFixed(0)}→${s.peak(fire * 0.6, fire * 1.5).toFixed(0)} Hz`);
  }
}
