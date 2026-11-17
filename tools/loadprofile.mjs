// Profiles a page load in software-GL Chromium and prints where the main thread spent its time: node tools/loadprofile.mjs [map]
import { preview } from 'vite';
import { chromium } from 'playwright';
const server = await preview({ preview: { port: 4188 }, logLevel: 'warn' });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
const t0 = Date.now();
await page.goto(server.resolvedUrls.local[0] + '?map=' + (process.argv[2] || 'valley') + '&save=0&quality=quest');
await page.waitForFunction(() => window.__game?.machines?.length === 4 && __game.terrain.water, null, { timeout: 180000, polling: 100 });
console.log('ready after', (Date.now() - t0) / 1000, 's');
await page.waitForFunction(() => __game.frame > 5, null, { timeout: 180000, polling: 100 });
console.log('five frames drawn after', (Date.now() - t0) / 1000, 's');
const { profile } = await cdp.send('Profiler.stop');
const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; const counts = new Map();
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
for (const [id, us] of counts) { const n = byId.get(id), f = n.callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) || 0) + us); }
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, us]) => `${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`).join('\n'));
await browser.close(); await server.close();
