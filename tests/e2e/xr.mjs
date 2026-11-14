// The real WebXR code path, against an emulated Quest 3 (Meta's IWER runtime): enter VR, walk, snap-turn, climb in by
// the handrail, recentre, work the key, park brake, wheel, joystick and trigger with emulated Touch controllers, get out.
// This cannot say how it feels, but it does run every line a headset would.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?worker=0&map=test', { init: async (p) => {
    await p.addInitScript({ path: 'node_modules/iwer/build/iwer.min.js' });
    await p.addInitScript(() => { const d = new IWER.XRDevice(IWER.metaQuest3); d.installRuntime({ forceInstall: true }); d.position.set(0, 1.6, 0); window.xrd = d; });
  } });
  await page.waitForFunction(() => __game.machines?.length);
  await page.click('#VRButton');
  await page.waitForFunction(() => __game.renderer.xr.isPresenting, null, { timeout: 20000 });
  const frames = async (n = 4, simMs = 0) => { const t = await page.evaluate(() => [__game.frame, __game.simTime]); await page.waitForFunction(([f, st, n, ms]) => __game.frame >= f + n && __game.simTime >= st + ms / 1000, [t[0], t[1], n, simMs], { timeout: 90000, polling: 30 }); };
  await page.evaluate(() => {
    const g = __game, V = g.THREE.Vector3; window.m = g.machine('loader'); window.P = g.play; window.V = V;
    // put an emulated controller at a world position: XR space is the rig's frame
    window.ctl = (side, world, buttons = {}) => { const c = xrd.controllers[side], p = g.rig.worldToLocal(world.clone()); c.position.set(p.x, p.y, p.z); for (const k in buttons) c.updateButtonValue(k, buttons[k]); };
    window.at = (name, lx = null, ly = 0, lz = 0) => (lx === null ? m.controls[name].grabPoint(new V()) : m.controls[name].root.localToWorld(new V(lx, ly, lz)));
    window.headWorld = () => g.camera.getWorldPosition(new V());
  });
  await frames(6);
  const st = await page.evaluate(() => ({ head: headWorld().toArray(), feet: P.player.feet.toArray(), l: P.input.hands.left.tracked, r: P.input.hands.right.tracked, glove: P.hands.h.right.root.visible, gd: P.hands.h.right.root.position.distanceTo(P.input.hands.right.pos), hud: __game.hud.mesh.parent.visible }));
  check(Math.abs(st.head[1] - st.feet[1] - 1.6) < 0.05, `standing in VR at real head height (${(st.head[1] - st.feet[1]).toFixed(2)} m above the ground)`);
  check(st.l && st.r && st.glove && st.gd < 0.01, 'both controllers tracked; gloves ride them');
  check(st.hud, 'perf HUD is on the left wrist');

  // walk forward and snap-turn
  const f0 = await page.evaluate(() => P.player.feet.toArray());
  await page.evaluate(() => xrd.controllers.left.updateAxes('thumbstick', 0, -0.7)); await frames(4, 800);
  await page.evaluate(() => xrd.controllers.left.updateAxes('thumbstick', 0, 0)); await frames(3);
  const f1 = await page.evaluate(() => ({ feet: P.player.feet.toArray(), yaw: P.player.yaw }));
  const walked = Math.hypot(f1.feet[0] - f0[0], f1.feet[2] - f0[2]);
  check(walked > 0.5 && f1.feet[2] < f0[2], `left stick walks forward (${walked.toFixed(2)} m)`);
  const head0 = await page.evaluate(() => headWorld().toArray());
  await page.evaluate(() => xrd.controllers.right.updateAxes('thumbstick', 1, 0)); await frames(3);
  await page.evaluate(() => xrd.controllers.right.updateAxes('thumbstick', 0, 0)); await frames(3);
  const turn = await page.evaluate(() => ({ yaw: P.player.yaw, head: headWorld().toArray() }));
  check(Math.abs(turn.yaw - f1.yaw + Math.PI / 6) < 0.01, 'right stick snap-turns 30° to the right');
  check(Math.hypot(turn.head[0] - head0[0], turn.head[2] - head0[2]) < 0.02, 'the turn pivots about the head, not the play-space origin');

  // climb in: right hand to the handrail, squeeze
  await page.evaluate(() => ctl('right', at('rail'))); await frames(3);
  await page.evaluate(() => ctl('right', at('rail'), { squeeze: 1 })); await frames(4);
  await page.evaluate(() => xrd.controllers.right.updateButtonValue('squeeze', 0)); await frames(3);
  const seat = await page.evaluate(() => ({ seated: P.player.machine === m, d: headWorld().distanceTo(m.seat.getWorldPosition(new V())), fwd: __game.camera.getWorldDirection(new V()).dot(new V(0, 0, -1).applyQuaternion(m.bodyList[0].obj.quaternion)) }));
  check(seat.seated, 'grabbing the handrail with an emulated controller seats the player');
  await page.evaluate(() => xrd.controllers.right.updateButtonValue('b-button', 1)); await frames(3);
  await page.evaluate(() => xrd.controllers.right.updateButtonValue('b-button', 0)); await frames(3);
  const rec = await page.evaluate(() => ({ d: headWorld().distanceTo(m.seat.getWorldPosition(new V())), fwd: __game.camera.getWorldDirection(new V()).dot(new V(0, 0, -1).applyQuaternion(m.bodyList[0].obj.quaternion)) }));
  check(rec.d < 0.03 && rec.fwd > 0.98, `B recentres: head on the seat eye point (${(rec.d * 100).toFixed(1)} cm off), facing forward`);

  // key, park brake, shuttle
  await page.evaluate(() => ctl('right', at('key'), { squeeze: 1 })); await frames(4);
  await page.evaluate(() => xrd.controllers.right.updateButtonValue('squeeze', 0)); await frames(4, 1300);
  check(await page.evaluate(() => m.engine.running), 'key starts the engine');
  await page.evaluate(() => ctl('right', at('park'), { squeeze: 1 })); await frames(4);
  await page.evaluate(() => { const c = m.controls.park, k = c.root.worldToLocal(at('park')); ctl('right', c.root.localToWorld(new V(k.x, k.y, k.z - 0.24))); }); await frames(4);
  await page.evaluate(() => xrd.controllers.right.updateButtonValue('squeeze', 0)); await frames(3);
  check(await page.evaluate(() => m.controls.park.value === 0), 'park brake lever pushes off');
  await page.evaluate(() => ctl('right', at('park', 0, 0.45, 0.2))); await frames(3);
  // thumbstick works the boom with nothing held
  const b0 = await page.evaluate(() => m.fn.boom.pos);
  await page.evaluate(() => xrd.controllers.right.updateAxes('thumbstick', 0, 1)); await frames(4, 700);
  await page.evaluate(() => xrd.controllers.right.updateAxes('thumbstick', 0, 0)); await frames(3);
  check(await page.evaluate((b0) => m.fn.boom.pos > b0 + 0.15, b0), 'right thumbstick pulled back raises the boom');
  await page.evaluate(() => ctl('left', at('shuttle'), { squeeze: 1 })); await frames(4);
  await page.evaluate(() => ctl('left', at('shuttle', 0, 0.16, -0.09), { squeeze: 1 })); await frames(4);
  await page.evaluate(() => xrd.controllers.left.updateButtonValue('squeeze', 0)); await frames(3);
  check(await page.evaluate(() => m.controls.shuttle.value === 1), 'shuttle lever goes to F');

  // drive: left hand on the wheel, right on the joystick with the trigger down
  await page.evaluate(() => ctl('left', at('steer', 0, 0.19, 0), { squeeze: 1 })); await frames(4);
  await page.evaluate(() => ctl('right', at('loader'), { squeeze: 1, trigger: 1 })); await frames(4);
  await page.evaluate(() => ctl('right', at('loader', 0, 0.16, 0.07))); await frames(4, 1500);
  const drive = await page.evaluate(() => ({ v: m.speed, boom: m.fn.boom.pos, head: headWorld().distanceTo(m.seat.getWorldPosition(new V())), glove: P.hands.h.left.root.position.distanceTo(at('steer', 0, 0.19, 0)), accel: m.inp.accel }));
  check(drive.v > 1 && drive.accel > 0.9, `right trigger drives while that hand holds the joystick (${drive.v.toFixed(1)} m/s)`);
  check(drive.boom > -0.2, 'joystick pulled back raises the boom');
  check(drive.head < 0.05 && drive.glove < 0.03, 'head stays on the seat and the glove on the wheel rim while the machine moves');
  await page.screenshot({ path: 'shots/xr_emulated.png' });
  await page.evaluate(() => { for (const s of ['left', 'right']) { xrd.controllers[s].updateButtonValue('squeeze', 0); xrd.controllers[s].updateButtonValue('trigger', 0); } }); await frames(4, 1500);
  // get out with Y
  await page.evaluate(() => xrd.controllers.left.updateButtonValue('y-button', 1)); await frames(3);
  await page.evaluate(() => xrd.controllers.left.updateButtonValue('y-button', 0)); await frames(3);
  const out = await page.evaluate(() => ({ seated: P.player.seated, h: headWorld().y - __game.terrain.heightAt(headWorld().x, headWorld().z), d: headWorld().distanceTo(m.position) }));
  check(!out.seated && Math.abs(out.h - 1.6) < 0.15 && out.d < 5, `Y gets out: standing beside the machine (${out.d.toFixed(1)} m away)`);
  await page.evaluate(() => xrd.controllers.left.updateButtonValue('x-button', 1)); await frames(3);
  check(await page.evaluate(() => !__game.hud.visible), 'X hides the perf HUD');
  check(page.errs.length === 0, 'no page errors in the VR session' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
