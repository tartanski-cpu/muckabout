// The stress scene (spec §3.8): four machines working under scripted drivers, the clod budget held full, the river
// flowing. Start with ?stress=1, or toggle from the debug keys. Every milestone should end with a run of this on the headset.
import { Script, loaderCycle, dumperCycle, dozerCycle, backhoeCycle } from '../game/autopilot.js';
import { CLOD_VOL } from '../terrain/clods.js';
import { NMAT } from '../terrain/materials.js';

export function startStress(game) {
  const M = (id) => game.machine(id), scripts = [], t = game.terrain;
  const L = M('loader'), D = M('dumper'), Z = M('dozer'), B = M('backhoe');
  // everything happens in the yard round the gravel stockpile at (22, -46)
  if (L && D) {
    D.reset(10.1, -52.95, 0.62); L.reset(6, -46, -Math.PI / 2);
    scripts.push(new Script(L, loaderCycle({ from: [11, -46], dig: [20, -46], stage: [2.5, -46], target: D.containers.bed }), { loop: true }));
    scripts.push(new Script(D, dumperCycle({ park: [10.1, -52.95], via: [14, -47.5], tip: [30, -36], load: 2.0 }), { loop: true, timeout: 240 }));
  }
  if (Z) { Z.reset(-12, -42, Math.PI); scripts.push(new Script(Z, dozerCycle({ a: [-12, -42], b: [-12, -33.5] }), { loop: true })); }
  if (B) { B.reset(-4, -53, -Math.PI / 2); scripts.push(new Script(B, backhoeCycle(), { loop: true })); }
  const heap = [22, -46], FP = new Array(12).fill(0);
  let on = true;
  const upd = (dt) => {
    if (!on) return;
    for (const s of scripts) s.step(dt);
    // top the clod budget up from the stockpile (volume-conserving: cut a little, throw it)
    const want = Math.min(game.clods.max - game.clods.count, 30), fy = Math.max(5.5, t.heightAt(heap[0], heap[1]) - 0.25);
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz], q) => { FP[q * 3] = heap[0] + sx; FP[q * 3 + 1] = fy; FP[q * 3 + 2] = heap[1] + sz; });
    if (want > 0) t.command({ k: 'cut', id: 'fountain', p0: FP, p1: FP, capacity: want * CLOD_VOL, ahead: 0 });
    const res = t.takeResult('fountain');
    if (res) for (let m = 1; m < NMAT; m++) for (let v = res.taken[m]; v > 1e-9; v -= CLOD_VOL) {
      const r = game.rng; game.clods.spawn(heap[0] + (r() - 0.5) * 2, t.heightAt(heap[0], heap[1]) + 0.4, heap[1] + (r() - 0.5) * 2, (r() - 0.5) * 3, 6 + r() * 5, (r() - 0.5) * 3, m, Math.min(v, CLOD_VOL));
    }
  };
  game.updaters.unshift(upd);
  return { scripts, stop() { on = false; for (const s of scripts) s.m.override = {}; game.updaters.splice(game.updaters.indexOf(upd), 1); } };
}
