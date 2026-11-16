// Graphics quality (roadmap 0b): the Quest's settings, and two tiers above them for PCs with a proper graphics card.
// Only what is drawn changes; the simulation is the same at every setting, so players on different tiers share a game.
//   quest   what the headset can afford: no shadow maps (machines get a soft pool of shade drawn in the ground
//           shader), pixel ratio up to 2. The 150 draw-call budget is for this tier.
//   pc      real sun shadows from the machines, players and hand tools onto the ground (a 2048² map over ±30 m round
//           where you are, filtered in the ground shader), and machines shading themselves.
//   ultra   a 4096² map over ±45 m, the picture rendered at up to 1.5× the screen's resolution, and the haze further off.
// Chosen on the start page (index.html #quality) and remembered in the browser; ?quality= overrides. A Quest's
// browser defaults to quest, anything else to pc.
import * as THREE from 'three';

export const QUALITY = {
  quest: { label: 'Quest', ratio: 1, shadow: 0, span: 0, fog: 1 },
  pc: { label: 'PC', ratio: 1, shadow: 2048, span: 30, fog: 1.15 },
  ultra: { label: 'PC high', ratio: 1.5, shadow: 4096, span: 45, fog: 1.35 },
};
const KEY = 'muckabout.quality';
const isQuest = () => /OculusBrowser|Quest|Pico/i.test(navigator.userAgent);

export function defaultQuality(q) {
  const want = q?.get('quality'); if (want && QUALITY[want]) return want;
  try { const s = localStorage.getItem(KEY); if (s && QUALITY[s]) return s; } catch { /* private window */ }
  return isQuest() ? 'quest' : 'pc';
}

export class Quality {
  constructor(game) {
    this.game = game; this.name = null; this.n = 0;
    this.base = { near: game.env.fogNear, far: game.env.fogFar };
    game.frameUpdaters.push(() => this.update());
  }
  /** Switch tier; `remember` keeps it for the next visit. */
  set(name, remember = false) {
    const Q = QUALITY[name] || QUALITY.pc, g = this.game, r = g.renderer, sun = g.env.sunLight, u = g.ground.material.uniforms;
    this.name = QUALITY[name] ? name : 'pc'; this.q = Q;
    if (remember) try { localStorage.setItem(KEY, this.name); } catch { /* private window */ }
    r.setPixelRatio(Math.min(window.devicePixelRatio * Q.ratio, Q.ratio > 1 ? 3 : 2));
    r.setSize(window.innerWidth, window.innerHeight);
    const on = Q.shadow > 0, was = r.shadowMap.enabled;
    r.shadowMap.enabled = on; r.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = on;
    if (on) {
      const s = sun.shadow; s.mapSize.set(Q.shadow, Q.shadow);
      if (s.map) { s.map.dispose(); s.map = null; } // a new size takes a new map
      const c = s.camera; c.left = c.bottom = -Q.span; c.right = c.top = Q.span; c.near = 1; c.far = 200; c.updateProjectionMatrix();
      s.bias = -0.0005; s.normalBias = 0.02;
      if (!sun.target.parent) g.scene.add(sun.target);
    }
    u.uSMOn.value = 0; u.uSMTexel.value = 1 / Math.max(1, Q.shadow);
    g.scene.fog.near = this.base.near * Q.fog; g.scene.fog.far = this.base.far * Q.fog;
    u.uFogNear.value = this.base.near * Q.fog; u.uFogFar.value = this.base.far * Q.fog;
    if (g.water?.mat) { g.water.mat.uniforms.uFogNear.value = u.uFogNear.value; g.water.mat.uniforms.uFogFar.value = u.uFogFar.value; }
    this._casters(true);
    // every material has to be rebuilt when shadows go on or off (only then: in a software renderer that takes seconds)
    if (on !== was) g.scene.traverse((o) => { const m = o.material; if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true; });
    return this.name;
  }
  /** Things that cast: machines, other players, hand tools. Re-run now and then for players who join later. */
  _casters(force) {
    const g = this.game, on = !!this.q?.shadow, self = this.name === 'ultra' || this.name === 'pc', S = g.play;
    const roots = [...(g.machines || []).map((m) => m.root), ...(S?.tools?.all || []).map((t) => t.root), ...[...(S?.net?.avatars?.values() || [])].map((a) => a.root)];
    for (const r of roots) r.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { if (force || o.castShadow !== on) { o.castShadow = on; o.receiveShadow = on && self && !!(g.machines || []).find((m) => m.root === r); } } });
  }
  update() {
    if (!this.q?.shadow) return;
    const g = this.game, sun = g.env.sunLight, u = g.ground.material.uniforms, f = g.focus;
    // the shadow follows the player: a box round them, lit from the sun's direction, snapped to whole texels so it does not shimmer
    const step = (2 * this.q.span) / this.q.shadow, x = Math.round(f.x / step) * step, z = Math.round(f.z / step) * step;
    sun.target.position.set(x, f.y, z); sun.position.copy(g.env.sunDir).multiplyScalar(90).add(sun.target.position);
    sun.target.updateMatrixWorld();
    if (sun.shadow.map) { u.uSM.value = sun.shadow.map.texture; u.uSMMat.value = sun.shadow.matrix; u.uSMOn.value = 1; }
    if (++this.n % 60 === 0) this._casters(false);
  }
}
