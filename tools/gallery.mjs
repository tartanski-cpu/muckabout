// Screenshot gallery for art passes: each machine from front and rear three-quarters, and the view from its seat.
// Usage: npm run build && node tools/gallery.mjs [machine ...]   → shots/gallery_<machine>_<view>.png
import { harness } from '../tests/e2e/lib.mjs';
const want = process.argv.slice(2);
const { open, done } = await harness();
const page = await open('?worker=0&map=test&physics=custom', { viewport: { width: 900, height: 600 } });
await page.waitForFunction(() => __game.machines?.length);
await page.evaluate(() => { document.getElementById('help').style.display = 'none'; __game.hud.setVisible(false); document.querySelector('#VRButton')?.remove(); document.getElementById('status').style.display = 'none'; });
const ids = await page.evaluate(() => __game.machines.map((m) => m.id));
for (const id of ids.filter((i) => !want.length || want.includes(i))) {
  await page.evaluate((id) => { const g = __game, m = g.machine(id); for (const o of g.machines) o.reset(o === m ? 0 : 60 + g.machines.indexOf(o) * 9, o === m ? 12 : 60, 0); g.sim(30);
    if (m.fn.boom) { m.fn.boom.pos = -0.55; m.fn.bucket.pos = 0.05; } if (m.fn.lift) m.fn.lift.pos = -0.05; if (m.fn.hoeBoom) { m.fn.hoeBoom.pos = 0.7; m.fn.dipper.pos = 1.6; m.fn.hoeBucket.pos = 1.2; }
    m.poseNodes(); g.sim(2); g.play.stand(); }, id);
  for (const [view, from, to] of [['front', [-4.6, 3.4, 5.2], [0, 1.5, 10.6]], ['rear', [4.8, 3.6, 17.5], [0, 1.5, 11.6]], ['side', [-8, 2.0, 10.6], [0, 1.6, 10.6]]]) {
    await page.evaluate(([from, to]) => { __game.play.overview = { from, to }; }, [from, to]); await page.waitForTimeout(500);
    await page.screenshot({ path: `shots/gallery_${id}_${view}.png` });
  }
  await page.evaluate((id) => { const g = __game; g.play.overview = null; g.play.sit(g.machine(id)); g.play.look.pitch = -0.38; g.play.look.yaw = 0; }, id); await page.waitForTimeout(600);
  await page.screenshot({ path: `shots/gallery_${id}_cab.png` });
  await page.evaluate(() => __game.play.stand());
}
await done();
