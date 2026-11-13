// M4: backhoe in the browser: swivel the seat with the cab toggle, plant the legs, dig a trench with the scripted driver.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?worker=0&scene=play&map=test');
  await page.waitForFunction(() => __game.machines?.length >= 4);
  await page.evaluate(() => { __game.paused = true; });
  const v0 = await page.evaluate(() => __game.audit());
  const r = await page.evaluate(() => {
    const g = __game, { Script, backhoeCycle } = g.autopilot, m = g.machine('backhoe'); window.m = m;
    g.play.sit(m);
    m.controls.swivel.press(null);                       // the cab toggle, as a hand would poke it
    g.sim(120);
    const eyeFwd = new g.THREE.Vector3(0, 0, -1).applyQuaternion(g.rig.getWorldQuaternion(new g.THREE.Quaternion()));
    const bodyFwd = new g.THREE.Vector3(0, 0, -1).applyQuaternion(m.bodyList[0].obj.quaternion);
    const s = new Script(m, backhoeCycle(), { loop: true }); let n = 0, peak = 0;
    while (s.cycles < 6 && n++ < 60 * 300) { g.sim(1, () => s.step(1 / 60)); peak = Math.max(peak, m.payload('hoe')); }
    m.override = {}; g.sim(120);
    const z0 = m.position.z, x0 = m.position.x; let depth = 0;
    for (let d = 2.5; d < 6; d += 0.25) depth = Math.max(depth, g.terrain.heightAt(x0 - 4, z0 + d) - g.terrain.heightAt(x0, z0 + d));
    return { swivelled: eyeFwd.dot(bodyFwd), cycles: s.cycles, peak, depth, legs: m.contacts[0].N + m.contacts[1].N, rear: m.wheels[0].N + m.wheels[1].N, up: m.bodyList[0].obj.matrixWorld.elements[5] };
  });
  check(r.swivelled < -0.99, 'seat swivel toggle turns the player to face the rear controls');
  check(r.legs > 20000 && r.rear < 1000, 'stabiliser legs carry the back end');
  check(r.cycles === 6 && r.peak > 0.2 && r.depth > 0.35, `backhoe dug a trench (${r.depth.toFixed(2)} m deep, ${r.peak.toFixed(2)} m³ best bucketful)`);
  check(r.up > 0.97, 'still upright');
  await page.evaluate(() => { __game.play.chase = true; __game.play.look.yaw = 2.4; __game.paused = false; }); await page.waitForTimeout(700);
  await page.screenshot({ path: 'shots/m4_backhoe.png' });
  const a = await page.evaluate(() => { __game.paused = true; __game.sim(200); return __game.audit(); });
  const drift = Math.abs(a.total - v0.total) / v0.total;
  check(drift < 1e-3, `volume conserved (${(drift * 100).toExponential(1)} %)`);
  const calls = await page.evaluate(() => __game.perf.snapshot().counters.find((c) => c.name === 'calls').value);
  check(calls <= 150, `draw calls within budget with four machines (${calls})`);
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
