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
    if (flag('stress', false)) game.scene_.setStress(true);
    coop(game);
  }
  game.start();
  status.textContent = `${game.terrain.mode} terrain · ${game.opts.map} map`;
  if (hosting || join) {
    const { makeTransport, newRoomCode } = await import('./net/transport.js'), { startHost, startClient } = await import('./net/session.js');
    const transport = makeTransport(q.get('net') || 'peer'), code = join || q.get('room') || newRoomCode();
    status.textContent = hosting ? 'opening room…' : `joining room ${code}…`;
    try {
      if (hosting) { await startHost(game, game.scene_, transport, code); status.textContent = `hosting · room ${code} · tell the other player this number`; }
      else { await startClient(game, game.scene_, transport, code); status.textContent = `joined room ${code}`; }
      const el = document.getElementById('netStatus'); if (el) el.textContent = hosting ? `Room ${code}` : `In room ${code}`;
    } catch (e) { status.textContent = 'co-op failed: ' + e.message; console.warn(e); }
  }
})().catch((e) => { status.textContent = 'failed to start: ' + e.message; console.error(e); });

/** The co-op row in the help panel: host a room, or join one by its five-digit code. Both reload the page with the choice in the URL. */
function coop() {
  const go = (params) => { const u = new URL(location.href); u.search = ''; for (const k in params) u.searchParams.set(k, params[k]); if (q.get('net')) u.searchParams.set('net', q.get('net')); location.href = u.toString(); };
  document.getElementById('hostBtn')?.addEventListener('click', () => go({ host: 1 }));
  document.getElementById('joinBtn')?.addEventListener('click', () => { const c = document.getElementById('joinCode').value.trim(); if (/^\d{5}$/.test(c)) go({ join: c }); else document.getElementById('netStatus').textContent = 'enter the 5-digit room number'; });
}
