// Message transports for co-op. One host, a few clients, reliable ordered messages (plain objects, typed arrays allowed).
//   PeerTransport       WebRTC data channels through PeerJS and its public broker, as SWVR does (src/net/transport.ts):
//                       room code = 5 digits, host peer id `muckabout-room-<code>`, reliable channel, binary serialisation
//                       (PeerJS's 'json' mode silently drops messages over 16 KB).
//   BroadcastTransport  same API over a BroadcastChannel: two tabs of one browser. Used by the scripted two-player test
//                       and handy for trying co-op on one desktop. No network involved.
// API: host(code) / join(code) → Promise; send(msg, to?) ; onMessage(msg, from) ; onPeer(id) ; onLeave(id)

const ROOM = (code) => `muckabout-room-${code}`;
export const newRoomCode = () => String(10000 + Math.floor(Math.random() * 90000));

class Base { constructor() { this.onMessage = () => {}; this.onPeer = () => {}; this.onLeave = () => {}; this.isHost = false; this.id = null; this.state = 'idle'; } }

export class BroadcastTransport extends Base {
  async host(code) { this._open(code); this.isHost = true; this.id = 'host'; this.state = 'open'; return code; }
  async join(code) {
    this._open(code); this.id = 'p' + Math.random().toString(36).slice(2, 8);
    this.ch.postMessage({ k: 'join', from: this.id });
    await new Promise((res, rej) => { this._welcome = res; setTimeout(() => rej(new Error('no host answered in this browser for room ' + code)), 4000); });
    this.state = 'open';
  }
  _open(code) {
    this.ch = new BroadcastChannel(ROOM(code)); this.peers = new Set();
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (m.k === 'join' && this.isHost) { this.peers.add(m.from); this.ch.postMessage({ k: 'welcome', to: m.from }); this.onPeer(m.from); }
      else if (m.k === 'welcome' && m.to === this.id) this._welcome?.();
      else if (m.k === 'bye') { if (this.isHost && this.peers.delete(m.from)) this.onLeave(m.from); else if (!this.isHost && m.from === 'host') this.onLeave('host'); }
      else if (m.k === 'msg' && (m.to === this.id || (m.to === '*' && m.from !== this.id)) && (this.isHost || m.from === 'host')) this.onMessage(m.d, m.from);
    };
    addEventListener('pagehide', () => this.close());
  }
  send(msg, to) { this.ch.postMessage({ k: 'msg', from: this.id, to: this.isHost ? (to || '*') : 'host', d: msg }); }
  close() { try { this.ch?.postMessage({ k: 'bye', from: this.id }); this.ch?.close(); } catch { /* already closed */ } this.state = 'closed'; }
}

export class PeerTransport extends Base {
  async _peer(id) {
    const { Peer } = await import('peerjs');
    return new Promise((res, rej) => {
      const p = id ? new Peer(id) : new Peer();
      p.on('open', () => res(p));
      p.on('error', (e) => { if (this.state !== 'open') rej(new Error(plain(e))); else console.warn('peer:', plain(e)); });
      p.on('disconnected', () => { if (this.state === 'open') setTimeout(() => { try { p.reconnect(); } catch { /* destroyed */ } }, 2000); }); // broker lost; data links survive
    });
  }
  async host(code) {
    this.peer = await this._peer(ROOM(code)); this.isHost = true; this.id = 'host'; this.conns = new Map();
    this.peer.on('connection', (c) => {
      c.on('open', () => { this.conns.set(c.peer, c); this.onPeer(c.peer); });
      c.on('data', (d) => this.onMessage(d, c.peer));
      c.on('close', () => { if (this.conns.delete(c.peer)) this.onLeave(c.peer); });
    });
    this.state = 'open'; return code;
  }
  async join(code) {
    this.peer = await this._peer(null); this.id = this.peer.id;
    await new Promise((res, rej) => {
      const c = this.conn = this.peer.connect(ROOM(code), { reliable: true, serialization: 'binary' });
      const t = setTimeout(() => rej(new Error('could not reach room ' + code)), 15000);
      c.on('open', () => { clearTimeout(t); res(); });
      c.on('data', (d) => this.onMessage(d, 'host'));
      c.on('close', () => this.onLeave('host'));
      c.on('error', (e) => rej(new Error(plain(e))));
    });
    this.state = 'open';
  }
  send(msg, to) {
    if (this.isHost) { if (to) this.conns.get(to)?.send(msg); else for (const c of this.conns.values()) c.send(msg); }
    else this.conn?.send(msg);
  }
  close() { this.state = 'closed'; setTimeout(() => this.peer?.destroy(), 250); } // let the last message out first
}
function plain(e) {
  const t = e?.type || '';
  if (t === 'unavailable-id') return 'that room code is already in use';
  if (t === 'peer-unavailable') return 'no game found with that room code';
  if (t === 'network' || t === 'server-error' || t === 'socket-error') return 'cannot reach the matchmaking server (check the internet connection)';
  return e?.message || String(e);
}
export function makeTransport(kind) { return kind === 'bc' ? new BroadcastTransport() : new PeerTransport(); }
