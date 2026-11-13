// Runs every scripted headless test in sequence; fails if any fails.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
const only = process.argv.slice(2);
const files = readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.mjs') && !['lib.mjs', 'run.mjs'].includes(f) && (!only.length || only.some((o) => f.startsWith(o)))).sort();
let bad = 0;
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [new URL(f, import.meta.url).pathname], { stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
process.exit(bad ? 1 : 0);
