// Message transports for co-op. One host, a few clients, reliable ordered messages (plain objects, typed arrays allowed).
//   PeerTransport       WebRTC data channels through PeerJS and its public broker, as SWVR does (src/net/transport.ts):
//                       room code = 5 digits, host peer id `muckabout-room-<code>`, reliable channel, binary serialisation
//                       (PeerJS's 'json' mode silently drops messages over 16 KB).
//   BroadcastTransport  same API over a BroadcastChannel: two tabs of one browser. Used by the scripted two-player test
//                       and handy for trying co-op on one desktop. No network involved.
// API: host(code) / join(code) → Promise (join may be called again to reconnect); send(msg, to?) ; onMessage(msg, from) ;
//      onPeer(id) ; onLeave(id)

const ROOM = (code) => `muckabout-room-${code}`;
export const newRoomCode = () => String(10000 + Math.floor(Math.random() * 90000));

class Base { constructor() { this.onMessage = () => {}; this.onPeer = () => {}; this.onLeave = () => {}; this.isHost = false; this.id = null; this.state = 'idle'; } }

export class BroadcastTransport extends Base {
  async host(code) { this._open(code); this.isHost = true; this.id = 'host'; this.state = 'open'; return code; }
  /** Join, or join again after the link was lost (a new id each time, as with PeerJS). */
  async join(code) {
    this._shut(true); this._open(code); this.id = 'p' + Math.random().toString(36).slice(2, 8);
    const ch = this.ch; let timer;
    try {
      await new Promise((res, rej) => {
        this._welcome = res; timer = setTimeout(() => rej(new Error('no host answered in this browser for room ' + code)), 4000);
        ch.postMessage({ k: 'join', from: this.id });
      });
    } catch (e) { if (this.ch === ch) this._shut(false); throw e; } finally { clearTimeout(timer); }
    this.state = 'open';
  }
  _open(code) {
    const ch = this.ch = new BroadcastChannel(ROOM(code)); this.peers = new Set();
    ch.onmessage = (e) => {
      const m = e.data;
      if (m.k === 'join' && this.isHost) { this.peers.add(m.from); ch.postMessage({ k: 'welcome', to: m.from }); this.onPeer(m.from); }
      else if (m.k === 'welcome' && m.to === this.id) this._welcome?.();
      else if (m.k === 'bye') { if (this.isHost && this.peers.delete(m.from)) this.onLeave(m.from); else if (!this.isHost && m.from === 'host' && this.state === 'open') { this.state = 'lost'; this.onLeave('host'); } }
      else if (m.k === 'msg' && (m.to === this.id || (m.to === '*' && m.from !== this.id)) && (this.isHost || m.from === 'host')) this.onMessage(m.d, m.from);
    };
    if (!this._hooked) { this._hooked = true; addEventListener('pagehide', () => this.close()); }
  }
  _shut(bye) { const ch = this.ch; if (!ch) return; this.ch = null; try { if (bye) ch.postMessage({ k: 'bye', from: this.id }); ch.close(); } catch { /* already closed */ } }
  send(msg, to) { try { this.ch?.postMessage({ k: 'msg', from: this.id, to: this.isHost ? (to || '*') : 'host', d: msg }); } catch { /* link down: the session notices and rejoins */ } }
  /** For the tests: the link dies without a goodbye, as when a headset drops off the wifi. */
  cut() { this._shut(false); if (!this.isHost && this.state === 'open') { this.state = 'lost'; this.onLeave('host'); } }
  close() { this._shut(true); this.state = 'closed'; }
}

// What goes wrong on real networks, and what this does about each (all seen or reasoned from a two-headset session
// where one player was dropped and could not get back in):
//   the host loses the matchmaking server   PeerJS tries nothing by itself and a single failed retry leaves the room
//                                           unreachable for good, though players already in carry on. A watchdog
//                                           keeps reconnecting (and rebuilds the Peer under the same room id if it died).
//   a client's link dies                    `join` can be called again: a fresh Peer and a fresh link each time.
//   a half-dead link                        sends on a closed channel are skipped, not thrown.
export class PeerTransport extends Base {
  constructor(broker) { super(); this.broker = broker || null; }
  async _peer(id) {
    const { Peer } = await import('peerjs');
    const o = {}; if (this.broker) { const [host, port] = this.broker.split(':'); Object.assign(o, { host, port: +port || 9000, path: '/', secure: false }); }
    return new Promise((res, rej) => {
      const p = id ? new Peer(id, o) : new Peer(o); let opened = false;
      const t = setTimeout(() => { if (!opened) { try { p.destroy(); } catch { /* gone */ } rej(new Error('cannot reach the matchmaking server (check the internet connection)')); } }, 15000);
      p.on('open', () => { opened = true; clearTimeout(t); res(p); });
      p.on('error', (e) => { if (!opened) { clearTimeout(t); try { p.destroy(); } catch { /* gone */ } rej(new Error(plain(e))); } else console.warn('peer:', plain(e)); });
    });
  }
  async host(code) {
    this.code = code; this.isHost = true; this.id = 'host'; this.conns = new Map();
    // a reload of the host's page asks for the same room id a moment after leaving it: the server may still hold it
    for (let k = 0; ; k++) { try { this.peer = await this._peer(ROOM(code)); break; } catch (e) { if (k >= 4 || !/already in use/.test(e.message)) throw e; await new Promise((r) => setTimeout(r, 2500)); } }
    this._serve(this.peer); this.state = 'open';
    this._timer = setInterval(() => this._mend(), 4000);
    addEventListener('online', () => this._mend()); addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this._mend(); });
    return code;
  }
  _serve(p) {
    p.on('connection', (c) => {
      c.on('open', () => { this.conns.set(c.peer, c); this.onPeer(c.peer); });
      c.on('data', (d) => this.onMessage(bytes(d), c.peer));
      c.on('close', () => { if (this.conns.get(c.peer) === c) { this.conns.delete(c.peer); this.onLeave(c.peer); } }); // not if that player has already come back on a new link
      c.on('error', (e) => console.warn('link:', plain(e)));
    });
  }
  /** True while new players can find the room. */
  get reachable() { return !!this.peer && this.peer.open && !this.peer.disconnected && !this.peer.destroyed; }
  /** Host: get back onto the matchmaking server whenever it has been lost, for as long as the room is open. */
  async _mend() {
    if (this.state !== 'open' || !this.isHost || this._mending) return;
    const p = this.peer;
    if (p.destroyed) {
      this._mending = true;
      try { const n = await this._peer(ROOM(this.code)); if (this.state === 'open') { this.peer = n; this._serve(n); } else n.destroy(); } catch { /* next round */ }
      this._mending = false;
    } else if (p.disconnected) { try { p.reconnect(); } catch { /* next round */ } }
  }
  /** Join, or join again after the link was lost: always a fresh Peer, so nothing of a dead link is reused. */
  async join(code) {
    const oldC = this.conn, oldP = this.peer; this.conn = null; this.peer = null; this.state = 'joining';
    try { oldC?.close(); } catch { /* gone */ } try { oldP?.destroy(); } catch { /* gone */ }
    const p = this.peer = await this._peer(null); this.id = p.id;
    try {
      await new Promise((res, rej) => {
        const c = this.conn = p.connect(ROOM(code), { reliable: true, serialization: 'binary' });
        const t = setTimeout(() => rej(new Error('could not reach room ' + code)), 15000);
        const fail = (e) => { clearTimeout(t); rej(new Error(plain(e))); };
        c.on('open', () => { clearTimeout(t); res(); });
        c.on('data', (d) => this.onMessage(bytes(d), 'host'));
        c.on('close', () => { if (this.conn === c && this.state === 'open') { this.state = 'lost'; this.onLeave('host'); } });
        c.on('error', fail); p.on('error', fail); // 'no game found with that room code' comes on the Peer
      });
    } catch (e) { if (this.peer === p) { this.conn = null; this.peer = null; this.state = 'lost'; } try { p.destroy(); } catch { /* gone */ } throw e; }
    this.state = 'open';
  }
  send(msg, to) {
    try {
      if (this.isHost) { if (to) { const c = this.conns.get(to); if (c?.open) c.send(msg); } else for (const c of this.conns.values()) if (c.open) c.send(msg); }
      else if (this.conn?.open) this.conn.send(msg);
    } catch (e) { console.warn('send:', plain(e)); }
  }
  close() { this.state = 'closed'; clearInterval(this._timer); setTimeout(() => this.peer?.destroy(), 250); } // let the last message out first
}
/** PeerJS hands a byte array back as a Uint8Array if the message was big enough to be sent in pieces, and as a bare
 *  ArrayBuffer if it was not: so the small ground updates of ordinary digging arrived in a form the game could not
 *  read, while the big first one was fine. Make them all Uint8Arrays, as BroadcastChannel delivers them. */
function bytes(d) {
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (d && typeof d === 'object' && !ArrayBuffer.isView(d)) for (const k in d) { const v = d[k]; if (v && typeof v === 'object') d[k] = bytes(v); }
  return d;
}
function plain(e) {
  const t = e?.type || '';
  if (t === 'unavailable-id') return 'that room code is already in use';
  if (t === 'peer-unavailable') return 'no game found with that room code';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'cannot reach the matchmaking server (check the internet connection)';
  return e?.message || String(e);
}
export function makeTransport(kind, broker) { return kind === 'bc' ? new BroadcastTransport() : new PeerTransport(broker); }
