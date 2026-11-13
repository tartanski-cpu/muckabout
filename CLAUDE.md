# muckshift

WebXR earthmoving sandbox for Meta Quest. Spec and milestones: `docs/mvp-spec.md`. Work proceeds one milestone per session; check the README for the current milestone.

- `npm test` (vitest), `npm run build && npm run test:e2e` (headless Playwright run, screenshots in `shots/`).
- `src/poc/loader.js` is the original proof of concept: a feel/tuning reference. Don't grow it; new architecture goes in new modules.
- Keep the `window.__game` test surface (`sim`, `pause`, `volume`) working: the e2e test and the volume-conservation checks depend on it.
- Sim code must stay deterministic (fixed dt, seeded RNG, no `Math.random` in the sim).
- Every subsystem reports its time through `PerfMonitor` (`src/harness/perf.js`) so it shows on the wrist HUD.
- The Quest stress run at the end of each milestone can only be done by the user on a headset; say so rather than claiming it.
