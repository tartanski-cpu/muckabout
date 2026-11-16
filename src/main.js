import { Game, debugCamera } from './game/app.js';

const q = new URLSearchParams(location.search);
const flag = (k, d) => (q.has(k) ? q.get(k) !== '0' : d);
const sceneName = q.get('scene') || 'play';
const status = document.getElementById('status');
const join = q.get('join'), hosting = flag('host', false);

(async () => {
  const map = q.get('map') || (sceneName === 'stress' ? 'test' : 'dirttown');
  const game = new Game({ map, worker: flag('worker', true), water: map === 'dirttown' && flag('water', true), seed: 1337, remote: !!join });
  await game.init();
  window.__game = game;
  if (sceneName === 'stress') {
    const { setup } = await import('./scenes/ghostStress.js');
    game.scene_ = setup(game, { fountain: flag('fountain', true) });
    debugCamera(game, 22);
    document.getElementById('helpBody').innerHTML = 'Terrain stress scene: four scripted buckets and a clod fountain.<br>Drag to look, wheel to zoom. <a href="poc.html">Original proof of concept</a>';
  }
  if (sceneName === 'play') {
    const { setup } = await import('./scenes/play.js');
    game.scene_ = await setup(game, {});
    if (!join) game.scene_.setPhysics(q.get('physics') === 'rapier' ? 'rapier' : 'custom'); // custom is the default; ?physics=rapier for the other
    game.hud.note = '';
    if (flag('stress', false)) game.scene_.setStress(true);
    // the saved site, if there is one (game/save.js): loaded now, then saved by itself as you work. ?new=1 starts afresh, ?save=0 switches it off
    if (!join && flag('save', true) && !flag('stress', false)) {
      const { SaveGame } = await import('./game/save.js'), save = game.save = new SaveGame(game, game.scene_);
      if (flag('new', false)) await save.forget(); else if (await save.load()) game.hud.note = 'SITE LOADED FROM YOUR LAST VISIT';
      save.auto();
      const when = document.getElementById('saveWhen'), show = () => { if (when) when.textContent = save.savedAt ? 'saved ' + new Date(save.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'not saved yet'; };
      save.onChange = show; show();
      document.getElementById('saveBtn')?.addEventListener('click', () => save.save());
      document.getElementById('newBtn')?.addEventListener('click', async () => { if (!confirm('Start a new site? The saved one will be gone for good.')) return; await save.forget(); const u = new URL(location.href); u.searchParams.set('new', '1'); location.href = u.href; });
    }
    coop(game);
  }
  game.start();
  { const { startPage } = await import('./ui/start.js'); game.menu = startPage(game, { q }); }
  { // graphics tier (render/quality.js): drawing only, the simulation is the same at every setting
    const { Quality, defaultQuality, QUALITY } = await import('./render/quality.js');
    const quality = game.quality = new Quality(game), sel = document.getElementById('quality'), note = document.getElementById('gfxNote');
    const say = () => { if (note) note.textContent = quality.q.shadow ? `sun shadows ${quality.q.shadow}², ±${quality.q.span} m` : 'for the headset: shade pools, no shadow maps'; };
    quality.set(defaultQuality(q)); say();
    if (sel) { sel.value = quality.name; sel.addEventListener('change', () => { quality.set(sel.value, true); say(); }); }
    void QUALITY;
  }
  status.textContent = `${game.terrain.mode} terrain · ${game.opts.map} map`;
  if (hosting || join) {
    const { makeTransport, newRoomCode } = await import('./net/transport.js'), { startHost, startClient } = await import('./net/session.js');
    const transport = makeTransport(q.get('net') || 'peer', q.get('broker')), code = join || q.get('room') || newRoomCode();
    if (hosting && !q.get('room')) { const u = new URL(location.href); u.searchParams.set('room', code); history.replaceState(null, '', u); } // a reload of the host's page reopens the same room
    status.textContent = hosting ? 'opening room…' : `joining room ${code}…`;
    try {
      if (hosting) { await startHost(game, game.scene_, transport, code); status.textContent = `hosting · room ${code} · tell the other player this number`; }
      else { await startClient(game, game.scene_, transport, code); status.textContent = `joined room ${code}`; }
      const el = document.getElementById('netStatus'), net = game.scene_.net;
      const say = () => {
        const t = hosting ? `Room ${code} · ${net.peers.size ? net.peers.size + ' joined' : 'nobody else here yet'}${transport.reachable === false ? ' · reconnecting to the matchmaking server' : ''}`
          : net.lost ? `Lost room ${code}: reconnecting…` : `In room ${code}`;
        if (el && el.textContent !== t) el.textContent = t; if (!hosting && net.lost) status.textContent = t;  else if (!hosting) status.textContent = `joined room ${code}`;
      };
      say(); setInterval(say, 1000);
    } catch (e) { status.textContent = 'co-op failed: ' + e.message; console.warn(e); }
  }
})().catch((e) => { status.textContent = 'failed to start: ' + e.message; console.error(e); });

/** The co-op row on the start page: host a room, or join one by its five-digit code. Both reload the page with the choice in the URL. */
function coop() {
  const go = (params) => { const u = new URL(location.href); u.search = ''; for (const k in params) u.searchParams.set(k, params[k]); if (q.get('net')) u.searchParams.set('net', q.get('net')); location.href = u.toString(); };
  document.getElementById('hostBtn')?.addEventListener('click', () => go({ host: 1 }));
  document.getElementById('joinBtn')?.addEventListener('click', () => { const c = document.getElementById('joinCode').value.trim(); if (/^\d{5}$/.test(c)) go({ join: c }); else document.getElementById('netStatus').textContent = 'enter the 5-digit room number'; });
}
