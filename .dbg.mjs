import { harness } from './tests/e2e/lib.mjs';
const { open, done } = await harness();
const page = await open('?worker=0&scene=play&map=test');
await page.waitForFunction(() => __game.machines?.length >= 3);
const out = await page.evaluate(() => {
  const g = __game, { Script, loaderCycle } = g.autopilot, L = g.machine('loader'), D = g.machine('dumper'); g.paused = true;
  D.reset(-1.95, 4.4, 2.19); L.reset(5, 6, 0); g.sim(60); // dumper angled so the loader's swing from the heap meets the bed side square-on
  const ls = new Script(L, loaderCycle({ from: [5, 3], dig: [5, -6], stage: [5, 12], target: D.containers.bed }), { loop: true }); ls.log = [];
  let n = 0; const V = g.THREE.Vector3; while (ls.cycles < 2 && n < 60 * 200) { g.sim(1, () => ls.step(1 / 60)); n++;
    if (ls.i === 6 && n % 40 === 0 && ls.t < 16) { const b = L.containers.bucket.obj.getWorldPosition(new V()); D.containers.bed.obj.worldToLocal(b);
      ls.log.push(`  t ${ls.t.toFixed(1)} pos ${L.position.x.toFixed(1)},${L.position.z.toFixed(1)} hdg ${L.heading.toFixed(2)} joint ${L.joints[0].target.toFixed(2)} v ${L.speed.toFixed(1)} boom ${L.fn.boom.pos.toFixed(2)} bucketInBed x ${b.x.toFixed(1)} z ${b.z.toFixed(1)} dumper ${D.position.x.toFixed(1)},${D.position.z.toFixed(1)}`); } }
  const c = D.containers.bed.obj.getWorldPosition(new g.THREE.Vector3());
  ls.log.push(`bed centre ${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)} bed ${D.payload('bed').toFixed(2)} dumper at ${D.position.x.toFixed(1)},${D.position.z.toFixed(1)} hdg ${D.heading.toFixed(2)}`);
  return ls.log;
});
console.log(out.join('\n'));
await done();
