// The effects pass: what the machines and the ground throw into the air.
//   exhaust  thin grey at idle, thick and black when the engine labours or is revved hard, a black cough on start-up
//   dust     off the tyres and tracks on dry ground, where a tool is cutting, and where tipped material lands
//   spray    white water off the wheels in the river; brown mud flung from a spinning tyre
// All of it is cosmetic and runs off the machines' own state, so it looks the same on the host and on a co-op client.
import * as THREE from 'three';
import { MATERIALS, GRASS_COLOR, TOPSOIL } from '../terrain/materials.js';

const R = Math.random, _p = new THREE.Vector3(), _f = new THREE.Vector3();
const dustColor = (terrain, x, z) => { const c = terrain.cellAt(x, z), m = c < 0 ? 1 : terrain.info[c * 4], worked = c >= 0 && terrain.info[c * 4 + 1] > 0, col = m === TOPSOIL && !worked ? [0.6, 0.55, 0.4] : MATERIALS[m || 1].color; return [0.35 + col[0] * 0.65, 0.33 + col[1] * 0.65, 0.3 + col[2] * 0.65]; };

export class Effects {
  constructor(game, particles, machines) { this.game = game; this.fx = particles; this.machines = machines; this.state = new Map(machines.map((m) => [m, { rpm: 0, acc: 0, was: false }])); this.landAcc = 0; }

  /** Dust where tipped or flung material lands (called from the clod deposit hook; rate-limited). */
  landed(x, z, mat) {
    if (this.game.fast || R() > 0.1) return;
    const c = MATERIALS[mat || 1].color, y = this.game.terrain.heightAt(x, z);
    this.fx.emit({ x, y: y + 0.1, z, vx: (R() - 0.5) * 1.2, vy: 0.5 + R() * 0.8, vz: (R() - 0.5) * 1.2, life: 1.0 + R() * 0.8, s0: 0.15, s1: 0.7 + R() * 0.5, r: 0.4 + c[0] * 0.6, g: 0.38 + c[1] * 0.6, b: 0.35 + c[2] * 0.6, a: 0.35, grav: -0.15, drag: 1.6 });
  }

  update(dt) {
    const fx = this.fx, T = this.game.terrain; if (this.game.fast) return;
    for (const m of this.machines) {
      const st = this.state.get(m), e = m.engine, ex = m.def.exhaust;
      // ---- exhaust
      if (ex && (e.running || e.crank > 0)) {
        m.nodes[ex.parent].localToWorld(_p.fromArray(ex.pos));
        const rev = Math.max(0, (e.rpm - st.rpm) / Math.max(dt, 1e-3)) / 1500, load = e.load, rpmK = e.rpm / m.def.engine.maxRpm;
        if (e.running && !st.was) for (let k = 0; k < 22; k++) this._smoke(_p, 1, 1.4, 0.9);                 // start-up cough
        st.acc += dt * (3 + 34 * load * load + 60 * Math.min(1, rev) + 6 * rpmK) * (e.running ? 1 : 0.5);
        while (st.acc >= 1) { st.acc -= 1; this._smoke(_p, Math.min(1, load * 0.9 + rev * 0.8), 1 + rpmK, 0.25 + 0.55 * Math.min(1, load + rev)); }
      }
      st.rpm = e.rpm; st.was = e.running;
      // ---- wheels and tracks
      const sp = Math.abs(m.speed);
      for (const w of m.wheels) {
        if (!w.grounded) continue;
        const v = Math.abs(w.vf), wet = T.waterDepthAt(w.gx, w.gz), y = T.heightAt(w.gx, w.gz);
        if (wet > 0.05 && v > 0.4) { // splash
          if (R() < dt * v * 9) for (let k = 0; k < 2; k++) fx.emit({ x: w.gx + (R() - 0.5) * 0.5, y: y + wet, z: w.gz + (R() - 0.5) * 0.5, vx: (R() - 0.5) * 2.5, vy: 1.5 + R() * 2.5, vz: (R() - 0.5) * 2.5, life: 0.5 + R() * 0.4, s0: 0.08, s1: 0.3 + R() * 0.2, r: 0.85, g: 0.92, b: 0.95, a: 0.55, grav: 7, drag: 0.6 });
        } else if (w.slip > 0.35 && R() < dt * 30) { // mud flung back off a spinning tyre
          _f.set(0, 0, 1).applyQuaternion(w.body.obj.quaternion); const c = dustColor(T, w.gx, w.gz), dir = Math.sign(m.gear || 1);
          fx.emit({ x: w.gx, y: y + 0.25, z: w.gz, vx: _f.x * dir * (2 + R() * 3) + (R() - 0.5), vy: 1.5 + R() * 2.5, vz: _f.z * dir * (2 + R() * 3) + (R() - 0.5), life: 0.7 + R() * 0.4, s0: 0.07, s1: 0.16, r: c[0] * 0.5, g: c[1] * 0.45, b: c[2] * 0.4, a: 0.9, grav: 9, drag: 0.3 });
        } else if (v > 1.2 && !T.info[(T.cellAt(w.gx, w.gz)) * 4 + 2] && R() < dt * (v - 1) * (w.side ? 1.2 : 2.2)) { // dust on dry ground
          const c = dustColor(T, w.gx, w.gz);
          fx.emit({ x: w.gx + (R() - 0.5) * 0.4, y: y + 0.15, z: w.gz + (R() - 0.5) * 0.4, vx: (R() - 0.5) * 0.8, vy: 0.3 + R() * 0.6, vz: (R() - 0.5) * 0.8, life: 1.4 + R() * 1.2, s0: 0.2, s1: 1.0 + R() * 0.9, r: c[0], g: c[1], b: c[2], a: 0.22, grav: -0.1, drag: 1.2 });
        }
      }
      // ---- where a tool is cutting
      for (const t of m.tools) {
        const rate = m.puppet ? (m.net ? m.net.dig : 0) : Math.min(1, t.rate);
        if (rate < 0.04 || R() > dt * (6 + 30 * rate)) continue;
        t.node.getWorldPosition(_p); const c = dustColor(T, _p.x, _p.z), y = Math.max(_p.y, T.heightAt(_p.x, _p.z));
        fx.emit({ x: _p.x + (R() - 0.5) * 1.6, y: y + 0.1, z: _p.z + (R() - 0.5) * 1.6, vx: (R() - 0.5) * 1.2, vy: 0.4 + R(), vz: (R() - 0.5) * 1.2, life: 1.2 + R(), s0: 0.2, s1: 0.9 + R() * 0.8, r: c[0], g: c[1], b: c[2], a: 0.28, grav: -0.1, drag: 1.4 });
      }
      void sp;
    }
    fx.update(dt);
  }
  _smoke(p, dark, speed, alpha) {
    const g = 0.5 - 0.42 * dark; // grey at idle, black under load
    this.fx.emit({ x: p.x + (R() - 0.5) * 0.06, y: p.y, z: p.z + (R() - 0.5) * 0.06, vx: (R() - 0.5) * 0.5, vy: 1.4 * speed + R() * 0.8, vz: (R() - 0.5) * 0.5, life: 1.3 + R() * 1.4 + dark, s0: 0.1, s1: 0.7 + R() * 0.7 + dark * 0.6, r: g, g: g * 0.98, b: g * 0.95, a: alpha, grav: -0.5, drag: 0.9 });
  }
}
