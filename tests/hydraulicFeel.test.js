import { describe, it, expect } from 'vitest';
import { HydraulicFeel } from '../src/audio/hydraulicFeel.js';

const fn = (cmd, pos) => [{ name: 'boom', cmd, pos, min: -1, max: 1 }];
const types = (ev) => ev.map((e) => e.type);

describe('HydraulicFeel', () => {
  it('clunks when a lever leaves and returns to neutral, once each', () => {
    const f = new HydraulicFeel();
    expect(types(f.update(0.01, fn(0, 0)))).toEqual([]);
    expect(types(f.update(0.01, fn(0.5, 0)))).toEqual(['clunk']);
    expect(types(f.update(0.01, fn(0.6, 0.1)))).toEqual([]);
    expect(f.demand).toBeCloseTo(0.6);
    expect(types(f.update(0.01, fn(0, 0.1)))).toEqual(['clunk']);
    expect(f.demand).toBe(0);
  });

  it('does not chatter inside the hysteresis band', () => {
    const f = new HydraulicFeel();
    f.update(0.01, fn(0.2, 0));
    for (const c of [0.1, 0.14, 0.09, 0.12]) expect(f.update(0.01, fn(c, 0))).toEqual([]);
  });

  it('clunks harder on a straight reversal', () => {
    const f = new HydraulicFeel();
    f.update(0.01, fn(1, 0));
    const ev = f.update(0.01, fn(-1, 0));
    expect(ev).toEqual([{ type: 'clunk', name: 'boom', strength: 1 }]);
  });

  it('clanks once on reaching an end stop, then reports relief while held there', () => {
    const f = new HydraulicFeel();
    f.update(0.01, fn(1, 0.9));
    expect(types(f.update(0.01, fn(1, 1)))).toEqual(['clank']);
    expect(types(f.update(0.01, fn(1, 1)))).toEqual([]);
    expect(f.relief).toBe(1);
    f.update(0.01, fn(-1, 0.9)); // back off: clunk, relief gone
    expect(f.relief).toBe(0);
    expect(types(f.update(0.01, fn(1, 1)))).toEqual(['clunk', 'clank']); // re-armed
    expect(f.counts).toEqual({ clunk: 3, clank: 2 });
  });

  it('stays quiet when resting on a stop without pushing into it', () => {
    const f = new HydraulicFeel();
    expect(f.update(0.01, fn(0, -1))).toEqual([]);
    expect(types(f.update(0.01, fn(1, -1)))).toEqual(['clunk']); // lifting off the stop
    expect(f.relief).toBe(0);
  });
});
