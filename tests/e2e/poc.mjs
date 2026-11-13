// Scripted headless run of the built game (port of the POC's test.py).
// Serves dist/, drives the loader through a dig-and-dump cycle with the
// fast-forward __game.sim() hook, then runs the clod stress mode, and checks:
//   - no page errors
//   - the loader actually dug and delivered soil to the truck
//   - total soil volume is conserved to within 0.1 %
// Usage: npm run build && npm run test:e2e   (screenshots land in shots/)
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const AUTOPILOT = `
(() => {
  const g = window.__game, v = g.veh;
  let phase = 'lower', t0 = 0;
  const steerTo = (tx, tz, rev) => {
    let tgt = Math.atan2(-(tx - v.x), -(tz - v.z)); if (rev) tgt += Math.PI;
    let d = tgt - v.psi; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI;
    return Math.max(-1, Math.min(1, d * 2.5)) * (rev ? -1 : 1);
  };
  window.__phase = () => phase;
  window.__ap = (inp, t) => {
    const go = (p) => { phase = p; t0 = t; };
    const el = t - t0;
    if (phase === 'lower') { inp.boom = v.alpha > -0.66 ? -1 : 0; inp.bucket = v.beta > 0 ? -0.5 : 0.3; if (el > 1.6) go('approach'); }
    else if (phase === 'approach') { inp.throttle = 0.55; v.steerCmd = steerTo(5, -8);
      if (g.fill > 1.6 || el > 9) go('curl'); }
    else if (phase === 'curl') { inp.bucket = 1; inp.boom = 0.6; inp.throttle = 0; if (el > 1.0) go('back'); }
    else if (phase === 'back') { inp.throttle = -0.6; v.steerCmd = 0; inp.boom = 0.3; if (el > 4.5) go('toTruck'); }
    // Speed-capped approach: follow the line x = -9.5 south so the loader noses in square to the truck's side.
    else if (phase === 'toTruck') { inp.throttle = v.v < (v.z > 6 ? 2.5 : 1.2) ? 0.5 : 0; v.steerCmd = steerTo(-9.5, v.z - 5); inp.boom = 1;
      if (v.z < 2.1 || el > 25) go('dump'); }
    else if (phase === 'dump') { inp.throttle = 0; v.steerCmd = v.gamma / 0.68; inp.boom = 1; inp.bucket = el > 1.2 ? -1 : 0; if (el > 4) go('done'); }
  };
})();
`;

const failures = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures.push(msg); };

mkdirSync('shots', { recursive: true });
const server = await preview({ preview: { port: 4179, strictPort: false }, logLevel: 'warn' });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e));
  await page.goto(url);
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'shots/0_cab.png' });

  // Freeze the realtime loop so only the fixed-dt sim() steps advance the world.
  await page.evaluate(() => __game.pause(true));
  const v0 = await page.evaluate(() => __game.volume());
  await page.evaluate(AUTOPILOT);
  await page.evaluate(() => __game.setChase(true));

  let peakFill = 0;
  for (let i = 1; i <= 20; i++) {
    const ms = await page.evaluate(() => { const t = performance.now(); __game.sim(180, __ap); return (performance.now() - t) / 180; });
    const st = await page.evaluate(() => ({ ph: __phase(), fill: __game.fill, bed: __game.bedVol, clods: __game.pCount }));
    peakFill = Math.max(peakFill, st.fill);
    console.log(String(i).padStart(2), ms.toFixed(3), 'ms/step', st.ph.padEnd(8), 'bucket', st.fill.toFixed(2), 'bed', st.bed.toFixed(2), 'clods', st.clods);
    if (i === 2 || i === 16) { await page.waitForTimeout(200); await page.screenshot({ path: `shots/${i}_chase.png` }); }
  }
  const v1 = await page.evaluate(() => __game.volume());
  check(peakFill > 1.0, `bucket filled (peak ${peakFill.toFixed(2)} m³)`);
  check(v1.bed > 0.5, `soil delivered to truck (${v1.bed.toFixed(2)} m³)`);
  const drift1 = Math.abs(v1.total - v0.total) / v0.total;
  check(drift1 < 1e-3, `volume conserved over dig/dump: ${v0.total.toFixed(3)} -> ${v1.total.toFixed(3)} m³ (${(drift1 * 100).toExponential(1)} %)`);

  // Stress mode: clod fountain at the full budget.
  await page.evaluate(() => __game.setStress(true));
  const stressMs = await page.evaluate(() => { const t = performance.now(); __game.sim(360); return (performance.now() - t) / 360; });
  const peakClods = await page.evaluate(() => __game.pCount);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/stress.png' });
  await page.evaluate(() => { __game.setStress(false); __game.sim(360); });
  const v2 = await page.evaluate(() => __game.volume());
  console.log('stress:', stressMs.toFixed(3), 'ms/step,', peakClods, 'clods');
  check(peakClods > 1200, `stress mode fills the clod budget (${peakClods})`);
  check(v2.airborne === 0, 'all clods landed after stress');
  const drift2 = Math.abs(v2.total - v0.total) / v0.total;
  check(drift2 < 1e-3, `volume conserved after stress: ${v2.total.toFixed(3)} m³ (${(drift2 * 100).toExponential(1)} %)`);

  // Hydraulic feel events fired during the cycle, and the engine voice renders real sound.
  const feel = await page.evaluate(() => __game.feel.counts);
  check(feel.clunk >= 4 && feel.clank >= 2, `hydraulic clunks and clanks fired (${feel.clunk} clunks, ${feel.clank} clanks)`);
  const idle = await page.evaluate(() => __game.renderEngine({ seconds: 1, rpm: 800, load: 0 }));
  const work = await page.evaluate(() => __game.renderEngine({ seconds: 1, rpm: 2000, load: 0.8 }));
  check(idle.finite && work.finite && idle.rms > 0.02 && work.peak <= 1, `engine voice renders (idle rms ${idle.rms.toFixed(3)}, working rms ${work.rms.toFixed(3)}, peak ${work.peak.toFixed(2)})`);
  check(work.rms > idle.rms * 1.2, 'engine is louder under load');
  await page.evaluate(() => { __game.startAudio(); __game.audio.clank(1); __game.audio.clunk(1); });
  await page.waitForTimeout(500);
  check(await page.evaluate(() => !!__game.audio.engine), 'live audio graph started with the diesel worklet');

  // Perf HUD is live.
  await page.evaluate(() => __game.pause(false));
  await page.waitForTimeout(800);
  const snap = await page.evaluate(() => __game.perf.snapshot());
  check(snap.fps > 0 && snap.timers.length === 7, `perf HUD reporting (${snap.fps.toFixed(0)} fps, render ${snap.timers.at(-1).avg.toFixed(2)} ms)`);
  await page.evaluate(() => __game.setChase(false));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/z_cab_end.png' });

  check(errs.length === 0, 'no page errors' + (errs.length ? ':\n  ' + errs.join('\n  ') : ''));
} finally {
  await browser.close();
  await server.close();
}
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
