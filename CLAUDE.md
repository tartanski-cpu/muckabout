# muckshift

WebXR earthmoving sandbox for Meta Quest. Spec and milestones: `docs/mvp-spec.md`. Terrain design: `docs/terrain-design.md`. State and known gaps: `README.md`. What the owner checks on the headset: `docs/quest-test-checklist.md`.

- `npm test` (vitest), `npm run build && npm run test:e2e` (headless Playwright; one file: `node tests/e2e/run.mjs m5`). Screenshots land in `shots/`.
- Machines are data: change tuning and cab layout in `machines/*.json`, not in code. `src/vehicles/machine.js` is the one generic machine.
- Keep `window.__game` working (`sim`, `audit`, `machine`, `autopilot`, `play`): every browser test drives the game through it. `sim()` needs inline terrain (`?worker=0`).
- Volume must balance: anything that moves soil has to show up in `game.audit()`. The tests check it to 0.1 %.
- Sim code stays deterministic (fixed dt, seeded RNG, no `Math.random` in the sim; audio may use it).
- Draw calls are the Quest's main cost: merge static geometry (see `machine.js` visuals and `xr/controls/decor.js`); the budget is 150.
- Tests drive cab controls with fake hands (`input.setFake`) pinned to the cab; wait on frames and sim time, not wall-clock time (software GL is slow).
- `src/poc/loader.js` is the original proof of concept: a feel reference. Don't grow it.
- XR, interaction and net code follow SWVR's design (the owner's other WebXR game); its lessons are in the file headers.
- Nothing can be tested in VR from here. Say so rather than claiming it, and add what needs checking to `docs/quest-test-checklist.md`.
