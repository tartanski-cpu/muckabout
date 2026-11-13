import { describe, it, expect, beforeAll } from 'vitest';
import { rig } from './helpers.js';

const start = (m) => { m.inp.key = 1; m.inp.park = 0; };

describe('wheel loader', () => {
  let r;
  beforeAll(async () => { r = await rig('loader'); });

  it('settles on its wheels and stays put with the park brake on', () => {
    r.step(180);
    const p = r.m.position;
    expect(r.m.wheels.every((w) => w.grounded)).toBe(true);
    expect(Math.abs(p.x)).toBeLessThan(0.05); expect(Math.abs(p.z - 8)).toBeLessThan(0.05);
    expect(p.y - r.terrain.heightAt(p.x, p.z)).toBeLessThan(0.08);
    expect(Math.abs(r.m.speed)).toBeLessThan(0.02);
  });

  it('starts on the key, drives forward and brakes', () => {
    start(r.m); r.step(90);
    expect(r.m.engine.running).toBe(true);
    r.m.inp.shuttle = 1; r.m.inp.accel = 1; r.step(240);
    expect(r.m.speed).toBeGreaterThan(3); expect(r.m.speed).toBeLessThan(8.5);
    const z1 = r.m.position.z; expect(z1).toBeLessThan(0);
    r.m.inp.accel = 0; r.m.inp.brake = 1; r.step(180);
    expect(Math.abs(r.m.speed)).toBeLessThan(0.05);
    r.m.inp.brake = 0;
  });

  it('steers by articulating', () => {
    r.m.reset(0, 10, 0); r.step(60);
    const h0 = r.m.heading;
    r.m.inp.steer = 1; r.m.inp.shuttle = 1; r.m.inp.accel = 0.5; r.step(300);
    let dh = r.m.heading - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    expect(dh).toBeLessThan(-0.8); // turned right (clockwise from above)
    expect(Math.abs(r.m.joints[0].target)).toBeCloseTo(0.68, 2);
    r.m.inp.steer = 0; r.m.inp.accel = 0; r.step(120);
    for (const b of r.m.bodyList) expect(b.obj.matrixWorld.elements[5]).toBeGreaterThan(0.98); // still upright
  });

  it('digs the sand heap, carries the load and tips it, conserving volume', async () => {
    r.m.reset(5, 4, 0); r.step(60);
    const v0 = await r.total();
    // bucket flat on the ground
    r.m.inp.throttle = 1;
    r.step(200, (m) => { m.inp.boom = m.fn.boom.pos > -0.66 ? -1 : 0; m.inp.bucket = m.fn.bucket.pos > 0.0 ? -1 : m.fn.bucket.pos < -0.03 ? 1 : 0; });
    r.m.inp.boom = 0; r.m.inp.bucket = 0;
    r.m.inp.shuttle = 1; r.m.inp.accel = 0.7;
    r.step(400, (m) => { if (m.payload() > 1.7) m.inp.accel = 0; });
    const got = r.m.payload();
    expect(got).toBeGreaterThan(1.2);
    r.m.inp.accel = 0; r.m.inp.bucket = 1; r.m.inp.boom = 1; r.step(150);   // curl and lift
    r.m.inp.shuttle = -1; r.m.inp.accel = 0.6; r.m.inp.bucket = 0; r.step(200);
    r.m.inp.accel = 0; r.step(60);
    const carried = r.m.payload(); console.log('dug', got.toFixed(2), 'carried', carried.toFixed(2), 'speed', r.m.speed.toFixed(2));
    expect(carried).toBeGreaterThan(got * 0.7);
    r.m.inp.bucket = -1; r.step(240);                                       // tip
    expect(r.m.payload()).toBeLessThan(0.1);
    r.step(240);
    expect(r.clods.count).toBe(0);
    expect(Math.abs(await r.total() - v0) / v0).toBeLessThan(1e-4);
  });

  it('revving speeds the hydraulics', () => {
    const time = (thr) => { r.m.fn.boom.pos = -0.4; r.m.inp.throttle = thr; r.m.inp.boom = 0; r.step(90); r.m.inp.boom = 1; let n = 0; while (r.m.fn.boom.pos < 0.6 && n < 2000) { r.step(1); n++; } r.m.inp.boom = 0; return n; };
    r.m.inp.shuttle = 0; r.m.inp.accel = 0;
    const slow = time(0), fast = time(1);
    expect(fast).toBeLessThan(slow * 0.6);
  });
});

describe('dumper', () => {
  let r;
  beforeAll(async () => { r = await rig('dumper', { x: -8, z: 6 }); });
  it('sits level on six wheels, drives and steers', () => {
    r.step(120);
    expect(r.m.wheels.filter((w) => w.grounded).length).toBe(6);
    start(r.m); r.step(80);
    const h0 = r.m.heading;
    r.m.inp.shuttle = 1; r.m.inp.accel = 0.6; r.m.inp.steer = -1; r.step(240);
    let dh = r.m.heading - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    expect(dh).toBeGreaterThan(0.6); // turned left
    expect(r.m.speed).toBeGreaterThan(2);
    r.m.inp.accel = 0; r.m.inp.steer = 0; r.m.inp.brake = 1; r.step(180); r.m.inp.brake = 0;
    for (const b of r.m.bodyList) expect(b.obj.matrixWorld.elements[5]).toBeGreaterThan(0.98);
  });
  it('carries a load in the bed and tips it out behind', async () => {
    r.m.reset(-8, 6, 0); r.step(60);
    const v0 = await r.total(), bed = r.m.containers.bed, p = new (await import('three')).Vector3();
    bed.obj.getWorldPosition(p);
    for (let k = 0; k < 300; k++) { r.clods.pour('test', p.x, p.y + 2, p.z, 0, 0, 0, 4, 0.02, 1.5); r.step(1); } // 6 m³ of sand from above
    r.step(120);
    const loaded = r.m.payload('bed');
    expect(loaded).toBeGreaterThan(5.5);
    const sag = r.m.wheels[4].comp; expect(sag).toBeGreaterThan(0.01); // rear suspension feels the weight
    r.m.inp.shuttle = 1; r.m.inp.accel = 0.5; r.step(180); r.m.inp.accel = 0; r.step(120);
    expect(r.m.payload('bed')).toBeGreaterThan(loaded * 0.97); // nothing lost over the walls while driving
    r.m.inp.throttle = 1; r.m.inp.tip = 1; r.step(420); r.m.inp.tip = 0;
    expect(r.m.fn.tip.pos).toBeGreaterThan(1.0);
    expect(r.m.payload('bed')).toBeLessThan(0.15);
    r.step(240);
    // the spoil is on the ground behind the truck
    r.m.nodes.rear.localToWorld(p.set(0, 0, 6.0));
    expect(r.terrain.heightAt(p.x, p.z)).toBeGreaterThan(r.terrain.heightAt(p.x + 6, p.z) + 0.3);
    expect(Math.abs(await r.total() - v0 - 6) / v0).toBeLessThan(1e-4);
  });
});

describe('bulldozer', () => {
  it('tracks: drives straight, skid-steers, and holds on the brake', async () => {
    const r = await rig('dozer', { x: 8, z: 10 });
    r.step(120); expect(r.m.wheels.every((w) => w.grounded)).toBe(true);
    start(r.m); r.m.inp.throttle = 1; r.step(80);
    r.m.inp.left = 1; r.m.inp.right = 1; r.step(180);
    expect(r.m.speed).toBeGreaterThan(2.0); expect(r.m.speed).toBeLessThan(3.4);
    const h0 = r.m.heading; r.m.inp.left = 1; r.m.inp.right = -1; r.step(180);
    let dh = r.m.heading - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    expect(dh).toBeLessThan(-0.7); // spun right
    r.m.inp.left = 0; r.m.inp.right = 0; r.step(120);
    expect(Math.abs(r.m.speed)).toBeLessThan(0.05);
  });
  it('cuts a ramp through a terrace bank', async () => {
    const r = await rig('dozer', { x: -12, z: -40, yaw: Math.PI }, 'dirttown');
    const t = r.terrain, steep = () => { let s = 0; for (let z = -31; z < -24.5; z += 0.25) s = Math.max(s, Math.abs(t.heightAt(-12, z + 0.25) - t.heightAt(-12, z)) / 0.25); return Math.atan(s) * 180 / Math.PI; };
    const before = steep(), v0 = await r.total();
    expect(before).toBeGreaterThan(45);
    r.step(60); start(r.m); r.m.inp.throttle = 1; r.step(80);
    // what a driver does: blade down, shove the crest over the edge, back off when the nose drops, repeat
    let passes = 0, down = false, limit = -32;
    for (let pass = 0; pass < 60 && !down; pass++, passes++) {
      let worst = 1, tipped = false;
      r.step(1500, (m) => { const up = m.bodyList[0].obj.matrixWorld.elements[5]; worst = Math.min(worst, up);
        const lo = m.position.z < -28.5 ? -0.2 : 0.1; // blade down across the top and over the crest, carried on the way down the face
        m.inp.lift = m.fn.lift.pos > lo ? -1 : m.fn.lift.pos < lo - 0.03 ? 1 : 0;
        if (!m._back && up < 0.7) { m._back = true; tipped = true; }
        if (m.position.z > limit) m._back = true;
        const v = m._back ? (m.position.z > -38 ? -0.8 : 0) : (m.position.z > limit - 3 ? 0.35 : 0.7);
        let err = m.heading - Math.PI; while (err > Math.PI) err -= 2 * Math.PI; while (err < -Math.PI) err += 2 * Math.PI;
        const turn = Math.max(-0.3, Math.min(0.3, err * 2)); // hold the heading: more left track turns it right
        m.inp.left = v + turn; m.inp.right = v - turn; if (m._back) m.inp.lift = m.fn.lift.pos < 0.3 ? 1 : 0;
        if (m.position.z > -23.5) down = true; });
      r.m._back = false; if (!tipped) limit += 0.5;
      if (process.env.TRACE) process.stderr.write(`pass ${pass} z ${r.m.position.z.toFixed(1)} limit ${limit.toFixed(1)} worst ${worst.toFixed(2)} steep ${steep().toFixed(0)} profile ${[-36, -34, -32, -30, -28, -26, -24].map((z) => t.heightAt(-12, z).toFixed(1)).join(' ')}\n`);
    }
    expect(down).toBe(true);                       // drove down to the lower terrace on its own ramp
    expect(r.m.position.z).toBeLessThan(-36);      // and reversed back up it
    console.log('dozer ramp: bank', before.toFixed(0), '° →', steep().toFixed(0), '° in', passes, 'passes; dozer at z', r.m.position.z.toFixed(1), 'upright', r.m.bodyList[0].obj.matrixWorld.elements[5].toFixed(2));
    expect(steep()).toBeLessThan(40);
    expect(r.m.bodyList[0].obj.matrixWorld.elements[5]).toBeGreaterThan(0.8);
    expect(Math.abs(await r.total() - v0) / v0).toBeLessThan(1e-4);
  }, 60000);
});

describe('backhoe loader', () => {
  it('drives on its front-steer wheels', async () => {
    const r = await rig('backhoe', { x: 10, z: 8 });
    r.step(120); expect(r.m.wheels.every((w) => w.grounded)).toBe(true);
    start(r.m); r.step(80);
    const h0 = r.m.heading; r.m.inp.shuttle = 1; r.m.inp.accel = 0.6; r.m.inp.steer = 1; r.step(240);
    let dh = r.m.heading - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    expect(dh).toBeLessThan(-0.6); expect(r.m.speed).toBeGreaterThan(2);
    expect(r.m.bodyList[0].obj.matrixWorld.elements[5]).toBeGreaterThan(0.98);
  });
  it('swivels the seat, plants its stabilisers and digs a trench', async () => {
    const { Script, backhoeCycle } = await import('../src/game/autopilot.js');
    const r = await rig('backhoe', { x: 10, z: 6 }), m = r.m, T = (await import('three'));
    r.step(120); const v0 = await r.total(), z0 = m.position.z;
    const s = new Script(m, backhoeCycle(), { loop: true });
    const drive = () => { s.step(1 / 60); Object.assign(m.inp, m.override); };
    let n = 0; while (s.i < 2 && n++ < 2000) r.step(1, drive);
    while (s.i === 1 && n++ < 3000) r.step(1, drive);
    expect(m.fn.swivel.pos).toBeGreaterThan(3.1);                                   // seat faces the rear controls
    const fwd = new T.Vector3(0, 0, -1).applyQuaternion(m.seat.getWorldQuaternion(new T.Quaternion()));
    expect(fwd.z).toBeGreaterThan(0.99);
    expect(m.wheels[0].N + m.wheels[1].N).toBeLessThan(1000);                       // rear wheels are off the ground…
    expect(m.contacts[0].N + m.contacts[1].N).toBeGreaterThan(20000);               // …the legs carry the back end
    let peak = 0; while (s.cycles < 9 && n++ < 60 * 400) { r.step(1, drive); peak = Math.max(peak, m.payload('hoe')); }
    expect(s.cycles).toBe(9); expect(peak).toBeGreaterThan(0.2);
    m.override = {}; for (const k in m.inp) if (m.fn[k]) m.inp[k] = 0; r.step(240);
    let depth = 0; for (let d = 2.5; d < 6; d += 0.25) depth = Math.max(depth, -r.terrain.heightAt(10, z0 + d) + r.terrain.heightAt(6, z0 + d));
    let heap = 0; for (let d = 1; d < 5; d += 0.25) for (let x = 11; x < 15; x += 0.25) heap = Math.max(heap, r.terrain.heightAt(x, z0 + d) - r.terrain.heightAt(6, z0 + d));
    console.log('backhoe trench depth', depth.toFixed(2), 'spoil heap', heap.toFixed(2), 'drift', (m.position.z - z0).toFixed(2), 'steps', n);
    expect(depth).toBeGreaterThan(0.5); expect(heap).toBeGreaterThan(0.25);
    expect(Math.abs(m.position.z - z0)).toBeLessThan(0.6);
    expect(m.bodyList[0].obj.matrixWorld.elements[5]).toBeGreaterThan(0.97);
    expect(Math.abs(await r.total() - v0) / v0).toBeLessThan(1e-4);
  }, 60000);
});

describe('custom vehicle model (no rigid-body solver)', () => {
  const turn = (r, h0) => { let dh = r.m.heading - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI; return dh; };
  it('loader: drives, articulates, brakes, digs and tips with volume conserved', async () => {
    const r = await rig('loader'); r.m.setPhysics('custom'); r.step(120);
    expect(r.m.position.y - r.terrain.heightAt(0, 8)).toBeLessThan(0.05); expect(Math.abs(r.m.speed)).toBe(0);
    start(r.m); r.step(90); const h0 = r.m.heading;
    r.m.inp.shuttle = 1; r.m.inp.accel = 1; r.m.inp.steer = 1; r.step(240);
    expect(r.m.speed).toBeGreaterThan(3); expect(turn(r, h0)).toBeLessThan(-0.8);
    const front = r.m.bodies.front.obj, rear = r.m.bodies.rear.obj, T = await import('three');
    const hinge = (o) => o.localToWorld(new T.Vector3(0, 1, -1.5));
    expect(hinge(front).distanceTo(hinge(rear))).toBeLessThan(0.01);               // the two halves stay joined at the hinge
    r.m.inp.accel = 0; r.m.inp.steer = 0; r.m.inp.brake = 1; r.step(150); expect(r.m.speed).toBe(0); r.m.inp.brake = 0;
    r.m.reset(5, 4, 0); r.step(60); const v0 = await r.total();
    r.m.inp.throttle = 1;
    r.step(200, (m) => { m.inp.boom = m.fn.boom.pos > -0.66 ? -1 : 0; m.inp.bucket = m.fn.bucket.pos > 0.0 ? -1 : m.fn.bucket.pos < -0.03 ? 1 : 0; });
    r.m.inp.boom = 0; r.m.inp.bucket = 0; r.m.inp.accel = 0.7;
    let slowest = 9; r.step(400, (m) => { if (m.payload() > 1.7) m.inp.accel = 0; else if (m.payload() > 0.5) slowest = Math.min(slowest, m.speed); });
    const got = r.m.payload(); expect(got).toBeGreaterThan(1.2);
    r.m.inp.accel = 0; r.m.inp.bucket = 1; r.m.inp.boom = 1; r.step(150);
    r.m.inp.bucket = -1; r.step(300);
    expect(r.m.payload()).toBeLessThan(0.1); r.step(240);
    expect(Math.abs(await r.total() - v0) / v0).toBeLessThan(1e-4);
  });
  it('switches model mid-drive without a jolt', async () => {
    const r = await rig('loader'); r.step(120); start(r.m); r.step(90);
    r.m.inp.shuttle = 1; r.m.inp.accel = 0.8; r.step(180);
    const v = r.m.speed, p = r.m.position.clone();
    r.m.setPhysics('custom'); r.step(1);
    expect(Math.abs(r.m.speed - v)).toBeLessThan(0.3); expect(r.m.position.distanceTo(p)).toBeLessThan(0.3);
    r.step(60); r.m.setPhysics('rapier'); r.step(90);
    const tilt = r.m.bodyList[0].obj.matrixWorld.elements[5];
    expect(r.m.speed).toBeGreaterThan(v * 0.7); expect(tilt).toBeGreaterThan(0.9);
    r.m.inp.accel = 0; r.m.inp.brake = 1; r.step(180);
    for (const b of r.m.bodyList) expect(b.obj.matrixWorld.elements[5]).toBeGreaterThan(0.98); // settles upright on its wheels
  });
  it('dozer skid-steers and holds still; backhoe steers and its legs lift the back', async () => {
    let r = await rig('dozer', { x: 8, z: 10 }); r.m.setPhysics('custom'); r.step(60); start(r.m); r.m.inp.throttle = 1; r.step(80);
    r.m.inp.left = 1; r.m.inp.right = 1; r.step(180); expect(r.m.speed).toBeGreaterThan(2);
    const h0 = r.m.heading; r.m.inp.left = 1; r.m.inp.right = -1; r.step(180); expect(turn(r, h0)).toBeLessThan(-0.7);
    r.m.inp.left = 0; r.m.inp.right = 0; r.step(120); expect(Math.abs(r.m.speed)).toBeLessThan(0.02);
    r = await rig('backhoe', { x: 10, z: 8 }); r.m.setPhysics('custom'); r.step(60); start(r.m); r.m.inp.throttle = 1; r.step(80);
    const h1 = r.m.heading; r.m.inp.shuttle = 1; r.m.inp.accel = 0.6; r.m.inp.steer = 1; r.step(240); expect(turn(r, h1)).toBeLessThan(-0.6);
    r.m.inp.accel = 0; r.m.inp.park = 1; r.step(120); const y0 = r.m.nodes.chassis.localToWorld(new (await import('three')).Vector3(0, 0, 1.2)).y;
    r.m.inp.stabL = 1; r.m.inp.stabR = 1; r.step(240);
    const y1 = r.m.nodes.chassis.localToWorld(new (await import('three')).Vector3(0, 0, 1.2)).y;
    expect(y1 - y0).toBeGreaterThan(0.04); expect(r.m.wheels[0].grounded).toBe(false);
  });
  it('dumper carries and tips; a parked machine blocks the way', async () => {
    const r = await rig('dumper', { x: -8, z: 6 }); r.m.setPhysics('custom'); r.step(60); start(r.m); r.step(80);
    r.m.inp.shuttle = 1; r.m.inp.accel = 0.6; r.step(200); expect(r.m.speed).toBeGreaterThan(2);
    // a second machine dead ahead
    const { Machine } = await import('../src/vehicles/machine.js'), { readFileSync } = await import('node:fs');
    const p = r.m.position.clone(), f = { x: -Math.sin(r.m.heading), z: -Math.cos(r.m.heading) };
    const other = r.phys.add(new Machine(JSON.parse(readFileSync(new URL('../machines/dozer.json', import.meta.url))), r.phys, r.terrain, { id: 'block', x: p.x + f.x * 12, z: p.z + f.z * 12 })); other.setPhysics('custom');
    r.step(400);
    expect(Math.hypot(r.m.position.x - other.position.x, r.m.position.z - other.position.z)).toBeGreaterThan(3.5); // stopped short of it
    expect(other.position.distanceTo({ x: p.x + f.x * 12, y: other.position.y, z: p.z + f.z * 12 })).toBeLessThan(0.3);
  });
});
