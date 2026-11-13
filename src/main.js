import { Game, debugCamera } from './game/app.js';

const q = new URLSearchParams(location.search);
const flag = (k, d) => (q.has(k) ? q.get(k) !== '0' : d);
const sceneName = q.get('scene') || 'stress';
const status = document.getElementById('status');

(async () => {
  const game = new Game({ map: q.get('map') || 'test', worker: flag('worker', true), seed: 1337 });
  await game.init();
  window.__game = game;
  if (sceneName === 'stress') {
    const { setup } = await import('./scenes/ghostStress.js');
    game.scene_ = setup(game, { fountain: flag('fountain', true) });
    debugCamera(game, 22);
    document.getElementById('helpBody').innerHTML = 'Terrain stress scene: four scripted buckets and a clod fountain.<br>Drag to look, wheel to zoom. <a href="poc.html">Original proof of concept</a>';
  }
  game.start();
  status.textContent = `${game.terrain.mode} terrain · ${game.opts.map} map`;
})().catch((e) => { status.textContent = 'failed to start: ' + e.message; console.error(e); });
