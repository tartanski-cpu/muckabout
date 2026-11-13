import { describe, it, expect } from 'vitest';
import { PerfMonitor } from '../src/harness/perf.js';

function clocked(names, opts) {
  let t = 0;
  const perf = new PerfMonitor(names, { now: () => t, ...opts });
  return { perf, tick: (ms) => { t += ms; } };
}

describe('PerfMonitor', () => {
  it('accumulates several begin/end pairs within one frame', () => {
    const { perf, tick } = clocked(['a', 'b']);
    perf.begin('a'); tick(2); perf.end('a');
    perf.begin('b'); tick(1); perf.end('b');
    perf.begin('a'); tick(3); perf.end('a');
    perf.frame();
    const { timers } = perf.snapshot();
    expect(timers).toEqual([{ name: 'a', avg: 5, max: 5 }, { name: 'b', avg: 1, max: 1 }]);
  });

  it('smooths the average and remembers the worst frame in the window', () => {
    const { perf, tick } = clocked(['a'], { alpha: 0.5, window: 4 });
    for (const ms of [1, 9, 1, 1]) { perf.begin('a'); tick(ms); perf.end('a'); perf.frame(); }
    let a = perf.snapshot().timers[0];
    expect(a.avg).toBeCloseTo(2); // 1 -> 5 -> 3 -> 2
    expect(a.max).toBe(9);
    for (let i = 0; i < 4; i++) { perf.begin('a'); tick(1); perf.end('a'); perf.frame(); }
    a = perf.snapshot().timers[0];
    expect(a.max).toBe(1); // the spike has left the window
  });

  it('derives fps from the time between frame() calls', () => {
    const { perf, tick } = clocked([]);
    for (let i = 0; i < 10; i++) { tick(1000 / 72); perf.frame(); }
    const s = perf.snapshot();
    expect(s.fps).toBeCloseTo(72, 3);
    expect(s.frameMaxMs).toBeCloseTo(1000 / 72, 3);
  });

  it('ignores unknown timers and unmatched end()', () => {
    const { perf, tick } = clocked(['a']);
    perf.begin('nope'); perf.end('nope'); perf.end('a'); tick(5); perf.frame();
    expect(perf.snapshot().timers[0].avg).toBe(0);
  });

  it('accepts externally measured durations and counters', () => {
    const { perf } = clocked(['worker']);
    perf.add('worker', 4.5); perf.count('clods', 120); perf.frame();
    const s = perf.snapshot();
    expect(s.timers[0].avg).toBe(4.5);
    expect(s.counters).toEqual([{ name: 'clods', value: 120 }]);
  });
});
