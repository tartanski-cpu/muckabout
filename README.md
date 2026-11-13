# muckshift

A WebXR earthmoving sandbox for standalone Meta Quest: drive machines from inside the cab and move dirt on fully deformable ground.

The full MVP spec and milestone plan are in [docs/mvp-spec.md](docs/mvp-spec.md). **Current state: M0** — repo, build, deploy and perf harness, running the original proof-of-concept wheel loader.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173, desktop debug controls
npm run build      # static site in dist/
npm test           # unit tests (vitest)
npm run test:e2e   # scripted headless run of the built game (needs `npm run build` first)
```

On a Quest, open the GitHub Pages URL in the Quest Browser and press *Enter VR*. For local iteration, WebXR needs HTTPS or localhost: with the headset on USB, `adb reverse tcp:5173 tcp:5173` and open `http://localhost:5173` in the headset.

## Deploy

`.github/workflows/ci.yml` builds and tests every push, and deploys `dist/` to GitHub Pages on pushes to `main`. One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

## Controls (POC loader)

| | Quest | Desktop (debug) |
|---|---|---|
| Drive / steer | left stick, or grab the steering wheel | `W` `S` / `A` `D` |
| Boom / bucket | right stick, or grab the joystick | `I` `K` / `J` `L` |
| Horn · recentre seat · reset | `A` · `B` · `Y` | `H` · – · `R` |
| Perf HUD on/off | `X` (HUD is on the left wrist) | `P` |
| Stress test on/off | click left stick | `T` |
| Chase camera | – | `V`, drag to look |

## Perf HUD and stress test

The wrist panel shows fps, frame time (average and worst over the last second) and per-subsystem CPU milliseconds as *average / worst*, with bars scaled to the 13.9 ms frame at 72 Hz. Below that: live clods, active terrain cells, draw calls and triangles.

The stress test fountains soil out of the heap to hold the clod count at its 1,500 budget while the slump solver chews on the whole heap. It conserves volume, so it can be left running.

Each milestone ends with a stress run on the headset: enter VR, click the left stick, read the wrist.

## Sound

Placeholder, fully synthesised (`src/audio/`):

- **Engine**: a six-cylinder diesel voice in an AudioWorklet. Each firing excites a bank of exhaust resonances, with injector clatter on top; it revs with the throttle and lugs (louder, brighter, slower) under hydraulic or digging load.
- **Hydraulics**: a valve *clunk* when the boom or bucket lever leaves or returns to neutral, a ringing *clank* (plus a haptic thump) when a cylinder hits its end stop, a relief-valve squeal while a lever is held against the stop, and pump whine that follows engine speed.

## Layout

```
index.html              page shell
src/main.js             entry point
src/poc/loader.js       the proof of concept (feel and tuning reference, not the architecture)
src/harness/perf.js     per-subsystem frame timers (no DOM, usable in workers and tests)
src/harness/wristHud.js wrist / desktop perf panel
src/audio/              diesel worklet, machine sounds, hydraulic clunk/clank event detection
tests/                  vitest unit tests
tests/e2e/poc.mjs       scripted headless test using the fast-forward __game.sim() hook
docs/mvp-spec.md        MVP spec and milestones
```

## Debug hooks

`window.__game` exposes the test surface: `sim(n, fn)` fast-forwards `n` fixed 1/72 s steps, `pause(bool)` freezes the realtime loop, `volume()` audits every place soil can be (ground, bucket, truck bed, airborne, lost at the edge), `setStress(bool)`, and `perf.snapshot()`.
