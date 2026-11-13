# muckshift — MVP spec

**What it is:** a WebXR earthmoving sandbox for standalone Meta Quest. You drive real-feeling machines from inside the cab, using physical levers and wheels, on a small patch of fully deformable ground. Players: David and his son, in VR only. No desktop controls (keep a debug-only keyboard path for development).

**Starting point:** the muckshift proof of concept (`src/poc/loader.js`). It proved the fun: a wheel loader on a heightfield, a slumping rule, flying clods that turn back into ground, haptics, and procedural sound. Treat it as a reference for feel and tuning, not as the architecture. The MVP is a rewrite with a proper structure.

> Note: the spec refers to a `src/diesel.dsp` AudioWorklet engine sound. It was not in the POC archive handed over; the POC's audio is plain WebAudio oscillators inside `loader.js`.

## 1. MVP definition (what "done" means)

A ~120 × 120 m hand-built map, laid out like the Dirt Town demo:

| Area | Purpose |
|---|---|
| Starter yard (top terrace) | Machines parked, a hopper/stockpile to deliver sand to, a gravel stockpile |
| Three terraces stepping down | Steep banks (~2–3 m) that you must cut ramps through |
| River at the bottom | ~6–8 m wide, ~1 m deep, flowing; no crossing at start |
| Sand site across the river | Deep sand deposit to dig |

The MVP loop, as a checklist on a clipboard in the cab:

1. Cut a road from the yard down the terraces to the river (dozer / loader).
2. Build a crossing: fill the river with mud for bulk and gravel for a top that holds. Mud alone washes away (see §3.6).
3. Drive the dumper and loader across to the sand site.
4. Load the dumper with sand, haul it back, and tip it into the yard hopper (target, say, 20 m³).

Four machines (blocked out at first, readable silhouettes, low-poly style):

- **Wheel loader:** articulated steering, boom and bucket (port from the POC).
- **Articulated dump truck (dumper):** articulated steering and a tipping bed.
- **Bulldozer:** tracks with skid steer, blade lift and blade tilt.
- **Backhoe loader ("JCB"):** front loader bucket, rear backhoe (boom, dipper, bucket, slew), stabiliser legs, and a seat that swivels between front and rear controls.

Out of MVP: economy, missions beyond the checklist, day/night, weather, multiplayer (but see §6: design for it now).

## 2. Platform & stack

- WebXR + three.js + WebGL2. Quest Browser's WebGPU-in-WebXR is still marked experimental (2026 release notes), so WebGL2 is the shipping target. Keep the terrain sim renderer-agnostic so a WebGPU compute path can be swapped in later (§3.8).
- Vite, ES modules, TypeScript optional (recommended for the terrain core).
- Rapier (WASM) for vehicle rigid bodies and joints (articulation hinge, tipper bed, backhoe linkages) and vehicle-to-vehicle and vehicle-to-object contacts. Do not use Rapier's heightfield collider for the ground: it can't be updated in place. Wheels and tracks talk to our own terrain via raycasts (§4).
- Deploy: GitHub Pages via Actions (static, HTTPS). If SharedArrayBuffer is needed, use the coi-serviceworker trick for cross-origin isolation. Otherwise use transferable ArrayBuffers.
- Reuse from Workboat World: the avatar system, elastic hands, grab system and haptics helpers. Copy them into `src/xr/` with a thin adapter, don't share a package yet. Note where they came from in the file headers.

## 3. Terrain & material engine (the core: give this the most effort)

Goal: Dirt Town-quality ground behaviour at 72 fps on Quest 3, with 3–4 machines working at once. The approach is a layered heightfield + granular relaxation + transient particles + container heightfields. Particles exist only while material is airborne or pouring. Everything at rest is heightfield.

### 3.1 Data model

- World grid at 0.2–0.25 m cells, split into 32×32-cell chunks. Each chunk is asleep until touched.
- Per cell, a small layer stack (top first), up to 3 layers: `{material, thickness}` above an immovable bedrock height. Materials: topsoil/grass, mud, clay, sand, gravel, rock (rock = bedrock-like, rippable only later).
- Per material table: density, angle of repose (dry / underwater), dig resistance, compaction factor, erosion resistance, colour/texture ID, chip type.
- Separate arrays: water (per cell, coarser 0.5 m grid is fine), disturbed (for colour), compaction.

### 3.2 Granular relaxation

- Same idea as the POC (slump toward the angle of repose, 4 neighbours + diagonals), but:
  - only on awake chunks, using a dirty-cell work list, not full chunk sweeps;
  - material-aware: only the top layer flows, at its own angle; sand flows readily, clay holds steep cuts;
  - lower angle of repose underwater (submerged slopes flatten);
  - chunks go back to sleep when the total moved mass drops below a threshold.
- Runs in a Web Worker (`terrainWorker`) at a fixed 30–60 Hz, decoupled from render.

### 3.3 Tools ↔ terrain (cut / push / fill)

A generic tool shape API that every machine uses: bucket floor, cutting edge, dozer blade, tracks, tyres.

- A cutting edge removes material in its swept volume this frame (not just its current footprint). That avoids tunnelling at speed.
- Removed volume goes to the tool's container if it has one and has capacity (bucket). Otherwise it's pushed: deposited in a windrow ahead of or beside the edge. This is how the dozer works.
- Returns a resistance force per tool, fed to Rapier as an opposing force on the chassis (bogging down) and to haptics plus audio (engine lugging).
- Tyres and tracks: small compaction plus rut depth on soft materials, sinkage, and traction that depends on material and slope (mud is slippery, gravel grips). This is what makes the gravel-topped crossing matter.

### 3.4 Containers (bucket, dumper bed, hopper)

- Every container is a tiny local heightfield in the container's own frame (e.g. 12×8 cells for a loader bucket, 24×12 for the dumper bed). It slumps with the container's tilt, so a heaped bucket looks heaped and a tipped bed pours from the low edge.
- Moving vehicles carry their container heightfields with them at zero cost.
- Transfer between any two heightfields (world ↔ bucket ↔ bed ↔ hopper) happens only through clods (§3.5). One mechanism, conserved volume.

### 3.5 Clods (transient particles)

- Spawn when material leaves a container edge or is flung by a tool. Each clod carries `{material, volume}`.
- Ballistic motion, cheap ground and container collision (sample the target heightfield), no clod–clod collisions. On landing, deposit into whichever heightfield it hit (world or a container). Budget 1,500 live clods; above that, deposit early.
- Render as one InstancedMesh per material with a few chunky low-poly shapes and per-instance tint.
- Optional later: a small position-based-dynamics pile (≤300 particles) only inside the active bucket, for slosh. Only if the budget allows.

### 3.6 Water (MVP-simple, gameplay-relevant)

- River = water level per cell on a 0.5 m grid with a fixed inflow upstream and an outflow downstream. A simple virtual-pipes shallow-water step at low resolution (≤ 64×240 cells) is fine.
- Erosion rule: material in flowing water is slowly carried downstream at a rate based on its erosion resistance (mud high, gravel low). Result: a mud-only crossing washes out over a few minutes, and a gravel-capped one holds. Exact numbers are tuning.
- Render: one translucent water surface mesh with a flow-scrolling normal map. No refraction.

### 3.7 Rendering the ground

- Chunk meshes with heights in a texture (R16F/R32F). The vertex shader displaces a static grid, so edits are `texSubImage2D` on dirty rows only and there's no geometry rebuild.
- Per-cell material/disturbed info in a second texture. Triplanar-ish colour per material, darker when disturbed, wet darkening near water.
- Surface detail = instanced "chips" (rock shards for gravel, clumps for mud, grass tufts on topsoil), scattered by a hash of cell + material and regenerated per chunk when it changes. That gives the Dirt Town gravel look.
- Two LOD levels: the near work area at full resolution, far terraces at half.

### 3.8 Performance budget (Quest 3, 72 Hz, 13.9 ms frame)

| Item | Budget |
|---|---|
| Terrain worker | own thread, ≤ 6 ms per tick at 30–60 Hz |
| Main-thread sim (Rapier + vehicles + clods) | ≤ 3 ms |
| Terrain upload (texSubImage) | ≤ 0.5 ms |
| Draw calls | ≤ 150; tris ≤ 400k |
| Audio DSP | AudioWorklet (already ~2% of a desktop core) |

- Build an on-device perf HUD (wrist panel: per-subsystem ms, clod count, awake chunks) and a stress scene: 4 machines working, 1,500 clods, river flowing. Every milestone ends with a stress-scene run on the Quest.
- Spike, not dependency: a WebGPU-compute version of relaxation and clods behind a flag, for when the Quest browser's WebGPU-in-XR is stable.

### 3.9 Tests

- Unit tests for volume conservation: total material across world + containers + clods + "lost at map edge" must be constant within 0.1% after scripted dig/dump sequences. The POC already shows how.
- Deterministic sim step (fixed dt, seeded RNG) so tests and future multiplayer replays line up.

## 4. Vehicles

- Rapier rigid-body chassis. Raycast wheels (suspension spring/damper, tyre friction depending on material and slope) against our terrain. Tracks = 6–8 contact rays per side, skid steer. Articulated machines = two bodies + revolute joint driven by a hydraulic "motor" with a rate limit.
- Hydraulic functions = joint motors with rate limits, end stops and load-dependent speed. Engine RPM sets max flow, so revving makes hydraulics faster, like the real thing. End stops produce the clank, relief squeal and haptic thump already prototyped.
- Collisions: chassis, bucket and blade colliders vs other machines and static props (hopper, bridge planks later).
- Per-machine tuning lives in a data file (`machines/*.json`): masses, geometry, hydraulic rates, control layout.

| Machine | Cab controls (all physical, grab with grip) |
|---|---|
| Wheel loader | Steering wheel, 2-axis loader joystick, F/N/R shuttle lever, hand throttle, park brake, ignition key |
| Dumper | Steering wheel, shuttle lever, hand throttle, tipper lever, park brake, key |
| Bulldozer | Two track levers or a steering joystick, blade joystick (lift + tilt), hand throttle, decelerator, key |
| Backhoe | Front: wheel, shuttle, loader joystick. Seat swivel lever → rear: two backhoe joysticks (ISO pattern), stabiliser levers, slew. Key |

- Accelerator/brake: feet aren't tracked, so use the controller triggers as pedals whenever a hand is on the wheel or a lever (right = accelerator, left = brake). Hand throttle lever for working RPM. Document this clearly on a cab placard.
- Thumbsticks: not the primary control. Keep stick-driving as an optional "assist" toggle on the dash, off by default.

## 5. XR, avatar, interaction

- Port the avatar + elastic hands from Workboat World. When a hand grabs a control, the visual hand snaps to the control's handle and stays there while the real controller drifts within a tolerance. Release past that tolerance, or on grip release.
- Control kit (`src/xr/controls/`): Lever1D (with detents, e.g. F/N/R), Joystick2D (spring return, optional ISO decal), SteeringWheel (multi-turn with spin knob, either hand), Key (turn to start → engine crank sequence), Button, Toggle. Each has haptic ticks on detents and a value output. Machines bind control outputs to functions in their JSON.
- Getting in and out: walk around (smooth locomotion + snap turn, teleport optional for comfort). Grab the cab handrail to climb in, and the seat snaps you to the eye point. Recentre seat button on the dash.
- Comfort: cab frame always visible. Optional "horizon lock" comfort setting that damps cab roll/pitch.
- Clipboard with the MVP checklist, mounted in each cab and grabbable.

## 6. Multiplayer: decide now, build later

David and his son will want to play together, each in their own headset. Even if it ships in a later milestone, structure the code for it from day 1:

- Host-authoritative terrain. The host runs the terrain worker. Clients receive compressed chunk deltas (changed cells only, quantised heights, RLE) at ~10 Hz, plus clod spawn events (clients simulate clods cosmetically and the host's deposit is the truth).
- Vehicles: the host owns physics. Clients send control inputs and get interpolated vehicle states. A player "owns" the machine they're seated in for low-latency feel (client-side prediction of their own machine).
- Reuse Workboat World's networking layer if it fits this model.

## 7. Audio

- Keep the diesel.dsp AudioWorklet approach, one instance per machine with its own engine character (cylinders, idle RPM, exhaust resonances), positional via a PannerNode per machine.
- Add: track clatter for the dozer (rate from track speed), reverse beepers, dumper tipping ram, gravel vs sand vs mud dig textures, river ambience.

## 8. Milestones (one Claude Code session each; each ends with a Quest stress test)

| # | Milestone | Done when |
|---|---|---|
| M0 | Repo + harness | Vite, Pages deploy, on-device perf HUD, POC loader still drivable, debug keyboard path |
| M1 | Terrain engine v2 (§3.1–3.5, 3.7–3.9) | Worker sim, layered materials, containers, clods, chips; conservation tests pass; stress scene ≥ 72 fps on Quest 3 |
| M2 | XR kit: avatar, elastic hands, control kit; loader rebuilt on Rapier with physical controls | Drive and load using levers and wheel only |
| M3 | Dumper + dozer | Loader fills dumper, dumper tips; dozer cuts a ramp down a terrace |
| M4 | Backhoe | Seat swivel, stabilisers, digs a trench |
| M5 | Map + river + erosion + checklist | Full MVP loop playable start to finish |
| M6 | Two-player co-op (§6) | Two Quests, one world |

Model guidance: use the strongest model available for M1 (and the physics parts of M2). That's where efficiency comes from algorithm choice, not polish. Ask it to write a short `docs/terrain-design.md` before coding, with data layouts, the worker message protocol and the budget plan, then implement.

## 9. Reference

- Proof of concept: `src/poc/loader.js` (feel/tuning reference), `tests/e2e/poc.mjs` (scripted headless test with a fast-forward `__game.sim()` hook; keep this pattern).
- Visual reference: Dirt Town (Steam): chunky low-poly, warm dirt palette, instanced gravel chips, terraced level layout, clipboard checklist.
