// Standing height on foot (xr/player.js EYE), against an emulated Quest 3: a player sitting down in the real world
// stands at full height once out of the cab, and A on foot crouches them down near the ground and back up. A player
// really standing keeps their own height.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?worker=0&map=test', { init: async (p) => {
    await p.addInitScript({ path: 'node_modules/iwer/build/iwer.min.js' });
    await p.addInitScript(() => { const d = new IWER.XRDevice(IWER.metaQuest3); d.installRuntime({ forceInstall: true }); d.position.set(0, 1.15, 0); window.xrd = d; }); // sat on a sofa
  } });
  await page.waitForFunction(() => __game.machines?.length);
  await page.click('#VRButton');
  await page.waitForFunction(() => __game.renderer.xr.isPresenting, null, { timeout: 20000 });
  const frames = async (n = 4) => { const f = await page.evaluate(() => __game.frame); await page.waitForFunction(([f, n]) => __game.frame >= f + n, [f, n], { timeout: 90000, polling: 30 }); };
  const eye = () => page.evaluate(() => { const P = __game.play.player, p = __game.camera.getWorldPosition(new __game.THREE.Vector3()); return p.y - __game.terrain.heightAt(p.x, p.z); });
  const press = async (btn) => { await page.evaluate((b) => xrd.controllers.right.updateButtonValue(b, 1), btn); await frames(3); await page.evaluate((b) => xrd.controllers.right.updateButtonValue(b, 0), btn); await frames(3); };
  await frames(6);
  const e0 = await eye();
  check(Math.abs(e0 - 1.65) < 0.05, `sitting down in the room, on foot the eyes are at standing height (${e0.toFixed(2)} m above the ground, head 1.15 m above the floor)`);
  await press('a-button'); const e1 = await eye();
  check(Math.abs(e1 - 0.75) < 0.05 && await page.evaluate(() => __game.play.player.crouched), `A crouches down (${e1.toFixed(2)} m)`);
  await press('a-button'); const e2 = await eye();
  check(Math.abs(e2 - 1.65) < 0.05, `A again stands back up (${e2.toFixed(2)} m)`);
  // into the cab: the seat puts the head on its eye point; out again: standing height, even crouched before
  await press('a-button');
  await page.evaluate(() => __game.play.sit(__game.machine('loader'))); await frames(4);
  const seat = await page.evaluate(() => { const m = __game.machine('loader'); return __game.camera.getWorldPosition(new __game.THREE.Vector3()).distanceTo(m.seat.getWorldPosition(new __game.THREE.Vector3())); });
  await page.evaluate(() => __game.play.stand()); await frames(4); const e3 = await eye();
  check(seat < 0.05 && Math.abs(e3 - 1.65) < 0.05, `in the cab the head is on the seat's eye point (${(seat * 100).toFixed(1)} cm off); out of it, standing height again (${e3.toFixed(2)} m)`);
  // a player who stands up for real: B on foot takes their own height
  await page.evaluate(() => xrd.position.set(0, 1.78, 0)); await frames(3); await press('b-button'); const e4 = await eye();
  check(Math.abs(e4 - 1.78) < 0.05, `standing up for real, B on foot takes their own height (${e4.toFixed(2)} m)`);
  // the lift is the rig's alone: the ground under the feet is still where the ground is
  const feet = await page.evaluate(() => { const P = __game.play.player; return Math.abs(P.feet.y - __game.terrain.heightAt(P.feet.x, P.feet.z)); });
  check(feet < 0.05, 'the feet stay on the ground');
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
