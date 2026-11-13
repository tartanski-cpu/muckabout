// Terrain replication for co-op: the host sends only the cells that changed since the last send, quantised and
// run-length encoded. A client builds the same starting map locally, so a newcomer only needs the cells that
// differ from that starting state. Pure functions over typed arrays (unit-tested, no DOM).
//
// Cell encoding: height in centimetres (Int16) + one info byte: material (3 bits) | disturbed << 3 | wet << 4.
// Wire format (little-endian DataView), per message:
//   u16 nChunks, then per chunk: u16 chunkId, u16 nRuns, then per run: u16 skip, u16 len, len × (i16 h, u8 info)
import { CHUNK } from '../terrain/core.js';

export const Q = 100; // quantisation steps per metre (1 cm)
const packInfo = (info, k) => (info[k] & 7) | (info[k + 1] ? 8 : 0) | (info[k + 2] ? 16 : 0);

/** Keeps what the peers have been sent and produces deltas against it. */
export class TerrainDeltaWriter {
  /** @param {{nx:number,nz:number,h:Float32Array,info:Uint8Array}} mirror the host's terrain mirror */
  constructor(mirror) {
    this.m = mirror; const n = mirror.nx * mirror.nz;
    this.cnx = mirror.nx / CHUNK; this.cnz = mirror.nz / CHUNK;
    this.sentH = new Int16Array(n); this.sentI = new Uint8Array(n); this.baseH = new Int16Array(n); this.baseI = new Uint8Array(n);
    this.dirty = new Set();
    this.snapshotBase();
  }
  /** Record the current mirror as the shared starting state (what a client builds locally). */
  snapshotBase() {
    const { h, info } = this.m;
    for (let c = 0; c < this.sentH.length; c++) { this.baseH[c] = this.sentH[c] = Math.round(h[c] * Q); this.baseI[c] = this.sentI[c] = packInfo(info, c * 4); }
  }
  markChunks(chunks) { for (const c of chunks) this.dirty.add(c.id); }

  _encode(ids, refH, refI, commit) {
    const { h, info, nx } = this.m, parts = []; let bytes = 2, count = 0;
    for (const id of ids) {
      const ci = id % this.cnx, cj = (id / this.cnx) | 0, runs = []; let skip = 0, run = null;
      for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
        const c = (cj * CHUNK + j) * nx + ci * CHUNK + i, qh = Math.round(h[c] * Q), qi = packInfo(info, c * 4);
        if (qh !== refH[c] || qi !== refI[c]) {
          if (!run) { run = { skip, cells: [] }; runs.push(run); skip = 0; }
          run.cells.push(qh, qi);
          if (commit) { this.sentH[c] = qh; this.sentI[c] = qi; }
        } else { run = null; skip++; }
      }
      if (!runs.length) continue;
      parts.push({ id, runs }); count++; bytes += 4; for (const r of runs) bytes += 4 + (r.cells.length / 2) * 3;
    }
    const buf = new ArrayBuffer(bytes), dv = new DataView(buf); let o = 0;
    dv.setUint16(o, count, true); o += 2;
    for (const p of parts) {
      dv.setUint16(o, p.id, true); dv.setUint16(o + 2, p.runs.length, true); o += 4;
      for (const r of p.runs) {
        dv.setUint16(o, r.skip, true); dv.setUint16(o + 2, r.cells.length / 2, true); o += 4;
        for (let q = 0; q < r.cells.length; q += 2) { dv.setInt16(o, r.cells[q], true); dv.setUint8(o + 2, r.cells[q + 1]); o += 3; }
      }
    }
    return new Uint8Array(buf);
  }
  /** Changes since the last call, for everyone already connected. Returns null if nothing changed. */
  delta() {
    if (!this.dirty.size) return null;
    const out = this._encode(this.dirty, this.sentH, this.sentI, true); this.dirty.clear();
    return out.length > 2 ? out : null;
  }
  /** Everything that differs from the starting map, for a newcomer. */
  full() {
    const ids = []; for (let id = 0; id < this.cnx * this.cnz; id++) ids.push(id);
    return this._encode(ids, this.baseH, this.baseI, false);
  }
}

/** Apply a delta to a client's mirror. Returns the chunk payloads ({id, h, info}) the renderer needs to re-upload. */
export function applyTerrainDelta(mirror, bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), { h, info, nx } = mirror, cnx = nx / CHUNK, out = [];
  let o = 0; const n = dv.getUint16(o, true); o += 2;
  for (let p = 0; p < n; p++) {
    const id = dv.getUint16(o, true), runs = dv.getUint16(o + 2, true); o += 4;
    const ci = id % cnx, cj = (id / cnx) | 0; let k = 0;
    for (let r = 0; r < runs; r++) {
      k += dv.getUint16(o, true); const len = dv.getUint16(o + 2, true); o += 4;
      for (let q = 0; q < len; q++, k++) {
        const c = (cj * CHUNK + ((k / CHUNK) | 0)) * nx + ci * CHUNK + (k % CHUNK), b = dv.getUint8(o + 2);
        h[c] = dv.getInt16(o, true) / Q; info[c * 4] = b & 7; info[c * 4 + 1] = b & 8 ? 255 : 0; info[c * 4 + 2] = b & 16 ? 255 : 0; o += 3;
      }
    }
    // repack the whole chunk for the renderer's texture upload
    const ph = new Float32Array(CHUNK * CHUNK), pi = new Uint8Array(CHUNK * CHUNK * 4);
    for (let j = 0; j < CHUNK; j++) { const src = (cj * CHUNK + j) * nx + ci * CHUNK; ph.set(h.subarray(src, src + CHUNK), j * CHUNK); pi.set(info.subarray(src * 4, (src + CHUNK) * 4), j * CHUNK * 4); }
    out.push({ id, h: ph, info: pi });
  }
  return out;
}

/** Water snapshot → bytes: per cell depth (cm, u8) and flow (i8 × 0.05 m/s), with dry runs collapsed. */
export function encodeWater(w) {
  const n = w.nx * w.nz, out = new Uint8Array(n * 3 + 16); let o = 0, k = 0;
  while (k < n) {
    let dry = 0; while (k < n && w.depth[k] < 0.02 && dry < 65535) { dry++; k++; }
    let wet = 0; const start = k; while (k < n && w.depth[k] >= 0.02 && wet < 255) { wet++; k++; }
    out[o++] = dry & 255; out[o++] = dry >> 8; out[o++] = wet;
    for (let q = start; q < start + wet; q++) { out[o++] = Math.min(255, Math.round(w.depth[q] * 100)); out[o++] = Math.max(-127, Math.min(127, Math.round(w.vx[q] * 20))) & 255; out[o++] = Math.max(-127, Math.min(127, Math.round(w.vz[q] * 20))) & 255; }
  }
  return out.slice(0, o);
}
export function decodeWater(bytes, w) {
  const n = w.nx * w.nz; let o = 0, k = 0;
  w.depth.fill(0); w.vx.fill(0); w.vz.fill(0);
  while (o < bytes.length && k < n) {
    k += bytes[o] | (bytes[o + 1] << 8); const wet = bytes[o + 2]; o += 3;
    for (let q = 0; q < wet; q++, k++) { w.depth[k] = bytes[o] / 100; w.vx[k] = ((bytes[o + 1] << 24) >> 24) / 20; w.vz[k] = ((bytes[o + 2] << 24) >> 24) / 20; o += 3; }
  }
  return w;
}
