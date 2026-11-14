// The engine as a torque balance: it must behave like a governed turbo-diesel, because the sound follows it.
import { describe, it, expect } from 'vitest';
import { Powertrain } from '../src/vehicles/powertrain.js';

const dt = 1 / 60;
const run = (p, sec, s) => { for (let i = 0; i < sec * 60; i++) p.step(dt, s); return p; };
const warm = (target = 2200) => run(Object.assign(new Powertrain({}), { rpm: 230 }), 4, { running: true, target });

describe('powertrain', () => {
  it('the governor holds the speed it is set to, on very little fuel', () => {
    const p = warm(800); expect(p.rpm).toBeGreaterThan(770); expect(p.rpm).toBeLessThan(805); expect(p.fuel).toBeLessThan(0.15);
    const q = warm(2200); expect(q.rpm).toBeGreaterThan(2120); expect(q.fuel).toBeLessThan(0.3);
  });
  it('load makes it run a little slower and a lot harder (droop)', () => {
    const p = warm(); const free = p.rpm; run(p, 4, { running: true, target: 2200, load: p.Tr * 0.8 });
    expect(p.rpm).toBeLessThan(free - 60); expect(p.rpm).toBeGreaterThan(free * 0.88); expect(p.fuel).toBeGreaterThan(0.75);
  });
  it('a sudden load sags it, smokes, and the turbo pulls it back', () => {
    const p = warm(); let low = p.rpm, smoke = 0;
    for (let i = 0; i < 180; i++) { p.step(dt, { running: true, target: 2200, load: p.Tr * 0.9 }); low = Math.min(low, p.rpm); smoke = Math.max(smoke, p.smoke); }
    expect(smoke).toBeGreaterThan(0.2);                  // fuel ahead of air
    expect(p.rpm).toBeGreaterThan(low + 20);             // recovered from the sag once boost arrived
    expect(p.boost).toBeGreaterThan(0.7);
  });
  it('more than it can give lugs it down without killing it, and it recovers when let go', () => {
    const p = warm(); run(p, 3, { running: true, target: 2200, load: p.Tr * 1.5 });
    expect(p.rpm).toBeLessThan(1300); expect(p.rpm).toBeGreaterThan(300); expect(p.lug).toBe(1);
    run(p, 3, { running: true, target: 2200 }); expect(p.rpm).toBeGreaterThan(2100);
  });
  it('cranks on the starter, and runs down when the fuel is cut', () => {
    const p = new Powertrain({}); run(p, 0.8, { running: false, cranking: true }); expect(p.rpm).toBeGreaterThan(200); expect(p.rpm).toBeLessThan(260);
    run(p, 3, { running: true, target: 800 }); expect(p.rpm).toBeGreaterThan(760);
    run(p, 0.3, { running: false }); expect(p.rpm).toBeGreaterThan(100); expect(p.rpm).toBeLessThan(760); // still turning
    run(p, 3, { running: false }); expect(p.rpm).toBe(0);
  });
  it('is deterministic', () => {
    const a = warm(), b = warm(); run(a, 2, { running: true, target: 1800, load: 300 }); run(b, 2, { running: true, target: 1800, load: 300 });
    expect(a.rpm).toBe(b.rpm); expect(a.boost).toBe(b.boost);
  });
});
