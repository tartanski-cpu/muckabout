// Chapter 1: a scripted dozer levels the site-office pad to its design, and the job is signed off.
// The driver works the dozer only through its inputs, as a player would: lower the blade to the pad's level, switch
// AUTO LEVEL on, push across the pad and off its far side; lift, back up, step over a blade's width, and again.
import { harness } from './lib.mjs';

const { open, check, done, browser } = await harness();
try {
  const context = await browser.newContext(); // shared storage: the save is read back in a second page
  let page = await open('?worker=0&save=1&new=1', { context });
  await page.waitForFunction(() => __game.play?.padJob && __game.machine('dozer') && __game.save, null, { timeout: 60000 });
  await page.evaluate(() => { __game.paused = true; });
  const v0 = await page.evaluate(async () => (await __game.audit()).total);
  const start = await page.evaluate(() => { const J = __game.play.padJob; J.update(1); return { ...J.live, y: J.design.y }; });
  check(start.within < 0.5 && start.cut > 3 && start.fill > 1, `the pad starts rough: ${(start.within * 100).toFixed(0)} % on grade, ${start.cut.toFixed(1)} m³ to cut, ${start.fill.toFixed(1)} m³ to fill (level ${start.y.toFixed(2)} m)`);
  // the grading stakes read the ground against the design: one on the heap, one in the hollow, one off the pad
  const tags = await page.evaluate(() => { const g = __game, P = g.play, T = g.terrain, [a, b] = P.tools.stakes, d = P.padJob.design;
    const read = (x, z) => { a.root.position.set(x, T.heightAt(x, z), z); P.tools.tagT = 0; P.tools.update(0.01); return P.tools.tags[0].text; };
    const r = { heap: read(d.x - 2.2, d.z), hollow: read(d.x + 3, d.z + 1), flat: read(d.x + 1, d.z - 2.6), off: read(d.x, d.z - 6) };
    b.root.position.set(d.x - 2.2, T.heightAt(d.x - 2.2, d.z), d.z); return r; });
  check(/^CUT \d+/.test(tags.heap) && /^FILL \d+/.test(tags.hollow) && /ON GRADE|CUT|FILL/.test(tags.flat) && / m$/.test(tags.off), `a stake reads the ground against the design: heap "${tags.heap}", hollow "${tags.hollow}", flat "${tags.flat}", off the pad "${tags.off}"`);
  await page.evaluate(() => { __game.play.overview = { from: [10, 20, -24], to: [10, 8, -35] }; __game.paused = false; });
  await page.waitForTimeout(1500); await page.screenshot({ path: 'shots/grade_before.png' }); await page.evaluate(() => { __game.paused = true; });

  const run = await page.evaluate(() => {
    const g = __game, D = g.machine('dozer'), J = g.play.padJob, d = J.design, { driveTo, halt, setFn } = g.autopilot, o = D.override;
    const T = D.tools.find((t) => t.def.name === 'blade'), C = T.def.corners;
    const edge = () => { const e = T.node.matrixWorld.elements, y = (c) => e[1] * c[0] + e[5] * c[1] + e[9] * c[2] + e[13]; return (y(C[2]) + y(C[3])) / 2; };
    const sim1 = () => { g.sim(1); J.update(1 / 60); }; // the job is watched as the game watches it, every step
    const step = (n, fn) => { for (let i = 0; i < n; i++) { fn(); sim1(); } };
    const x0 = d.x - d.w / 2 - 2.5, x1 = d.x + d.w / 2 + 2.5, rows = [], log = [];
    for (let z = d.z - d.d / 2 + 1.2; z <= d.z + d.d / 2 - 1.1; z += 1.2) rows.push(z);   // blade 3.4 m wide: rows 1.2 m apart overlap well
    // the backhoe is parked beside the pad, close enough that the first row clipped it and shoved it a metre or more into
    // the next rows (by how much varied from run to run): the job is the dozer's, so park the others well clear of it
    for (const m of g.machines) if (m !== D) m.reset(m.position.x, m.position.z - 8, m.heading);
    D.reset(x0, rows[0], -Math.PI / 2);
    Object.assign(o, { key: 1, park: 0, throttle: 1 }); step(90, () => {}); log.push(`start at ${D.position.x.toFixed(1)},${D.position.z.toFixed(1)} running ${D.engine.running} edge ${(edge() - d.y).toFixed(2)}`);
    for (const pass of [0, 1]) for (const z of rows) {
      // to the start of the row, blade up, then square to it
      o.grade = 0; o.brake = 0; step(600, () => { setFn(D, 'lift', 0.3); return driveTo(D, x0 - 1.5, z, { speed: 2, reverse: D.position.x > x0 }); });
      o.brake = 0; let t = 0; while (t++ < 400 && driveTo(D, x0, z, { speed: 1 }) > 0.4) { setFn(D, 'lift', 0.3); sim1(); }
      halt(D); step(30, () => {});
      // blade down to the pad's level, then auto level holds it there
      t = 0; while (t++ < 300) { const e = edge() - d.y; o.lift = Math.abs(e) < 0.01 ? 0 : -Math.sign(e) * Math.min(1, Math.abs(e) * 6 + 0.15); sim1(); if (Math.abs(e) < 0.01) break; }
      o.lift = 0; o.grade = 1; o.brake = 0; step(10, () => {});
      // push across and off the far side
      t = 0; while (t++ < 1800 && driveTo(D, x1, z, { speed: 1.2 }) > 0.5) { o.lift = 0; sim1(); }
      halt(D); o.grade = 0; step(30, () => {});
      log.push(`pass ${pass} row ${z.toFixed(1)}: ${(J.live.within * 100).toFixed(0)} % (dozer at ${D.position.x.toFixed(1)},${D.position.z.toFixed(1)}, edge ${(edge() - d.y).toFixed(2)}, running ${D.engine.running}, lift ${D.fn.lift.pos.toFixed(2)})`);
    }
    // back off the pad, blade up, and wait for it to be signed off
    const early = J.done;
    o.brake = 0; step(400, () => { setFn(D, 'lift', 0.4); return driveTo(D, x1 + 3, rows[0] - 4, { speed: 2 }); }); halt(D);
    for (let k = 0; k < 600 && !J.done; k++) sim1();
    return { log, early, live: { ...J.live }, done: J.done, grade: J.grade, office: J.office.visible, collider: !!J.collider };
  });
  console.log('     ' + run.log.join('\n     '));
  check(run.live.within >= 0.9, `the dozer levels the pad: ${(run.live.within * 100).toFixed(1)} % within ±5 cm (worst ${(run.live.worst * 100).toFixed(0)} cm, ${run.live.cut.toFixed(2)} m³ still high, ${run.live.fill.toFixed(2)} m³ still low)`);
  check(!run.early, 'it is not signed off while the dozer is still on the pad');
  check(run.done && /[ABC]/.test(run.grade), `once the dozer is off the pad, the job is signed off: grade ${run.grade}`);
  check(run.office && run.collider, 'the site office stands on the pad, solid');
  await page.evaluate(() => { __game.paused = false; });
  await page.waitForTimeout(1500); await page.screenshot({ path: 'shots/grade_after.png' });
  const v1 = await page.evaluate(async () => { __game.paused = true; __game.sim(300); return (await __game.audit()).total; });
  check(Math.abs(v1 - v0) / v0 < 1e-3, `volume conserved through the grading (${((v1 - v0) / v0 * 100).toExponential(1)} %)`);
  const card = await page.evaluate(() => { const S = __game.play; S.board.t = 1; S.board.update(1); return S.board.current === S.checklist; });
  check(card, 'with the pad done, the clipboard turns over to the next job');
  // saved, and there next time
  const level = await page.evaluate(() => __game.play.padJob.design.y);
  check(await page.evaluate(() => __game.save.save()), 'the site saves');
  await page.close();
  page = await open('?worker=0&save=1', { context });
  await page.waitForFunction(() => __game.play?.padJob && __game.save?.savedAt > 0, null, { timeout: 60000 });
  const back = await page.evaluate(() => { const J = __game.play.padJob; return { done: J.done, grade: J.grade, y: J.design.y, office: J.office.visible, collider: !!J.collider, overlay: __game.ground.material.uniforms.uDOn.value }; });
  check(back.done && back.grade === run.grade && back.y === level && back.office && back.collider && back.overlay === 0, `next visit: the pad is still done (grade ${back.grade}), the office still on it, and no design drawn`);
  await page.evaluate(() => __game.save.forget());
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
