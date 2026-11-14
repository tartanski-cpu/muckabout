// Films the stress scene to shots/muckabout.mp4 at an exact 30 fps: the game is stepped one frame at a time with a
// fixed time step and each frame is screenshotted, so software rendering speed does not matter.
// Usage: npm run build && node tools/video.mjs      (needs ffmpeg on the PATH)
import { harness } from '../tests/e2e/lib.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const FPS = 30, DIR = 'shots/frames';
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const { open, done } = await harness();
const page = await open('?worker=0&stress=1&physics=rapier', { viewport: { width: 1280, height: 720 } });
await page.waitForFunction(() => __game.play?.stress);
await page.evaluate(() => {
  const g = __game; document.getElementById('help').style.display = 'none'; document.getElementById('status').style.display = 'none'; g.hud.setVisible(false); document.querySelector('#VRButton')?.remove();
  g.renderer.setAnimationLoop(null); g.paused = false;
  g.sim(60 * 14);                                   // let the scripted machines get going
  const V = g.THREE.Vector3; window.cam = { pos: new V(), look: new V() };
  // each shot: which machine part to watch, and where the camera sits relative to it (in the machine's own frame)
  window.shot = (name) => {
    const M = (id) => g.machine(id), w = (o, x, y, z) => o.localToWorld(new V(x, y, z));
    let look, pos;
    if (name === 'loader') { const m = M('loader'); look = m.nodes.bucket.getWorldPosition(new V()); pos = w(m.nodes.front, 6.5, 3.0, -6.0); }   // from the side away from the dumper it loads
    else if (name === 'dumper') { const m = M('dumper'); look = m.containers.bed.obj.getWorldPosition(new V()); pos = w(m.nodes.rear, 5.5, 3.2, 9.5); }
    else if (name === 'dozer') { const m = M('dozer'); look = m.nodes.blade.getWorldPosition(new V()); pos = w(m.nodes.chassis, -5, 2.4, -7); }
    else if (name === 'backhoe') { const m = M('backhoe'); look = m.nodes.hbucket.getWorldPosition(new V()); pos = w(m.nodes.chassis, 5.5, 3, 5.5); }
    else { look = new V(22, 10, -46); pos = new V(31, 12.5, -38); }      // the stockpile and its fountain of clods
    pos.y = Math.max(pos.y, g.terrain.heightAt(pos.x, pos.z) + 1.2);
    const k = cam.pos.lengthSq() ? 0.06 : 1; cam.pos.lerp(pos, k); cam.look.lerp(look, cam.pos.lengthSq() && k < 1 ? 0.15 : 1); // ease, so the camera follows rather than jitters
    g.play.overview = { from: cam.pos.toArray(), to: cam.look.toArray() };
  };
  window.cut = () => { cam.pos.set(0, 0, 0); };
});
const SHOTS = [['pile', 4], ['loader', 9], ['dumper', 5], ['dozer', 6], ['backhoe', 7], ['pile', 3]];
let n = 0;
for (const [name, secs] of SHOTS) {
  await page.evaluate(() => cut());
  if (name === 'pile' && n > 0) await page.evaluate(() => __game.play.setLighting('dusk'));   // end on the dusk lighting
  for (let f = 0; f < secs * FPS; f++, n++) {
    await page.evaluate(([name, dt]) => { shot(name); __game.loop(dt); }, [name, 1 / FPS]);
    await page.screenshot({ path: `${DIR}/f${String(n).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 88 });
  }
  console.log(name, 'done,', n, 'frames');
}
console.log('page errors:', page.errs.length);
await done();
const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${DIR}/f%05d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart', 'shots/muckabout.mp4'], { stdio: 'inherit' });
if (r.status === 0) rmSync(DIR, { recursive: true, force: true });
console.log(r.status === 0 ? 'wrote shots/muckabout.mp4' : 'ffmpeg failed');
