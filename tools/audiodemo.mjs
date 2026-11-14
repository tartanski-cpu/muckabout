// Renders what the engine room of a machine sounds like through a scripted shift, to a file you can listen to
// without a headset. It runs the real machine simulation (no browser) and plays its audioState through the same
// worklet the game uses. Engine, turbo, fan, pump, relief valve and starter only: soil, tracks and clunks are
// ordinary Web Audio nodes and are not in the file.
// Usage: node tools/audiodemo.mjs [loader|dozer|dumper|backhoe] [cab]   → shots/engine_<machine>.wav (+ .m4a with ffmpeg)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { rig } from '../tests/helpers.js';
import { engineVoice } from './audiolab.mjs';

const name = process.argv[2] || 'loader', cab = process.argv[3] === 'cab' ? 1 : 0;
const r = await rig(name, { x: 10, z: 14 }); const m = r.m; m.setPhysics('custom');
const frames = [], log = [];
const rec = (n, fn, label) => { if (label) log.push(`${(frames.length / 60).toFixed(1).padStart(5)} s  ${label}`); r.step(n, (mm, i) => { if (fn) fn(mm, i); const s = mm.audioState(); frames.push({ rpm: s.rpm, load: s.load, boost: s.boost, fire: s.running ? 1 : 0, starter: s.cranking ? 1 : 0, hydP: s.running ? s.hydP : 0, hydQ: s.running ? s.hydQ : 0, relief: s.running ? s.relief : 0, cab }); }); };
const I = m.inp, wheels = m.def.drive.type === 'wheels', go = (v) => { if (wheels) { I.shuttle = Math.sign(v) || 1; I.accel = Math.abs(v); } else { I.left = v; I.right = v; } };
const level = (mm) => { if (mm.fn.bucket && mm.fn.boom) mm.inp.bucket = mm.fn.bucket.pos > 0 ? -1 : 0; };
r.step(60);
rec(30, null, 'silence');
rec(150, () => { I.key = 1; I.park = 0; }, 'key on: cranks, catches, settles to idle');
rec(120, () => { I.throttle = 1; }, 'throttle up, no load');
rec(60, () => { I.throttle = 0.15; }, 'back to idle');
rec(60, () => { I.throttle = 1; }, 'throttle up again');
const up = m.fn.boom ? 'boom' : m.fn.lift ? 'lift' : 'tip';
rec(70, () => { I[up] = 1; }, `raise the ${up}, nothing in it`);
rec(100, () => { I[up] = 1; }, 'held against the stop: relief valve');
rec(150, (mm) => { I[up] = -1; level(mm); }, 'lower it to the ground');
I[up] = 0; if (I.bucket !== undefined) I.bucket = 0;
rec(260, () => go(1), 'drive into the ground: the engine is pulled down, then digs in');
rec(60, () => go(0), 'off the pedal');
if (m.rigs.length) {
  rec(60, () => { if (m.fn.bucket) I.bucket = 1; }, 'curl the bucket');
  if (I.bucket !== undefined) I.bucket = 0;
  rec(110, () => { I[up] = 1; }, `raise the ${up} with ${m.payload().toFixed(1)} m³ in it: listen to the pump and the engine`);
  I[up] = 0;
}
rec(90, () => { I.throttle = 0.15; }, 'idle');
rec(150, () => { I.key = 0; }, 'key off: runs down');
// play the frames through the voice, easing the parameters between 60 Hz frames as the game's setTargetAtTime does
const v = engineVoice({ ...m.def.engine, ...(m.def.engine.voice || {}) }), cur = { ...frames[0] };
const audio = v.render(frames.length / 60, (t) => { const f = frames[Math.min(frames.length - 1, t * 60 | 0)]; for (const k in f) cur[k] += (f[k] - cur[k]) * 0.08; return cur; });
const pcm = Buffer.alloc(44 + audio.length * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + audio.length * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(48000, 24); pcm.writeUInt32LE(96000, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(audio.length * 2, 40);
for (let i = 0; i < audio.length; i++) pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(audio[i] * 32767))), 44 + i * 2);
fs.mkdirSync('shots', { recursive: true }); const base = `shots/engine_${name}${cab ? '_cab' : ''}`;
fs.writeFileSync(`${base}.wav`, pcm); console.log(log.join('\n')); console.log(`wrote ${base}.wav (${(frames.length / 60).toFixed(0)} s)`);
const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${base}.wav`, '-c:a', 'aac', '-b:a', '128k', `${base}.m4a`]);
if (ff.status === 0) console.log(`wrote ${base}.m4a`);
// what the engine did, a line a second
for (let i = 30; i < frames.length; i += 60) { const f = frames[i]; console.log(`${(i / 60).toFixed(1).padStart(5)} s rpm ${f.rpm.toFixed(0).padStart(4)} fuel ${f.load.toFixed(2)} boost ${f.boost.toFixed(2)} hydP ${f.hydP.toFixed(2)} hydQ ${f.hydQ.toFixed(2)} relief ${f.relief.toFixed(1)}`); }
