# Muck About

A WebXR earthmoving sandbox for standalone Meta Quest: drive machines from inside the cab with physical levers and wheels, on fully deformable ground. Spec and milestones: [docs/mvp-spec.md](docs/mvp-spec.md).

**State: M0–M6 are implemented and pass their automated tests on a desktop. Nothing has been run on a headset yet.** What to check on the Quest is listed in [docs/quest-test-checklist.md](docs/quest-test-checklist.md); known gaps are at the end of this file.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm test           # unit tests (vitest): terrain, river, machines, net codec
npm run test:e2e   # scripted headless browser runs (needs `npm run build` first; screenshots in shots/)
```

On a Quest, open the GitHub Pages URL in the Quest Browser and press *Enter VR*. For local iteration, WebXR needs HTTPS or localhost: with the headset on USB, `adb reverse tcp:5173 tcp:5173` and open `http://localhost:5173` in the headset.

`.github/workflows/ci.yml` builds and tests every push and deploys `dist/` to GitHub Pages from the repository's default branch (Settings → Pages → Source: GitHub Actions).

Pages and switches:

| URL | What |
|---|---|
| `/` | the game: full map, river, four machines |
| `/?physics=rapier` | start on the Rapier vehicle model instead of the custom one |
| `/?stress=1` | the same with scripted drivers on all four machines and the clod budget held full |
| `/?map=test` | small 40 m test patch (no river) |
| `/?worker=0` | terrain on the main thread instead of the worker (what the tests fast-forward) |
| `/?host=1` · `/?join=12345` | two-player co-op; add `&net=bc` to link two tabs of one browser without the internet |
| `/?scene=stress` | terrain-only stress scene (ghost buckets) |
| `/poc.html` | the original proof of concept |

## Two vehicle models, switchable

Every machine can run on either of two models, and you can flip between them while driving to compare:

- **Custom** (the default): the proof of concept's hand-written approach, extended to all four machines. Speed and heading are integrated directly (articulated, front-steer or skid-steer), and the chassis rides a plane fitted through the ground under its wheels with a little suspension lag. Nothing bounces, tips over or fights a solver. Machines stop dead against each other rather than shoving.
- **Rapier**: rigid bodies with spring suspension and tyre forces. Machines can pitch, roll over, push each other and get stuck.

Switch: seated in VR, click the **left stick**; on desktop press `M`. The dash display shows which is active. `?physics=rapier` starts on Rapier. Hydraulics, digging, containers, sound and controls are identical in both.

## Playing

You start on foot in the yard. Walk with the left stick, snap-turn with the right. Grab a machine's yellow handrail to climb in.

Everything in the cab is physical: reach, squeeze the grip, move your hand. The glove snaps to the handle while you hold it. Buttons and rockers are poked (or trigger while touching).

- **Pedals:** feet aren't tracked, so while a hand is on any control its trigger is a pedal: right = accelerator, left = brake (decelerator on the dozer). There's a placard in each cab.
- **To move off:** turn the key (grab it and twist clockwise, or grab and let go), poke the park brake off, push the shuttle lever to F, squeeze the right trigger.
- **Buttons:** `Y` get out · `B` recentre seat · `A` horn · `X` perf HUD (left wrist) · right stick click (seated) horizon lock · left stick click (on foot) stress test.
- **Stick assist** rocker on the dash (off by default) lets the thumbsticks drive.

| Machine | Controls |
|---|---|
| Wheel loader | steering wheel · loader joystick (back: raise, left: curl) · R/N/F shuttle · hand throttle · park brake · key |
| Dumper | steering wheel · shuttle · hand throttle · tipper lever (back: raise) · park brake · key |
| Bulldozer | two track levers (spring to neutral) · blade joystick (back: raise, sideways: tilt) · hand throttle · left trigger decelerator · key |
| Backhoe | front: wheel, shuttle, loader joystick · swivel-seat rocker → rear: two hoe joysticks (ISO: left = swing/dipper, right = boom/bucket), two stabiliser levers |

The job is on the clipboard in every cab: cut a road down the terraces, build a crossing (mud for bulk, gravel on top; mud alone washes out), get the dumper and loader across, haul 20 m³ of sand back to the hopper.

**Desktop debug keys:** `1`–`4` take a seat · `Q` get out · `Enter` ignition · `P` park brake · `W` `A` `S` `D` drive · `Space` brake · `T`/`G` throttle · `I` `K` `J` `L` hydraulics · `B` swivel (backhoe; then `W` `S` `A` `D` `I` `K` `J` `L` work the hoe, `N`/`M` legs) · `V` chase view · `R` reset machine · `X` stress test · `F` perf HUD · `O` horizon lock · drag to look.

**Two players:** one presses *Host a game* on the start page and reads out the five-digit room number; the other types it and presses *Join*. The host's headset runs the world; the other player sees it about 0.15 s behind. First into a seat owns that machine.

## Light and effects

- **Time of day**: golden hour by default, with day and dusk to switch to (`N` on desktop; on foot in VR, click the right stick). Each sets the sun, sky light, haze, a sky dome with sun glow and thin cloud, and how brightly lamps burn.
- **Machine lighting**: a soft pool of shade under each machine (drawn in the ground shader, not shadow maps), headlamp pools on the ground and glowing lamps at dusk, flashing beacons.
- **Effects** (`src/game/effects.js`, one instanced draw call): exhaust smoke that goes thick and black when the engine labours or is revved, with a cough on start-up; dust off tyres and tracks on dry ground, where a tool is cutting and where tipped material lands; white spray in the river; mud flung from a spinning tyre.

## The machine models

`tools/build_visuals.py` writes each machine's look into its JSON: 150–200 painted boxes and cylinders per machine, merged at load into one mesh per moving part, so detail costs almost nothing in draw calls. On top of that:

- **Pixel paint** (the style of SWVR's interiors: 64 px tiles at 64 px per metre, crisp): panel seams, rivets, scratches, tread plate, hazard stripes, louvred vents, maker's plates, warning labels and an instrument cluster, with rust blooms and streaks in patches and site mud thrown up over the lower panels.
- **Working hydraulics**: every ram is drawn stretched between its two mounting points each frame, so cylinders extend and swing with booms, buckets, blade, bed, legs and steering (two draw calls for all of them).
- **Running tracks**: the dozer's grouser pads travel round the track loop at track speed.

`node tools/gallery.mjs [machine]` takes outside and cab screenshots after a change.

## How it is built

```
machines/*.json          one file per machine: masses, geometry, hydraulics, tools, containers, cab control layout
src/terrain/             core.js (layered heightfield, relaxation, cut/deposit/compact), water.js (river + erosion),
                         containers.js, clods.js, tool.js, maps.js, worker.js, client.js (worker / inline / remote)
src/vehicles/            physics.js (Rapier world), machine.js (generic machine from a definition)
src/xr/                  input.js, interaction.js, hands.js, player.js, controls/ (lever, joystick, wheel, key, …)
src/render/              ground.js (height-texture displaced tiles), chips.js, water.js, clodMesh.js, containerMesh.js
src/audio/               diesel AudioWorklet, per-machine positional voices, hydraulic clunk/clank detection
src/net/                 transport.js (PeerJS / BroadcastChannel), terrainDelta.js, snapshot.js, session.js, avatar.js
src/game/                app.js (loop, perf, audit), autopilot.js (scripted drivers), hopper.js, checklist.js
src/scenes/              play.js (the game), stress.js (four-machine stress), ghostStress.js (terrain-only stress)
src/harness/             perf timers and the wrist HUD
src/poc/                 the original proof of concept
docs/terrain-design.md   data layouts, worker protocol, budget plan
```

Key decisions:

- **Ground** is a layered heightfield owned by a worker; material is only ever particles while airborne. Volume is audited end to end (ground + containers + clods + lost + compacted + washed) and the tests hold it constant.
- **Machines** have two interchangeable vehicle models (above). In the Rapier one they are rigid bodies; the ground is not a Rapier collider. Wheels and track contact points sample our terrain and apply spring and tyre forces. Articulated machines are two bodies and a motorised hinge. Booms, buckets, blades and beds are kinematic parts posed by hydraulic functions, with colliders that ride their body.
- **XR kit** follows the design of SWVR's controls (see file headers); it is a port, not a copy, because SWVR's files are tied to its vessel state.
- **Co-op** is host-authoritative: terrain deltas (changed cells, 1 cm, run-length), machine states at 20 Hz, cosmetic clods on the client.

`window.__game` is the test surface: `sim(n, fn)` fast-forward (inline terrain only), `audit()`, `machine(id)`, `autopilot`, `play` (player, input with fake hands, checklist, hopper, net).

## Known gaps and deviations from the spec

- **Not run on a Quest.** Frame rate, control reach and placement, hand fit and comfort are untested. Desktop numbers for the stress scene: terrain worker ≈ 0.6 ms a tick, main-thread sim ≈ 2 ms a frame, ~75–150 draw calls, ~230k triangles.
- **Co-op over the internet is untested.** The session logic is tested between two browser tabs; the PeerJS link (public broker, default STUN/TURN) cannot be reached from the build machine. A client's own machine is not predicted locally, so it responds about 0.15 s late.
- **Workboat World / SWVR code** could not be copied as-is (Workboat World is Godot; SWVR's controls depend on its vessel state). The interaction rules, grab maths, haptic values, locomotion numbers and network model are ported from SWVR. The avatar is a simple head, body and gloves.
- **Booms, buckets, blades, beds** are kinematic parts, not Rapier joints with motors. Only the articulation hinge is a real joint.
- **`diesel.dsp`** was not in the handover; the engine is a new AudioWorklet synth, and all sound is placeholder.
- A held control lets go if your real hand strays more than 45 cm (the spec asks for a tolerance; SWVR never lets go by distance). Change `REACH.breakAway` in `src/xr/interaction.js`.
- The scripted loader-fills-dumper run is tuned on the Rapier model; on the custom model the loader fills the bed (better, in fact) but the scripted dumper does not finish its return trip because machines block rather than nudge each other.
- Not built: teleport locomotion, the WebGPU compute spike, particle slosh inside the bucket, control-ownership hand-off messages beyond "seat taken".
- The hoe bucket only cuts when its floor is more than ~7° off vertical, so stabbing straight down does nothing until you start to curl.
