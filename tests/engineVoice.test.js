// The engine-room worklet, run under Node (tools/audiolab.mjs) and measured: it has to follow the engine it is given.
import { describe, it, expect } from 'vitest';
import { engineVoice, rms, spectrum } from '../tools/audiolab.mjs';

const render = (p, opts = {}, sec = 2) => engineVoice(opts).render(sec, p);
const idle = { rpm: 800, load: 0.08, boost: 0.03, fire: 1 }, work = { rpm: 1950, load: 0.95, boost: 0.85, fire: 1 };
const hf = (a) => { const s = spectrum(a); return s.band(500, 6000) / s.band(20, 20000); };

describe('engine voice', () => {
  it('is silent when stopped and never blows up', () => {
    expect(rms(render({ rpm: 0 }))).toBe(0);
    for (const p of [idle, work, { rpm: 4000, load: 1, boost: 1, fire: 1, hydP: 1, hydQ: 1, relief: 1, cab: 1, starter: 1 }]) {
      const a = render(p); let peak = 0; for (const v of a) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, Math.abs(v)); }
      expect(peak).toBeLessThanOrEqual(0.75);
    }
  });
  it('fires at the right rate: cylinders x rpm / 120', () => {
    for (const [cyl, rpm] of [[6, 800], [6, 2000], [4, 900]]) {
      const f = cyl * rpm / 120, s = spectrum(render({ ...idle, rpm }, { cylinders: cyl }, 3));
      expect(Math.abs(s.peak(f * 0.6, f * 1.6) - f)).toBeLessThan(f * 0.06);
    }
  });
  it('a working engine is much louder and brighter than an idling one', () => {
    const a = render(idle), b = render(work);
    expect(rms(b, 24000)).toBeGreaterThan(rms(a, 24000) * 2); // (the deep tick-over carries a lot of level in its bass)
    expect(spectrum(b).centroid()).toBeGreaterThan(spectrum(a).centroid() * 1.5);
  });
  it('load alone changes the note at the same speed', () => {
    const light = render({ rpm: 1500, load: 0.15, boost: 0.1, fire: 1 }), heavy = render({ rpm: 1500, load: 0.95, boost: 0.8, fire: 1 });
    expect(rms(heavy, 24000)).toBeGreaterThan(rms(light, 24000) * 1.6); expect(hf(heavy)).toBeGreaterThan(hf(light) * 1.3);
  });
  it('the turbo whistles with boost', () => {
    const band = (b) => { const s = spectrum(render({ rpm: 1800, load: 0.6, boost: b, fire: 1 })); return s.band(4500, 9500); };
    expect(band(0.9)).toBeGreaterThan(band(0.05) * 4);
  });
  it("the pump is heard working: more pressure, more whine, at its piston-pass frequency", () => {
    const at = (hydP) => { const s = spectrum(render({ rpm: 1500, load: 0.4, boost: 0.3, fire: 1, hydP, hydQ: 0.8 }, {}, 3)); return s.band(279, 293); }; // 1500 / 60 x 9 pistons x 1.27 gearing = 286 Hz
    expect(at(0.9)).toBeGreaterThan(at(0.3) * 2.5); expect(at(0.3)).toBeGreaterThan(at(0) * 1.5);
  });
  it('the relief valve squeals', () => {
    const band = (relief) => spectrum(render({ rpm: 1500, load: 0.6, boost: 0.5, fire: 1, hydP: 1, hydQ: 1, relief })).band(1600, 2300);
    expect(band(1)).toBeGreaterThan(band(0) * 3);
  });
  it('sounds different from the seat: less top, same engine', () => {
    const out = render(work), cab = render({ ...work, cab: 1 });
    expect(hf(cab)).toBeLessThan(hf(out)); expect(rms(cab, 24000)).toBeGreaterThan(rms(out, 24000) * 0.5);
  });
  it('cranks without firing, and a bigger engine is tuned lower', () => {
    const crank = render({ rpm: 230, starter: 1 }); expect(rms(crank, 24000)).toBeGreaterThan(0.02); expect(rms(crank, 24000)).toBeLessThan(rms(render(idle), 24000) * 2);
    expect(spectrum(render(work, { size: 1.25 })).centroid()).toBeLessThan(spectrum(render(work, { size: 0.85 })).centroid());
  });
});
