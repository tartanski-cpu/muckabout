// The start page (index.html #start): the first thing on screen, and the menu again with Esc. It assumes nothing
// about the player: "Play on this computer" works with mouse, keys or a gamepad; "Enter VR" is offered when the
// browser can open a headset session (it starts three's VRButton, which stays the one place a session is begun).
// Co-op, the saved site and graphics quality sit here too (their handlers are in main.js and render/quality.js).
// Shown unless ?start=0. Under automation (Playwright: navigator.webdriver) it starts hidden unless ?start=1, so the
// scripted runs and the screenshot tools see the game, not the menu.

export function startPage(game, { q }) {
  const el = document.getElementById('start'); if (!el) return null;
  const play = document.getElementById('playBtn'), vr = document.getElementById('vrBtn'), note = document.getElementById('vrNote');
  const hint = document.getElementById('help');
  const want = q.get('start');
  const ui = {
    open: want === '1' || (want !== '0' && !navigator.webdriver),
    show() { ui.open = true; el.classList.remove('hidden'); if (hint) hint.style.display = 'none'; },
    hide() { ui.open = false; el.classList.add('hidden'); if (hint) hint.style.display = ''; game.renderer.domElement.focus?.(); },
  };
  ui.open ? ui.show() : ui.hide();
  play.addEventListener('click', () => { game.scene_?.bus?.start(); ui.hide(); });
  // VR: only when the browser says it can
  const vrb = () => document.getElementById('VRButton');
  const say = (t) => { note.textContent = t; };
  if (navigator.xr?.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      vr.disabled = !ok;
      say(ok ? 'Headset found: Enter VR, then grab a handrail to climb in.' : 'No VR headset here. On a Quest, open this page in its browser to play in VR.');
    }).catch(() => say('No VR headset here.'));
  } else say(window.isSecureContext ? 'This browser has no VR. On a Quest, open this page in its browser.' : 'VR needs a secure (https) page.');
  vr.addEventListener('click', () => { game.scene_?.bus?.start(); vrb()?.click(); });
  game.renderer.xr.addEventListener('sessionstart', () => ui.hide());
  // Esc: the menu (and the controls) over the game, and back
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || game.renderer.xr.isPresenting) return;
    if (ui.open) ui.hide(); else ui.show();
  });
  return ui;
}
