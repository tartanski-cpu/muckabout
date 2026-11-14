// Screenshots of the loader and dozer biting into flat ground: the churned granules ahead of the edge and the heaped bucket.
// Usage: npm run build && node tools/digshots.mjs   → shots/dig_<machine>_<n>.png
import { harness } from '../tests/e2e/lib.mjs';
const { open, done } = await harness();
const page = await open('?worker=0&map=test&physics=custom', { viewport: { width: 900, height: 600 } });
await page.waitForFunction(() => __game.machines?.length);
await page.evaluate(() => { document.getElementById('help').style.display = 'none'; __game.hud.setVisible(false); document.querySelector('#VRButton')?.remove(); document.getElementById('status').style.display = 'none'; });
for (const id of ['loader', 'dozer']) {
  const info = await page.evaluate((id) => { const g = __game, m = g.machine(id);
    for (const o of g.machines) o.reset(o === m ? 10 : 60 + g.machines.indexOf(o) * 9, o === m ? 14 : 60, 0);
    g.play.stand(); g.sim(60); const o = m.override = { key: 1, park: 0, throttle: 1, start: true }; g.sim(40); o.start = false;
    for (let i = 0; i < 160; i++) { if (m.fn.boom) { o.boom = -1; o.bucket = m.fn.bucket.pos > 0 ? -1 : 0; } if (m.fn.lift) o.lift = -1; g.sim(1); }
    for (const k of ['boom', 'bucket', 'lift']) o[k] = 0;
    return { run: m.engine.running, z: m.position.z }; }, id);
  console.log(id, JSON.stringify(info));
  for (let n = 0; n < 3; n++) {
    const s = await page.evaluate((id) => { const g = __game, m = g.machine(id); const o = m.override; if (m.def.drive.type === 'tracks') { o.left = 0.8; o.right = 0.8; } else { o.shuttle = 1; o.accel = 0.8; } g.sim(70);
      const p = m.position; g.play.overview = { from: [p.x - 4.2, 2.6, p.z - 5.5], to: [p.x, 0.8, p.z - 2.5] }; return { z: p.z, payload: m.payload?.() ?? 0, dig: m.digRate, v: m.speed, mass: m.mass, lift: m.fn.lift?.pos, y: p.y, gnd: g.terrain.heightAt?.(p.x, p.z - 3) }; }, id);
    console.log(id, n, JSON.stringify(s));
    await page.waitForTimeout(700); await page.screenshot({ path: `shots/dig_${id}_${n}.png` });
  }
}
await done();
