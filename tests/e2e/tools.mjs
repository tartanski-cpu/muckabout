// Hand tools: the shovel digs and throws soil (volume conserved), the grading line reads the ground, and the tow
// chain lets one machine drag another. Driven with fake hands on the desktop page.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?worker=0&map=test');
  await page.waitForFunction(() => __game.machines?.length && __game.play?.tools);
  await page.evaluate(() => { const g = __game; g.renderer.setAnimationLoop(null); g.paused = false; window.P = g.play; window.V = g.THREE.Vector3; window.Q = g.THREE.Quaternion; window.E = g.THREE.Euler;
    window.hold = (side, x, y, z, grip, extra = {}) => P.input.setFake(side, { pos: new V(x, y, z), grip, ...extra });
    window.frames = (n) => { for (let i = 0; i < n; i++) g.loop(1 / 60); }; });
  const frames = (n) => page.evaluate((n) => frames(n), n);
  const v0 = await page.evaluate(() => __game.audit());

  // ---- shovel: take hold, push the blade through the ground, lift, turn it over
  const sh = await page.evaluate(() => { const s = P.tools.shovel, p = s.grabPoint(new V()); return [p.x, p.y, p.z]; });
  await page.evaluate(([x, y, z]) => hold('right', x, y, z, true), sh); await frames(3);
  check(await page.evaluate(() => P.tools.shovel.held), 'shovel: a grip takes hold of it');
  // blade forward and down: hand at waist height, the shaft dips 0.5 rad, so the blade bites about 1.2 m ahead
  const dig = await page.evaluate(() => { const g = __game, t = g.terrain, x = 2, z = 12, y0 = t.heightAt(x, z - 1.2);
    for (let i = 0; i < 90; i++) { hold('right', x, y0 + 0.62 - Math.min(0.2, i * 0.01), z - i * 0.006, true); frames(1); }
    const load = P.tools.shovel.volume(); for (let i = 0; i < 20; i++) { hold('right', x, y0 + 1.1, z - 0.6, true); frames(1); }
    return { load, held: P.tools.shovel.volume(), heap: P.tools.shovel.heap.visible, cut: y0 - t.heightAt(x, z - 1.5) }; });
  check(dig.load > 0.01 && dig.heap, `shovel: pushed into the ground it takes soil (${(dig.load * 1000).toFixed(0)} litres on the blade)`);
  check(Math.abs(dig.held - dig.load) < 1e-9, 'shovel: the soil stays on the blade when lifted');
  const mid = await page.evaluate(() => __game.audit());
  check(Math.abs(mid.total - v0.total) / v0.total < 1e-6 && mid.extra > 0.01, `shovel: its load is counted in the audit (${(mid.extra * 1000).toFixed(0)} litres)`);
  await page.evaluate(() => { for (let i = 0; i < 10; i++) { hold('right', 2, 1.1, 11.4, true, { quat: new Q().setFromEuler(new E(0, 0, Math.PI)) }); frames(1); } }); // turned over
  const thrown = await page.evaluate(() => ({ load: P.tools.shovel.volume(), clods: __game.clods.count })); await frames(150);
  check(thrown.load === 0 && thrown.clods > 0, `shovel: turned over, the soil falls off as clods (${thrown.clods})`);
  const end = await page.evaluate(() => __game.audit());
  check(Math.abs(end.total - v0.total) / v0.total < 1e-6, `shovel: volume conserved after digging and throwing (${((end.total - v0.total) * 1000).toFixed(2)} litres adrift)`);
  await page.evaluate(() => hold('right', 2, 1.1, 11.4, false)); await frames(3);
  check(await page.evaluate(() => !P.tools.shovel.held && Math.abs(P.tools.shovel.root.position.y - __game.terrain.heightAt(P.tools.shovel.root.position.x, P.tools.shovel.root.position.z)) < 1.5), 'shovel: let go, it stands in the ground');

  // ---- grading stakes: plant one on flat ground and one up the sand heap; the droppers read high on the heap
  const line = await page.evaluate(() => { const [a, b] = P.tools.stakes, t = __game.terrain;
    const carry = (s, x, z) => { const p = s.grabPoint(new V()); hold('left', p.x, p.y, p.z, true); frames(2); hold('left', x, t.heightAt(x, z) + 0.9, z, true); frames(2); hold('left', x, t.heightAt(x, z) + 0.9, z, false); frames(2); };
    carry(a, 14, 2); carry(b, 5, -6); frames(20);
    return { a: a.root.position.toArray(), ga: t.heightAt(14, 2), b: b.root.position.toArray(), gb: t.heightAt(5, -6), rep: { ...P.tools.line.report }, shown: P.tools.line.line.visible }; });
  check(Math.abs(line.a[1] - line.ga) < 0.02 && Math.abs(line.b[1] - line.gb) < 0.02, 'stakes: let go, each plants itself upright on the ground');
  check(line.shown && line.rep.length > 10 && line.rep.high > 3 && line.rep.onGrade > 3, `grading line: ${line.rep.length.toFixed(1)} m, droppers read ${line.rep.onGrade} on grade and ${line.rep.high} high (the sand heap)`);

  // ---- tow chain: hook the loader's back to the dozer's front; the loader drives off and drags the dozer, engine off, park brake released
  const tow = await page.evaluate(() => { const g = __game, L = g.machine('loader'), D = g.machine('dozer'), [h1, h2] = P.tools.hooks;
    L.reset(-4, 8, 0); D.reset(-4, 15.5, 0); g.sim(60);
    const hitch = (m, i) => { const h = m._hitches || (h1.root.position.set(0, 0, 0), null); return h; };
    const put = (hook, m, front) => { const p = hook.grabPoint(new V()); hold('left', p.x, p.y, p.z, true); frames(2);
      const b = m.bodyList[front ? 0 : m.bodyList.length - 1].obj, w = new V(0, 0.9, front ? -99 : 99); let best = null;                    // find that end of the machine
      for (const body of m.bodyList) { const c = body.def.colliders[0], z = front ? c.pos[2] - c.size[2] / 2 - 0.15 : c.pos[2] + c.size[2] / 2 + 0.15; if (!best || (front ? z < best.z : z > best.z)) best = { z, body }; }
      const q = best.body.obj.localToWorld(new V(0, 0.9, best.z)); hold('left', q.x, q.y, q.z, true); frames(2); hold('left', q.x, q.y, q.z, false); frames(2); };
    put(h1, L, false); put(h2, D, true);
    const hooked = !!h1.hitch && !!h2.hitch && h1.hitch.machine === L && h2.hitch.machine === D, z0 = D.position.z, gap0 = h1.root.position.distanceTo(h2.root.position);
    D.override = { park: 0 }; L.override = { key: 1, park: 0, throttle: 1 }; g.sim(120); L.override.shuttle = 1; L.override.accel = 1; let pull = 0;
    for (let i = 0; i < 420; i++) { g.sim(1); pull = Math.max(pull, P.tools.chain.pull); }
    return { hooked, gap0, moved: z0 - D.position.z, loader: 8 - L.position.z, pull, gap: h1.root.position.distanceTo(h2.root.position), dRun: D.engine.running }; });
  check(tow.hooked, `tow chain: each hook let go at the end of a machine hitches there (${tow.gap0.toFixed(1)} m apart)`);
  check(tow.pull > 20000 && tow.moved > 2 && !tow.dRun, `tow chain: the loader drags the dozer ${tow.moved.toFixed(1)} m with its engine off (peak pull ${(tow.pull / 1000).toFixed(0)} kN)`);
  check(tow.gap < 7.6, `tow chain: it holds at its length (${tow.gap.toFixed(2)} m between hooks)`);
  // ---- smooth drawing between simulation steps: the drawn pose lies between the last two simulated ones, and the true one comes back
  const sm = await page.evaluate(() => { const g = __game, L = g.machine('loader'), o = L.bodyList[0].obj; g.sim(30);
    const p1 = o.position.clone(), s = o.userData.smooth, step = s.p0.distanceTo(s.p1); g._blendPoses(0.25);
    const drawn = o.position.clone(), a = drawn.distanceTo(s.p0), b = drawn.distanceTo(s.p1); g._truePoses();
    return { step, a, b, back: o.position.distanceTo(p1) }; });
  check(sm.step > 0.01 && Math.abs(sm.a - sm.step * 0.25) < 1e-4 && Math.abs(sm.b - sm.step * 0.75) < 1e-4, `smooth drawing: a quarter of the way into a step, the loader is drawn a quarter of the way along it (${(sm.a * 1000).toFixed(1)} of ${(sm.step * 1000).toFixed(1)} mm)`);
  check(sm.back === 0, 'smooth drawing: the true pose is put back before the simulation runs again');
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
