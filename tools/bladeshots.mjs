// Screenshots of the dozer driving into a standing ridge of pushed soil, and digging down with the blade held down.
// Usage: npm run build && node tools/bladeshots.mjs [tag]   → shots/<tag>_pile_<n>.png, shots/<tag>_deep_<n>.png (tag: before)
import { harness } from '../tests/e2e/lib.mjs';
const { open, done } = await harness(), TAG = process.argv[2] || 'before';
for (const which of ['pile', 'deep']) {
  const page = await open('?worker=0&map=test&physics=custom', { viewport: { width: 900, height: 600 } });
  await page.waitForFunction(() => __game.machines?.length);
  await page.evaluate((which) => { document.getElementById('help').style.display = 'none'; __game.hud.setVisible(false); document.querySelector('#VRButton')?.remove(); document.getElementById('status').style.display = 'none';
    const g = __game, m = g.machine('dozer'), core = g.terrain.core;
    for (const o of g.machines) o.reset(o === m ? 15 : 60 + g.machines.indexOf(o) * 9, o === m ? 18 : 60, 0);
    if (which === 'pile') { const z0 = 8, H = 1.7, s = Math.tan(36 * Math.PI / 180);
      for (let x = 9; x <= 21; x += 0.25) for (let z = 2; z <= 14; z += 0.25) { const h = Math.min(H, H - (Math.abs(z - z0) - 0.6) * s, H - (Math.abs(x - 15) - 3.5) * s); if (h <= 0) continue; const c = core.cellAt(x, z); core.addTop(c, 1, h); core.dist[c] = 255; core.wake(c); } }
    g.play.stand(); g.sim(60); const o = m.override = { key: 1, park: 0, throttle: 1, start: true }; g.sim(40); o.start = false;
    for (let i = 0; i < (which === 'pile' ? 40 : 110); i++) { o.lift = -1; g.sim(1); } o.lift = 0; }, which);
  const plan = which === 'pile' ? [150, 40, 40, 40, 60] : [70, 70, 90, 120];
  for (let n = 0; n < plan.length; n++) {
    const s = await page.evaluate(([which, k]) => { const g = __game, m = g.machine('dozer'), o = m.override; o.left = 0.8; o.right = 0.8; if (which === 'deep') o.lift = -1;
      for (let i = 0; i < k; i++) g.sim(1);
      const p = m.position; g.play.overview = which === 'pile' ? { from: [p.x - 5.5, 3.2, p.z - 6.5], to: [p.x, 0.6, p.z - 3] } : { from: [p.x - 6.5, 4.5, p.z - 4.5], to: [p.x, -0.5, p.z - 1.5] };
      return { z: p.z.toFixed(2), y: p.y.toFixed(2), v: m.speed.toFixed(2) }; }, [which, plan[n]]);
    console.log(which, n, JSON.stringify(s));
    await page.waitForTimeout(900); await page.screenshot({ path: `shots/${TAG}_${which}_${n}.png` });
  }
  await page.close();
}
await done();
