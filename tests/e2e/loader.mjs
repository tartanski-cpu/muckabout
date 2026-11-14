// M2: the loader on Rapier, operated only through its physical cab controls by simulated hands,
// then a scripted dig-and-tip through the same input path the controls feed.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?worker=0&scene=play&map=test');
  await page.waitForFunction(() => __game.machines?.length);
  // wait for rendered frames / simulated seconds, not wall-clock time: software GL is slow and uneven
  const frame = async (simMs = 0) => {
    const t = await page.evaluate(() => [__game.frame, __game.simTime]);
    await page.waitForFunction(([f, st, ms]) => __game.frame >= f + 3 && __game.simTime >= st + ms / 1000, [t[0], t[1], simMs], { timeout: 60000, polling: 30 });
  };
  // helpers living in the page
  await page.evaluate(() => {
    const g = __game, V = g.THREE.Vector3, m = g.machine('loader'); window.m = m; window.P = g.play;
    window.at = (ctl, lx = null, ly = 0, lz = 0) => (lx === null ? m.controls[ctl].grabPoint(new V()) : m.controls[ctl].root.localToWorld(new V(lx, ly, lz)));
    // hands are given in world space, then pinned to the cab so they ride along when the machine moves
    window.hand = (side, pos, grip, extra = {}) => P.input.setFake(side, pos ? { pos: m.nodes.rear.worldToLocal(pos.clone()), parent: m.nodes.rear, grip, ...extra } : null);
  });

  // climb in by the handrail
  check(await page.evaluate(() => !P.player.seated), 'player starts on foot');
  await page.evaluate(() => hand('right', at('rail'), false)); await frame();
  check(await page.evaluate(() => m.controls.rail.hovered), 'handrail highlights under the hand');
  await page.evaluate(() => hand('right', at('rail'), true)); await frame();
  check(await page.evaluate(() => P.player.machine === m), 'grabbing the handrail seats the player');
  await page.evaluate(() => hand('right', at('rail'), false)); await frame();

  // ignition key: take hold and let go flips it; the engine cranks then runs
  await page.evaluate(() => hand('right', at('key'), true)); await frame();
  await page.evaluate(() => hand('right', at('key'), false)); await frame(1500);
  check(await page.evaluate(() => m.engine.running), 'key starts the engine after cranking');

  // park brake lever: take the red knob and push it forward
  await page.evaluate(() => hand('right', at('park'), true)); await frame();
  await page.evaluate(() => { const c = m.controls.park, k = c.root.worldToLocal(at('park')); hand('right', c.root.localToWorld(new __game.THREE.Vector3(k.x, k.y, k.z - 0.24)), true); }); await frame();
  await page.evaluate(() => hand('right', at('park', 0, 0.4, 0.1), false)); await frame();
  check(await page.evaluate(() => m.controls.park.value === 0 && m.inp.park === 0), 'pushing the park brake lever forward releases it');
  // laser: point at the stick-assist rocker from half a metre away and pull the trigger
  await page.evaluate(() => { const V = __game.THREE.Vector3, t = m.controls.assist.pressPoint(new V()), from = t.clone().add(new V(0.1, 0.45, 0.25)); window._ray = { from, dir: t.clone().sub(from) }; P.input.setFake('right', { pos: m.nodes.rear.worldToLocal(from.clone()), parent: m.nodes.rear, dir: _ray.dir, grip: false }); }); await frame();
  const lz = await page.evaluate(() => ({ line: P.inter.state.right.line.visible, hover: m.controls.assist.hovered, pose: P.hands.h.right.pose }));
  check(lz.line && lz.hover && lz.pose === 'point', 'laser pointer finds a rocker out of reach; the hand points');
  await page.evaluate(() => { const f = P.input.fake.right; f.trigger = 1; }); await frame();
  await page.evaluate(() => { const f = P.input.fake.right; f.trigger = 0; }); await frame();
  check(await page.evaluate(() => m.controls.assist.value === 1), 'trigger presses it through the laser');
  await page.evaluate(() => { const f = P.input.fake.right; f.trigger = 1; }); await frame();
  await page.evaluate(() => { const f = P.input.fake.right; f.trigger = 0; }); await frame();
  await page.evaluate(() => hand('right', at('park', 0, 0.4, 0.1), false)); await frame();

  // shuttle lever: grab the knob, push forward into the F detent; the glove rides the knob
  await page.evaluate(() => hand('left', at('shuttle'), true)); await frame();
  await page.evaluate(() => hand('left', at('shuttle', 0, 0.16, -0.09), true)); await frame();
  const lev = await page.evaluate(() => ({ v: m.controls.shuttle.value, d: P.hands.h.left.root.position.distanceTo(m.controls.shuttle.grabPoint(new __game.THREE.Vector3())), real: P.input.hands.left.pos.distanceTo(m.controls.shuttle.grabPoint(new __game.THREE.Vector3())) }));
  check(lev.v === 1, `shuttle lever snaps into F (${lev.v})`);
  check(lev.d < 0.01 && lev.real > 0.02, `glove sits on the knob while the real hand is ${(lev.real * 100).toFixed(0)} cm off`);
  await page.evaluate(() => hand('left', null));
  await frame();

  // steering wheel: left hand takes the top of the rim and pulls it a quarter turn clockwise
  await page.evaluate(() => hand('left', at('steer', 0, 0.19, 0), true)); await frame();
  for (const a of [70, 50, 30, 10, 0]) { await page.evaluate((a) => hand('left', at('steer', 0.19 * Math.cos(a * Math.PI / 180), 0.19 * Math.sin(a * Math.PI / 180), 0), true), a); await frame(); }
  const steer = await page.evaluate(() => m.controls.steer.value);
  check(steer > 0.3 && steer < 0.4, `quarter turn clockwise steers right (${steer.toFixed(2)} of full lock)`);

  // right hand on the loader joystick: its trigger is the accelerator; pulling the stick back raises the boom
  await page.evaluate(() => hand('right', at('loader'), true, { trigger: 1 })); await frame();
  const boom0 = await page.evaluate(() => m.fn.boom.pos);
  await page.evaluate(() => hand('right', at('loader', 0, 0.16, 0.07), true, { trigger: 1 })); await frame(1500);
  const drive = await page.evaluate(() => ({ speed: m.speed, boom: m.fn.boom.pos, joint: m.joints[0].target, accel: m.inp.accel }));
  check(drive.speed > 1.5, `trigger on a held control drives forward (${drive.speed.toFixed(1)} m/s)`);
  check(drive.boom > boom0 + 0.3, 'joystick pulled back raises the boom');
  check(drive.joint < -0.15, 'machine is articulating to the right');
  await page.screenshot({ path: 'shots/loader_cab.png' });
  // let go of everything: stick springs back, accelerator lifts, machine stops
  await page.evaluate(() => { hand('right', null); hand('left', null); }); await frame(2500);
  const rest = await page.evaluate(() => ({ speed: m.speed, joy: m.controls.loader.value, accel: m.inp.accel }));
  check(Math.abs(rest.speed) < 0.3 && rest.joy.y === 0 && rest.accel === 0, 'releasing the controls stops the machine');

  // an Xbox pad on the desktop: right trigger goes, right stick works the bucket, B is the park brake
  const padSet = (axes, btn) => page.evaluate(([axes, btn]) => { P.pad.fake = { axes, buttons: Array.from({ length: 17 }, (_, i) => ({ value: btn[i] || 0 })) }; }, [axes, btn]);
  const tilt1 = await page.evaluate(() => m.fn.bucket.pos);
  await padSet([0.4, 0, 1, 0], { 7: 1 }); await frame(2500);
  const pd = await page.evaluate(() => ({ accel: m.inp.accel, gear: m.gear, pull: m.tractive, tilt: m.fn.bucket.pos, steer: m.inp.steer, on: P.pad.on }));
  check(pd.on && pd.accel === 1 && pd.gear === 1 && pd.pull > 1e4 && pd.steer > 0.2, `gamepad: right trigger drives forward, left stick steers (pull ${(pd.pull / 1000).toFixed(0)} kN, steer ${pd.steer.toFixed(2)})`); // (it may be nose-on to the stockpile by now, so pull, not speed)
  check(Math.abs(pd.tilt - tilt1) > 0.2, 'gamepad: right stick works the bucket');
  await padSet([0, 0, 0, 0], { 1: 1 }); await frame(300);
  check(await page.evaluate(() => m.controls.park.value > 0.5), 'gamepad: B sets the park brake');
  await padSet([0, 0, 0, 0], {}); await frame(100); await padSet([0, 0, 0, 0], { 1: 1 }); await frame(300);
  // LB held: the right stick looks round and leaves the bucket alone
  await padSet([0, 0, 0, 0], {}); await frame(100);
  const lk0 = await page.evaluate(() => ({ yaw: P.look.yaw, tilt: m.fn.bucket.pos }));
  await padSet([0, 0, 1, 0], { 4: 1 }); await frame(600);
  const lk1 = await page.evaluate(() => ({ yaw: P.look.yaw, tilt: m.fn.bucket.pos }));
  check(lk1.yaw < lk0.yaw - 0.3 && Math.abs(lk1.tilt - lk0.tilt) < 0.02, `gamepad: LB + right stick looks round without moving the bucket (yaw ${lk0.yaw.toFixed(2)} → ${lk1.yaw.toFixed(2)})`);
  await page.evaluate(() => { P.pad.fake = null; }); await frame(1500);

  // scripted dig and tip, fast-forwarded, driven through the override path
  await page.evaluate(() => { __game.paused = true; m.reset(5, 4, 0); m.controls.steer.set(0); m.controls.throttle.set(1); m.controls.shuttle.set(0); __game.sim(60); });
  const v0 = await page.evaluate(() => __game.audit());
  const ms = await page.evaluate(() => {
    const t0 = performance.now(); let steps = 0; const o = m.override;
    const run = (n, fn) => { __game.sim(n, fn); steps += n; };
    run(200, () => { o.boom = m.fn.boom.pos > -0.66 ? -1 : 0; o.bucket = m.fn.bucket.pos > 0.0 ? -1 : m.fn.bucket.pos < -0.03 ? 1 : 0; });
    o.boom = 0; o.bucket = 0; o.shuttle = 1; o.accel = 0.7;
    run(400, () => { if (m.payload() > 1.7) o.accel = 0; });
    window.dug = m.payload();
    o.accel = 0; o.bucket = 1; o.boom = 1; run(150);
    o.shuttle = -1; o.accel = 0.6; o.bucket = 0; run(200); o.accel = 0; run(60);
    window.carried = m.payload();
    return (performance.now() - t0) / steps;
  });
  await page.evaluate(() => { P.chase = true; __game.paused = false; }); await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/loader_carry.png' });
  await page.evaluate(() => { __game.paused = true; m.override.bucket = -1; __game.sim(480); m.override = {}; });
  const r = await page.evaluate(async () => ({ dug: dug, carried: carried, left: m.payload(), clods: __game.clods.count, a: await __game.audit(), ev: m.feel.counts }));
  console.log(`dig/tip: ${ms.toFixed(3)} ms/step, dug ${r.dug.toFixed(2)}, carried ${r.carried.toFixed(2)}, left ${r.left.toFixed(2)} m³`);
  check(r.dug > 1.2 && r.carried > r.dug * 0.7 && r.left < 0.1, 'loader digs, carries and tips');
  const drift = Math.abs(r.a.total - v0.total) / v0.total;
  check(drift < 1e-3, `volume conserved (${(drift * 100).toExponential(1)} %)`);
  check(r.ev.clunk > 3 && r.ev.clank > 0, `hydraulic clunks/clanks fired (${r.ev.clunk}/${r.ev.clank})`);
  const voice = await page.evaluate(async () => { P.bus.start(); await new Promise((r) => setTimeout(r, 600)); return { engine: !!m.voice.engine, ctx: P.bus.ctx?.state }; });
  check(voice.engine, `engine voice running in the shared audio context (${voice.ctx})`);
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
