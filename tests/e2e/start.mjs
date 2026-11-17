// The start page and the graphics tiers (roadmap 0b).
//   start page   shown first (?start=1 here; automation hides it otherwise), says plainly whether VR is on offer,
//                "Play on this computer" takes you into the game and Esc brings the menu back
//   graphics     quest draws no shadow maps; pc and ultra cast real sun shadows from the machines onto the ground, and
//                darken the ground behind a machine; switching changes nothing the simulation uses
import { harness } from './lib.mjs';

const { open, check, done } = await harness();
try {
  const page = await open('?worker=0&start=1&quality=quest&physics=custom');
  await page.waitForFunction(() => typeof __game.machine === 'function' && __game.quality, null, { timeout: 60000 });
  check(await page.isVisible('#start') && await page.isVisible('#playBtn'), 'the start page is the first thing on screen');
  await page.waitForFunction(() => document.getElementById('vrNote').textContent !== 'Looking for a headset…', null, { timeout: 10000 });
  const vr = await page.evaluate(() => ({ disabled: document.getElementById('vrBtn').disabled, note: document.getElementById('vrNote').textContent }));
  check(vr.disabled && /No VR|no VR/.test(vr.note), `without a headset, Enter VR is greyed out and it says why ("${vr.note}")`);
  check(await page.evaluate(() => document.getElementById('helpBody').textContent.includes('PC:')), 'the controls (PC, gamepad and Quest) are on it');
  await page.click('#playBtn');
  check(!(await page.isVisible('#start')) && await page.isVisible('#help'), '"Play on this computer" goes into the game, with a reminder of Esc in the corner');
  await page.keyboard.press('Escape');
  check(await page.isVisible('#start'), 'Esc brings the menu back');
  await page.keyboard.press('Escape');
  check(!(await page.isVisible('#start')), 'and Esc again goes back to the game');

  // ---- graphics tiers: the same view of the loader drawn at each, and the ground behind it compared
  const shot = (name) => page.evaluate(async (name) => {
    const g = __game, L = g.machine('loader'), T = g.THREE;
    g.quality.set(name); g.env.apply('golden'); // a low sun: a long shadow
    const p = L.position, sun = g.env.sunDir, h = Math.hypot(sun.x, sun.z), back = new T.Vector3(p.x - sun.x / h * 3, 0, p.z - sun.z / h * 3); back.y = g.terrain.heightAt(back.x, back.z); // ground on the far side of the loader from the sun
    g.play.overview = { from: [p.x + 9, p.y + 9, p.z + 9], to: [p.x, p.y, p.z] };
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
    const cam = g.camera; cam.updateMatrixWorld(true); const v = back.clone().project(cam), c = g.renderer.domElement;
    const px = Math.round((v.x + 1) / 2 * c.width), py = Math.round((1 - v.y) / 2 * c.height);
    const gl = g.renderer.getContext(), buf = new Uint8Array(4 * 25); g.renderer.render(g.scene, cam); gl.readPixels(px - 2, c.height - py - 2, 5, 5, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let lum = 0; for (let i = 0; i < 25; i++) lum += (buf[i * 4] + buf[i * 4 + 1] + buf[i * 4 + 2]) / 3;
    return { lum: lum / 25, map: !!g.env.sunLight.shadow.map, casters: L.root.children.length && (() => { let n = 0; L.root.traverse((o) => { if (o.castShadow) n++; }); return n; })(), on: g.renderer.shadowMap.enabled, ratio: g.renderer.getPixelRatio() };
  }, name);
  const q = await shot('quest'); await page.screenshot({ path: 'shots/gfx_quest.png' });
  const pc = await shot('pc'); await page.screenshot({ path: 'shots/gfx_pc.png' });
  const ul = await shot('ultra'); await page.screenshot({ path: 'shots/gfx_ultra.png' });
  check(!q.on && q.casters === 0, 'quest: no shadow maps');
  check(pc.on && pc.map && pc.casters > 3, `pc: the sun casts shadows from the loader (${pc.casters} parts)`);
  check(pc.lum < q.lum - 8, `pc: the ground in the loader's shadow is darker than the quest tier draws it (${pc.lum.toFixed(0)} vs ${q.lum.toFixed(0)})`);
  check(ul.on && ul.ratio >= pc.ratio, `ultra: shadows, drawn at ${ul.ratio}× pixel ratio (pc ${pc.ratio}×)`);
  // switching tier touches nothing the simulation uses
  const state = () => page.evaluate(() => { const g = __game; return JSON.stringify([g.simTime, g.machines.map((m) => m.position.toArray().concat(m.fnList.map((f) => f.pos))), [0, 7, -30, -45].map((z) => g.terrain.heightAt(2, z))]); });
  await page.evaluate(() => { __game.paused = true; });
  const s0 = await state();
  for (const name of ['quest', 'ultra', 'pc', 'quest']) await page.evaluate((n) => { __game.quality.set(n); }, name);
  check(await state() === s0, 'switching graphics tier changes nothing in the simulation (time, machines, ground)');
  check(page.errs.length === 0, 'no page errors' + (page.errs.length ? ':\n  ' + page.errs.join('\n  ') : ''));
} finally { await done(); }
