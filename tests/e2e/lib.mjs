// Shared harness for the scripted headless runs: serves dist/ and opens pages in software-GL Chromium.
import { preview } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

export async function harness() {
  mkdirSync('shots', { recursive: true });
  const server = await preview({ preview: { port: 4179, strictPort: false }, logLevel: 'warn' });
  const base = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const failures = [];
  const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) failures.push(msg); return ok; };
  // context: pass the same one for pages that must share a BroadcastChannel (the two-player test)
  async function open(path, { wait = '__game', viewport = { width: 1280, height: 760 }, context = null, init = null } = {}) {
    const page = context ? await context.newPage() : await browser.newPage({ viewport });
    if (context) await page.setViewportSize(viewport);
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('pageerror', (e) => errs.push('pageerror: ' + e));
    if (init) await init(page); // e.g. install a WebXR emulator before the app looks for navigator.xr
    await page.goto(base + path);
    await page.waitForFunction((w) => window[w] && (window[w].ready !== false), wait, { timeout: 60000 });
    page.errs = errs;
    return page;
  }
  async function done() {
    await browser.close(); await server.close();
    if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
    console.log('\nall checks passed');
  }
  return { open, check, done, base, browser };
}
