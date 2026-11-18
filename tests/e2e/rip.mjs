// Rock (valley-layout item 4): in the old quarry, a dozer's blade will not cut the rock floor; its ripper breaks it into
// shot rock, which the loader then digs. Driven through the machines' own inputs; the volume audit holds throughout.
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?map=valley&worker=0');
  await page.waitForFunction(() => __game.machines?.length === 4 && __game.terrain.water, null, { timeout: 240000, polling: 300 });
  await page.evaluate(() => { __game.paused = true; });
  const v0 = await page.evaluate(async () => (await __game.audit()).total);
  const mat = (x, z) => page.evaluate(([x, z]) => __game.terrain.materialAt(x, z), [x, z]);
  check(await mat(-83, -98) === 6, 'the quarry floor is solid rock');

  // the blade, pressed onto the rock and pushed across it
  const blade = await page.evaluate(() => {
    const g = __game, D = g.machine('dozer'), T = g.terrain, h0 = T.heightAt(-83, -100);
    D.reset(-83, -92, 0); g.sim(30); D.override = { key: 1, park: 0, throttle: 1 }; g.sim(90);
    D.override.lift = -1; g.sim(120); D.override.lift = 0; D.override.left = D.override.right = 0.6; g.sim(360); D.override.left = D.override.right = 0; g.sim(30);
    return { h0, h1: T.heightAt(-83, -100), z: D.position.z, mat: T.materialAt(-83, -100) };
  });
  check(blade.mat === 6 && Math.abs(blade.h1 - blade.h0) < 0.02, `the blade takes nothing from the rock (floor ${blade.h0.toFixed(2)} → ${blade.h1.toFixed(2)} m)`);

  // the ripper: raise the blade, lower the tooth, drive across; three passes side by side, as on a real job
  const rip = await page.evaluate(() => {
    const g = __game, D = g.machine('dozer'), T = g.terrain, C = T.core; let moved = 0;
    for (const x of [-89.2, -88, -86.8]) {
      D.reset(x, -91, 0); g.sim(30); D.override = { key: 1, park: 0, throttle: 1, lift: 1 }; g.sim(120); D.override.lift = 0; // facing north, blade up
      D.override.rip = 1; g.sim(240); D.override.rip = 0;                                       // tooth down, trailing behind
      const z0 = D.position.z; D.override.left = D.override.right = 0.5; g.sim(600); D.override.left = D.override.right = 0; moved += Math.abs(D.position.z - z0);
      D.override.rip = -1; g.sim(200); D.override.rip = 0;                                      // tooth up
    }
    let shot = 0, n = 0, deep = 0; for (let z = -98; z <= -91; z += 0.5) for (let x = -89.5; x <= -86.5; x += 0.5) { n++; const c = C.cellAt(x, z); if (C.topMat(c) === 9) { shot++; deep = Math.max(deep, C.softAbove(c)); } }
    return { shot, n, deep, moved };
  });
  check(rip.shot > rip.n * 0.7 && rip.deep > 0.25, `ripped: shot rock across a 3 m strip (${rip.shot} of ${rip.n} points), broken up to ${rip.deep.toFixed(2)} m deep (${(rip.moved / 3).toFixed(1)} m a pass)`);

  // the loader digs the shot rock
  const dig = await page.evaluate(() => {
    const g = __game, L = g.machine('loader'), D = g.machine('dozer'), { Script, startUp, driveTo, halt, setFn } = g.autopilot; D.reset(-75, -78, 0);
    L.reset(-88, -84.5, 0); g.sim(30);
    // the autopilot's loader moves (game/autopilot.js loaderCycle): bucket down and level, drive in, curl and lift
    const s = new Script(L, [startUp, (m) => { halt(m); const a = setFn(m, 'boom', -0.68, 0.02), b = setFn(m, 'bucket', -0.02, 0.03); return a && b; },
      (m, t) => { driveTo(m, -88, -100, { speed: 1.6 }); m.override.brake = 0; m.override.boom = 0; m.override.bucket = 0; return m.payload() > 1.2 || t > 9; },
      (m, t) => { halt(m); setFn(m, 'bucket', 0.6); setFn(m, 'boom', -0.2); return t > 1.2; }], { timeout: 20 });
    let n = 0; while (!s.done && n++ < 60 * 40) g.sim(1, () => s.step(1 / 60));
    const b = L.containers.bucket.field; let shot = 0; for (let k = 0; k < b.fill.length; k++) if (b.mat[k] === 9) shot += b.fill[k] * b.cs * b.cs;
    return { load: L.payload(), shot, z: L.position.z };
  });
  check(dig.shot > 0.05, `the loader digs the ripped rock (${dig.shot.toFixed(2)} m³ of shot rock in the bucket, ${dig.load.toFixed(2)} m³ in all)`);
  await page.evaluate(() => { __game.sim(300); });
  const v1 = await page.evaluate(async () => (await __game.audit()).total);
  check(Math.abs(v1 - v0) / v0 < 1e-3, `volume conserved through blade, ripper and bucket (${((v1 - v0) / v0 * 100).toExponential(1)} %)`);
  await page.evaluate(() => { const D = __game.machine('dozer'); __game.play.overview = { from: [-60, 18, -88], to: [-78, 10, -100] }; __game.paused = false; void D; });
  await page.waitForTimeout(2500); await page.screenshot({ path: 'shots/rip.png' });
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
