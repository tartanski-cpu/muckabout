// Saving the site, so a session's work is still there next time.
//
// One save per map, kept in the browser's own storage (IndexedDB) on this device: the ground and the water as they
// stand, every machine's position, hydraulics and load, the hopper, the checklist and the jobs, the hand tools and where the
// player stood. It is written by itself every minute, when the page is hidden or closed, and when a VR session ends;
// and loaded by itself at the start. "Start a new site" forgets it.
//
// Not saved: clods in the air are landed where they would fall; engines are off and park brakes on when you come back.
// Co-op: only the host (or a solo player) saves; a client joins the host's site as it is.
//
// Named sites (docs/valley-layout.md: a valley per group): several sites per map, each under a name ("Family",
// "Friends"). The first, DEFAULT_SITE, keeps the key saves had before names, so an existing site is still found.
// A small `meta:` record per site (name, when) lets the start page list them without reading the ground.
// A site goes to and from a file with game/siteFile.js.
const DB = 'muckabout', STORE = 'saves', VERSION = 1;
export const DEFAULT_SITE = 'My valley';
const siteKey = (map, name) => (name === DEFAULT_SITE ? `site:${map}` : `site:${map}:${name}`);
const metaKey = (map, name) => `meta:${map}:${name}`;

/** The sites saved for a map, newest first: [{name, when}]. */
export async function listSites(map) {
  try {
    const all = await idb('readonly', (st) => st.getAll(IDBKeyRange.bound(`meta:${map}:`, `meta:${map}:\uffff`)));
    const names = new Set(all.map((m) => m.name));
    if (!names.has(DEFAULT_SITE)) { const old = await idb('readonly', (st) => st.get(siteKey(map, DEFAULT_SITE))); if (old) all.push({ name: DEFAULT_SITE, when: old.when }); } // saved before names
    return all.sort((a, b) => b.when - a.when);
  } catch (e) { console.warn(e); return []; }
}
/** Put a site (from a file) into storage under a name, replacing any of that name. */
export async function storeSite(map, name, site) {
  if (!site || site.map !== map) throw new Error(site ? `that site is for the ${site.map} map` : 'empty site');
  await idb('readwrite', (st) => st.put(site, siteKey(map, name)));
  await idb('readwrite', (st) => st.put({ name, when: site.when || Date.now() }, metaKey(map, name)));
}
/** The stored site of that name, as saved (for a file). */
export const readSite = (map, name) => idb('readonly', (st) => st.get(siteKey(map, name)));

function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idb(mode, fn) {
  const d = await db();
  try { return await new Promise((res, rej) => { const tx = d.transaction(STORE, mode), q = fn(tx.objectStore(STORE)); tx.oncomplete = () => res(q.result); tx.onerror = tx.onabort = () => rej(tx.error); }); }
  finally { d.close(); }
}

export class SaveGame {
  /** scene: the play scene (machines, tools, player, checklist). */
  constructor(game, scene, name = DEFAULT_SITE) { this.game = game; this.scene = scene; this.name = name; this.map = game.opts.map; this.key = siteKey(this.map, name); this.savedAt = 0; this.busy = false; this.onChange = null; this.timer = 0; }

  /** Gather the whole site into one plain object of numbers and typed arrays. */
  async collect() {
    const g = this.game, S = this.scene, pose = (o) => [...o.position.toArray(), ...o.quaternion.toArray()];
    const terrain = await g.terrain.save(); if (!terrain) return null;
    const clods = []; for (let i = 0; i < g.clods.count; i++) clods.push([g.clods.x[i], g.clods.z[i], g.clods.mat[i], g.clods.vol[i]]);
    return {
      version: VERSION, map: g.opts.map, when: Date.now(), simTime: g.simTime, terrain, clods,
      rigs: g.rigs.map((r) => ({ fill: r.field.fill.slice(), mat: r.field.mat.slice() })),
      machines: S.machines.map((m) => ({ id: m.id, bodies: m.bodyList.map((b) => { const t = b.rb.translation(), q = b.rb.rotation(); return [t.x, t.y, t.z, q.x, q.y, q.z, q.w]; }), fn: m.fnList.map((f) => f.pos), joints: m.joints.map((j) => j.target), custom: !!m.kin.custom })),
      tools: S.tools ? S.tools.all.map((t) => pose(t.root)) : [],
      slopedLine: !!S.tools?.line.slope,
      checklist: S.checklist ? S.checklist.items.map((i) => !!i.done) : [],
      pad: S.padJob ? S.padJob.state() : null,
      player: [S.player.feet.x, S.player.feet.z, S.player.yaw],
    };
  }

  /** Put a collected site back. Returns false if it does not fit this map or version. */
  async apply(s) {
    const g = this.game, S = this.scene;
    if (!s || s.version !== VERSION || s.map !== g.opts.map) return false;
    if (S.player.machine) S.stand();
    if (!(await g.terrain.load(s.terrain))) return false;
    g.clods.count = 0; g.clods.pending?.clear?.(); g.clods.pendingVol = 0;
    for (const [x, z, mat, vol] of s.clods || []) if (vol > 0) g.terrain.deposit(x, z, mat, vol);   // what was in the air lands where it was heading
    s.rigs.forEach((r, i) => { const f = g.rigs[i]?.field; if (f && f.fill.length === r.fill.length) { f.fill.set(r.fill); f.mat.set(r.mat); f.dirty = true; } });
    for (const ms of s.machines) {
      const m = S.machines.find((x) => x.id === ms.id); if (!m || ms.bodies.length !== m.bodyList.length) continue;
      m.bodyList.forEach((b, i) => { const p = ms.bodies[i]; b.rb.setTranslation({ x: p[0], y: p[1], z: p[2] }, true); b.rb.setRotation({ x: p[3], y: p[4], z: p[5], w: p[6] }, true); b.rb.setLinvel({ x: 0, y: 0, z: 0 }, true); b.rb.setAngvel({ x: 0, y: 0, z: 0 }, true); });
      m.fnList.forEach((f, i) => { if (ms.fn[i] !== undefined) f.pos = ms.fn[i]; });
      m.joints.forEach((j, i) => { if (ms.joints?.[i] !== undefined) j.target = ms.joints[i]; });
      for (const t of m.tools) { t.cut.reset(); t.has = false; }
      m.tow = null; m.sync(); m.poseNodes(); m.root.updateMatrixWorld(true); m.speed = 0;
      if (m.kin.custom) m._enterCustom();
      if (m.controls?.key) m.controls.key.set(0); if (m.controls?.park) m.controls.park.set(1);
    }
    if (S.tools) S.tools.all.forEach((t, i) => { const p = s.tools[i]; if (p) { t.root.position.fromArray(p); t.root.quaternion.fromArray(p, 3); if (t.hitch !== undefined) t.hitch = null; } });
    if (S.tools) S.tools.line.setSlope(!!s.slopedLine);
    if (S.checklist) S.checklist.items.forEach((it, i) => { it.done = !!s.checklist[i]; });
    if (S.padJob && s.pad) S.padJob.restore(s.pad);
    S.player.place(s.player[0], s.player[1], s.player[2]);
    g.simTime = s.simTime || 0;
    this.savedAt = s.when;
    return true;
  }

  async save() {
    if (this.busy || this.game.remote) return false; this.busy = true;
    try { const s = await this.collect(); if (!s) return false; await idb('readwrite', (st) => st.put(s, this.key)); await idb('readwrite', (st) => st.put({ name: this.name, when: s.when }, metaKey(this.map, this.name))); this.savedAt = s.when; this.onChange?.(); return true; }
    catch (e) { console.warn('save failed', e); return false; } finally { this.busy = false; }
  }
  async load() {
    if (this.game.remote) return false;
    try { const s = await idb('readonly', (st) => st.get(this.key)); const ok = await this.apply(s); if (ok) this.onChange?.(); return ok; }
    catch (e) { console.warn('load failed', e); return false; }
  }
  async forget() { try { await idb('readwrite', (st) => st.delete(this.key)); await idb('readwrite', (st) => st.delete(metaKey(this.map, this.name))); this.savedAt = 0; this.onChange?.(); } catch (e) { console.warn(e); } }

  /** Save by itself: every `every` seconds of play, and whenever the page is hidden or closed or a VR session ends. */
  auto(every = 60) {
    this.game.frameUpdaters.push((dt) => { this.timer += dt; if (this.timer >= every) { this.timer = 0; this.save(); } });
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.save(); });
    addEventListener('pagehide', () => { this.save(); });
    this.game.renderer.xr.addEventListener('sessionend', () => { this.save(); });
  }
}
