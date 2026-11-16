// The PC seat (roadmap 0b): a player with a mouse works the cab's own controls, through real mouse events.
//   on foot, click a handrail → in the seat
//   grab the key and let go → engine on; drag the park lever forward → off; drag the shuttle forward → F
//   drag the loader joystick back → the boom rises; click a switch → it flips; drag the wheel round → it steers
//   anywhere else, dragging looks round
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?worker=0&physics=custom');
  await page.waitForFunction(() => typeof __game.machine === 'function' && __game.play?.mouse, null, { timeout: 60000 });
  // aim the seated camera at a control, as a player would by dragging, and return where it is on screen
  const aim = (name, machine = 'loader') => page.evaluate(([name, id]) => {
    const g = __game, S = g.play, m = g.machine(id), c = id === 'tools' ? S.tools[name] : m ? m.controls[name] : null; if (!c) return null;
    const THREE = g.THREE, cam = g.camera, p = new THREE.Vector3();
    (c.radius > 0 ? c.root.localToWorld(p.set(0, c.radius, 0)) : c.kind === 'press' ? c.pressPoint(p) : c.grabPoint(p));
    { g.rig.updateMatrixWorld(true); const l = g.rig.worldToLocal(p.clone()).sub(cam.position); S.look.yaw = Math.atan2(-l.x, -l.z); S.look.pitch = Math.atan2(l.y, Math.hypot(l.x, l.z)); }
    cam.rotation.set(S.look.pitch, S.look.yaw, 0, 'YXZ'); // as the next frame will have it
    cam.updateMatrixWorld(true);
    const v = p.clone().project(cam), el = g.renderer.domElement, r = el.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * el.clientWidth, r.top + (1 - v.y) / 2 * el.clientHeight];
  }, [name, machine]);
  const frames = (n = 6) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const ctl = (name) => page.evaluate((n) => { const v = __game.machine('loader').controls[n].value; return typeof v === 'object' ? { ...v } : v; }, name);
  const point = async (name) => { const at = await aim(name); await frames(2); await page.mouse.move(at[0], at[1]); await frames(4); return at; };
  const drag = async (name, dx, dy) => {
    const at = await point(name); await page.mouse.down(); await frames(3);
    for (let k = 1; k <= 8; k++) { await page.mouse.move(at[0] + dx * k / 8, at[1] + dy * k / 8); await frames(2); }
    return async () => { await page.mouse.up(); await frames(3); };
  };

  // on foot, beside the loader: click its handrail
  await page.evaluate(() => { const g = __game, m = g.machine('loader'), p = new g.THREE.Vector3(); m.controls.rail.root.getWorldPosition(p); g.play.player.place(p.x - 1.4, p.z, -Math.PI / 2); g.play.look.yaw = 0; g.play.look.pitch = -0.2; });
  await frames(30); // let the cab's controls come into view (their visibility follows the camera every 20 frames)
  await page.evaluate(() => { const g = __game, S = g.play, c = g.machine('loader').controls.rail, p = new g.THREE.Vector3(); c.root.getWorldPosition(p); const cam = g.camera; g.rig.updateMatrixWorld(true); const l = g.rig.worldToLocal(p.clone()).sub(cam.position); S.look.yaw = Math.atan2(-l.x, -l.z); S.look.pitch = Math.atan2(l.y, Math.hypot(l.x, l.z)); });
  await frames(4);
  const rail = await page.evaluate(() => { const g = __game, p = new g.THREE.Vector3(); g.machine('loader').controls.rail.root.getWorldPosition(p); g.camera.updateMatrixWorld(true); const v = p.project(g.camera), el = g.renderer.domElement, r = el.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * el.clientWidth, r.top + (1 - v.y) / 2 * el.clientHeight]; });
  await page.mouse.move(rail[0], rail[1]); await frames(4);
  await page.mouse.down(); await frames(4); await page.mouse.up(); await frames(4);
  check(await page.evaluate(() => __game.play.player.machine?.id === 'loader'), 'on foot, clicking a handrail climbs in');
  await frames(30);

  // key: grab and let go
  const r0 = await drag('key', 0, 0); await r0();
  check(await ctl('key') === 1, 'grabbing the key and letting go turns it on');
  // park brake: push the lever forward (drag up)
  const r1 = await drag('park', 0, -260); await r1();
  check(await ctl('park') === 0, 'dragging the park lever forward takes the brake off');
  const r2 = await drag('shuttle', 0, -260); await r2();
  check(await ctl('shuttle') === 1, 'dragging the shuttle forward puts it in F');
  const r2b = await drag('shuttle', 0, 130); await r2b();
  check(await ctl('shuttle') === 0, 'and back a notch to N');

  // loader joystick: pull back (drag down) and hold: the boom rises
  const b0 = await page.evaluate(() => __game.machine('loader').fn.boom.pos);
  const r3 = await drag('loader', 0, 160);
  const held = await ctl('loader');
  const b1 = await page.evaluate(() => __game.machine('loader').fn.boom.pos); await r3();
  check(held.y < -0.5 && b1 > b0 + 0.05, `pulling the loader joystick back raises the boom (stick ${held.y.toFixed(2)}, boom ${b0.toFixed(2)} → ${b1.toFixed(2)})`);
  check(Math.abs((await ctl('loader')).y) < 0.01, 'and it springs back to the middle when let go');

  // a switch: click
  const g0 = await ctl('range'); const at = await point('range'); await page.mouse.down(); await frames(3); await page.mouse.up(); await frames(3);
  check(await ctl('range') !== g0, 'clicking the travel-gear switch flips it');

  // wheel: grab the top of the rim and drag right
  const r4 = await drag('steer', 200, 60); const s1 = await ctl('steer'); await r4();
  check(s1 > 0.05, `dragging the top of the wheel to the right steers right (${s1.toFixed(2)})`);

  // dragging off the controls looks round instead
  await page.evaluate(() => { __game.play.look.yaw = 0; __game.play.look.pitch = 0.4; }); await frames(3); // up at the cab roof, nothing to take hold of
  const y0 = await page.evaluate(() => __game.play.look.yaw), el = await page.evaluate(() => { const r = __game.renderer.domElement.getBoundingClientRect(); return [r.left + r.width / 2, r.top + 40]; });
  await page.mouse.move(el[0], el[1]); await frames(3); await page.mouse.down(); await page.mouse.move(el[0] + 120, el[1], { steps: 6 }); await page.mouse.up(); await frames(2);
  check(Math.abs(await page.evaluate(() => __game.play.look.yaw) - y0) > 0.2, 'dragging where there is no control looks round');
  check(await page.evaluate(() => __game.play.input.fake.right === null || !__game.play.input.hands.right.holding), 'nothing is left held');

  // ---- on foot with a hand tool: click the shovel to carry it, look down and walk to dig, right button to throw, click to put down
  await page.evaluate(() => { const S = __game.play; S.stand(); const p = S.tools.shovel.grabPoint(new __game.THREE.Vector3()); S.player.place(p.x + 1.2, p.z + 0.4, 0); });
  await frames(20);
  const v0 = await page.evaluate(async () => (await __game.audit()).total);
  const sp = await aim('shovel', 'tools'); await frames(2); await page.mouse.move(sp[0], sp[1]); await frames(4);
  await page.mouse.down(); await frames(3); await page.mouse.up(); await frames(20);
  check(await page.evaluate(() => __game.play.tools.shovel.holders.length === 1 && __game.play.mouse.carry === __game.play.tools.shovel), 'on foot, clicking the shovel picks it up and it stays in the hand with the button let go');
  // dig: look well down so the blade is in the ground, and walk forward
  await page.evaluate(() => { const S = __game.play; S.look.yaw = 0; S.look.pitch = -0.8; }); await frames(10);
  await page.keyboard.down('KeyW'); await frames(90); await page.keyboard.up('KeyW');
  await page.evaluate(() => { __game.play.look.pitch = 0; }); await frames(10);
  const load = await page.evaluate(() => __game.play.tools.shovel.volume());
  check(load > 0.005, `looking down and walking forward digs a shovelful (${(load * 1000).toFixed(0)} litres)`);
  const mid = await page.evaluate(async () => (await __game.audit()).total);
  check(Math.abs(mid - v0) / v0 < 1e-6, 'and the soil on the shovel is in the volume audit');
  const c = await page.evaluate(() => { const r = __game.renderer.domElement.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await page.mouse.move(c[0], c[1]); await page.mouse.down({ button: 'right' }); await frames(10); await page.mouse.up({ button: 'right' }); await frames(5);
  check(await page.evaluate(() => __game.play.tools.shovel.volume()) === 0, 'the right button throws the soil off');
  // a drag with a tool in hand looks round and keeps it
  const yy = await page.evaluate(() => __game.play.look.yaw);
  await page.mouse.down(); await page.mouse.move(c[0] + 150, c[1], { steps: 6 }); await page.mouse.up(); await frames(5);
  check(await page.evaluate(() => __game.play.tools.shovel.holders.length === 1) && Math.abs(await page.evaluate(() => __game.play.look.yaw) - yy) > 0.2, 'dragging with it in hand looks round, and keeps hold of it');
  await page.mouse.move(c[0] + 150, c[1]); await page.mouse.down(); await frames(2); await page.mouse.up(); await frames(10);
  check(await page.evaluate(() => !__game.play.tools.shovel.held && !__game.play.mouse.carry), 'a click puts it down');
  await frames(120);
  const end = await page.evaluate(async () => (await __game.audit()).total);
  check(Math.abs(end - v0) / v0 < 1e-6, `volume conserved after digging and throwing with the mouse (${((end - v0) * 1000).toFixed(2)} litres adrift)`);

  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
  void at;
} finally { await done(); }
