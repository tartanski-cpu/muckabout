// A site as a file, to carry a valley from one computer to another (docs/valley-layout.md: a valley per group).
// The saved site (game/save.js: plain objects, numbers and typed arrays) as JSON, typed arrays as base64, gzipped.
// A few hundred kilobytes, because a save holds only the ground that was worked.
export const SITE_FILE = { ext: '.muck', type: 'application/x-muckabout-site', magic: 'muckabout-site', version: 1 };

const TYPED = { Float32Array, Float64Array, Int32Array, Int16Array, Uint8Array, Uint16Array, Uint32Array, Int8Array };
const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (b) => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

function pack(v) {
  if (ArrayBuffer.isView(v)) return { __t: v.constructor.name, b: toB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (Array.isArray(v)) return v.map(pack);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = pack(v[k]); return o; }
  return v;
}
function unpack(v) {
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === 'object') {
    if (v.__t && TYPED[v.__t]) { const u = fromB64(v.b), T = TYPED[v.__t]; return new T(u.buffer, 0, u.byteLength / T.BYTES_PER_ELEMENT); }
    const o = {}; for (const k in v) o[k] = unpack(v[k]); return o;
  }
  return v;
}
async function through(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

/** A saved site → the bytes of a site file. */
export async function encodeSite(site, name) {
  const json = JSON.stringify({ magic: SITE_FILE.magic, version: SITE_FILE.version, name, site: pack(site) });
  return through(new TextEncoder().encode(json), new CompressionStream('gzip'));
}
/** The bytes of a site file → { name, site }. Throws with a plain message if it is not one. */
export async function decodeSite(bytes) {
  let o;
  try { o = JSON.parse(new TextDecoder().decode(await through(bytes, new DecompressionStream('gzip')))); } catch { throw new Error('that is not a Muck About site file'); }
  if (o?.magic !== SITE_FILE.magic) throw new Error('that is not a Muck About site file');
  if (o.version > SITE_FILE.version) throw new Error('that site file is from a newer version of the game');
  return { name: o.name, site: unpack(o.site) };
}
