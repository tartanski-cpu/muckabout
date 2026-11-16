// The site row on the start page (index.html #site): which valley this is, and moving valleys between computers.
//   pick a site     the list of sites saved in this browser; choosing one reloads into it (?site=<name>)
//   New site…       a fresh valley under a new name
//   Save to a file  the site as a .muck file (game/siteFile.js), to open on another computer
//   Open a file     a .muck file becomes a site here, under its name (or the name with a number if that is taken:
//                   a file never replaces a site)
//   Start this site again / Delete
// The site last played is remembered in this browser; ?site= overrides.
import { DEFAULT_SITE, listSites, storeSite, readSite } from '../game/save.js';
import { encodeSite, decodeSite, SITE_FILE } from '../game/siteFile.js';

const LAST = 'muckabout.site';
export function siteName(q) {
  const s = q.get('site'); if (s) return s.slice(0, 40);
  try { return localStorage.getItem(LAST) || DEFAULT_SITE; } catch { return DEFAULT_SITE; }
}
const go = (params) => { const u = new URL(location.href); u.searchParams.delete('new'); for (const k in params) { if (params[k] === null) u.searchParams.delete(k); else u.searchParams.set(k, params[k]); } location.href = u.href; };

/** Wire the row up for this save (game/save.js SaveGame). Returns the API the tests use. */
export async function siteRow(game, save) {
  const map = game.opts.map, $ = (id) => document.getElementById(id), note = (t) => { const el = $('siteNote'); if (el) el.textContent = t; };
  try { localStorage.setItem(LAST, save.name); } catch { /* private window */ }
  const sel = $('siteSel');
  const fill = async () => {
    if (!sel) return;
    const sites = await listSites(map); if (!sites.find((s) => s.name === save.name)) sites.unshift({ name: save.name, when: 0 });
    sel.replaceChildren(...sites.map((s) => { const o = document.createElement('option'); o.value = s.name; o.textContent = s.when ? `${s.name} (${new Date(s.when).toLocaleDateString()})` : `${s.name} (new)`; o.selected = s.name === save.name; return o; }));
  };
  await fill();
  const before = save.onChange; save.onChange = () => { before?.(); fill(); };
  sel?.addEventListener('change', () => go({ site: sel.value }));
  const taken = async (name) => (await listSites(map)).some((s) => s.name === name);
  $('newSiteBtn')?.addEventListener('click', async () => {
    const name = (prompt('Name for the new site (each group can keep its own):', 'Friends') || '').trim().slice(0, 40); if (!name) return;
    if (await taken(name)) { note(`There is already a site called ${name}.`); return; }
    go({ site: name, new: 1 });
  });
  $('delBtn')?.addEventListener('click', async () => { if (!confirm(`Delete the site "${save.name}" for good?`)) return; await save.forget(); try { localStorage.removeItem(LAST); } catch { /* */ } go({ site: null }); });
  const api = {
    /** This site as file bytes (saved first, so the file has the latest work). */
    async exportBytes() { await save.save(); const s = await readSite(map, save.name); if (!s) throw new Error('nothing saved yet'); return encodeSite(s, save.name); },
    /** File bytes → a site here. Returns the name it was stored under. */
    async importBytes(bytes, fileName = '') {
      const { name: inFile, site } = await decodeSite(bytes);
      let name = (inFile || fileName.replace(/\.muck$/i, '') || 'Imported').slice(0, 40), base = name;
      for (let k = 2; await taken(name); k++) name = `${base} ${k}`; // never over a site already here: delete that first if it should go
      await storeSite(map, name, site); return name;
    },
  };
  $('exportBtn')?.addEventListener('click', async () => {
    try {
      const bytes = await api.exportBytes(), a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: SITE_FILE.type })); a.download = save.name.replace(/[^\w\- ]+/g, '_') + SITE_FILE.ext; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000); note(`Saved to ${a.download} (${Math.round(bytes.length / 1024)} KB). Open it on the other computer's start page.`);
    } catch (e) { note('Could not save the file: ' + e.message); }
  });
  $('importFile')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const name = await api.importBytes(new Uint8Array(await f.arrayBuffer()), f.name); go({ site: name }); } catch (err) { note(err.message); }
  });
  return api;
}
