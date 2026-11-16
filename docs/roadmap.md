# Muck About — roadmap after the MVP

The MVP (`docs/mvp-spec.md`, M0–M6) is a sandbox with one checklist job. This is the plan for turning it into a game. It is a sequence and a direction, not a spec: each chapter gets its own spec when it is next.

## The game in one line

**A wrecked, smoky valley becomes a green, self-powered one, and the machines change with it.**

One persistent valley, not a list of levels. Every job leaves a permanent improvement: a pad, a road, a drain, a bridge, a building, a planted bank. You start with dirty diesels on a spoil heap and finish with quiet electric diggers charged by your own dam, with a touch of steampunk in the end game. When the story is done the valley is yours as a free-build sandbox.

Out of the plan on purpose: money, fuel and wear. They add chores, not play.

## Who it has to entertain

| Player | What they want | What gives it to them |
|---|---|---|
| The owner | Physics and gameplay, sandbox | A new physical thing to handle every chapter; the sandbox handed back at the end |
| The mission perfectionist | Structure, missions, deep systems done properly | Job cards with a spec, a tolerance and a grade; systems that interlock (drainage protects the road, roots protect the banks, power gates the electric machines) |
| The realism one | Authentic behaviour, good looks | Correct procedures and machine behaviour; a transformation worth looking at; a higher-quality PC graphics tier |

## Players and platforms

Two groups play it:

- **Family:** two in VR, possibly three.
- **Friends:** the owner in VR and two friends on PC, both with top-end graphics cards.

So the targets are **three players in one valley** and **PC as a real way to play**, not a debug path. This changes the MVP spec's "VR only, no desktop controls". The host can be a PC or a headset.

## What every chapter needs

Three things the sandbox lacks, and each chapter should add to all three:

1. **A reason** to move soil (a job card).
2. **A measure** of how well it was done (a tolerance and a grade).
3. **A reaction** from the world afterwards (traffic, rain, growth, power).

And three rules that carry over from the MVP:

- Volume balances. Anything new that holds or changes soil (concrete, compaction, plants taking up topsoil) shows up in `game.audit()`.
- Draw calls stay under 150. Vegetation, buildings and placed parts are instanced or merged.
- New machines are data (`machines/*.json`) on the one generic machine.

Where each chapter is built on the map: `docs/valley-layout.md` (a 240 m valley around today's map, proposed).

## The sequence

| # | Chapter | New toy | What the valley gains |
|---|---|---|---|
| 0 | Headset check | none | Confidence in the frame budget |
| 0b | Three players, PC and VR | A proper PC seat, a third player | Everyone can turn up |
| 1 | Survey and grade | Grade overlay, job cards, scoring | A levelled pad and the site office |
| 2 | The road in | Roller, compaction, supply trucks | A road that holds; materials arrive |
| 3 | Rain | Storms, ditches, culverts, a pond | A valley that drains |
| 4 | Concrete and lifting | Setting concrete, placeable parts, a hook | Footings, a real bridge, first buildings |
| 5 | Green | Topsoil, seeder, trees, growth | Grass, held banks, an orchard |
| 6 | Power | Dam, turbine, cable, charging shed | Lights, the first electric digger |
| 7 | Self-sufficient | Steam shovel, electric fleet | No smoke, no deliveries; free build |

### 0. Headset check

Nothing has run on a Quest yet. Work through `docs/quest-test-checklist.md` before adding anything: the frame budget decides how much vegetation and how many placed objects later chapters can afford.

**Done when:** the checklist is ticked or its failures are fixed, and there is a measured headroom figure (frame time and draw calls in the stress scene on the headset).

### 0b. Three players, PC and VR

**Progress:**
- Done: three players. The host takes up to four and turns a fifth away; clients drop the figure of a player who has left. `tests/e2e/coop3.mjs`.
- Done: the mouse works cab controls and handrails through the VR interaction code. `tests/e2e/pc.mjs`.
- Done: a client's own machine is drawn ahead of the host's last word, by the measured round trip, and its boom, bucket, blade or bed moves with the lever at once (`src/net/predict.js`).
- Done: hand tools in co-op: one set, owned by the host; a client carries them and the host follows and digs (`tests/e2e/cooptools.mjs`).
- Done: carrying hand tools with the mouse: look at the ground to place them, walk to dig (`tests/e2e/pc.mjs`).
- Done: a start page that offers the PC and VR alike, and graphics tiers (Quest, PC with sun shadows, PC high) that change only the drawing (`tests/e2e/start.mjs`).
- Done: three players finish the MVP job together, the clients driving through their own inputs and one dropping out and back in on the way (`tests/e2e/coopjob.mjs`; road, crossing and most of the sand are shortcut as in `m5.mjs`).
- Not checked anywhere real: how the prediction feels over a real internet link, the shadow tier on a real graphics card, and three people on three devices.

Done early, because the friends cannot play at all without it, and every later chapter is cheaper if it is built for three players and two kinds of seat from the start.

- **Three players:** co-op is host plus one today (`src/net/session.js`). Grow it to host plus two, with the drop-and-rejoin tests (`tests/e2e/coop.mjs`, `tests/e2e/peer.mjs`) extended to three.
- **PC play path:** the desktop keys and gamepad exist for debugging. Make them a finished way to play: in-cab mouse look, every cab control reachable, on-foot hand tools usable, a start page that does not assume a headset. Cab controls stay the one source of truth, so PC input moves the same levers the VR hands do.
- **Client prediction:** a client's own machine responds about 0.15 s late today. Two of three players will be clients, so predict the local machine.
- **Hand tools in co-op:** the shovel, stakes and chain are not replicated yet; chapter 1's survey tools need them to be.
- **PC graphics tier:** a quality switch above the Quest's settings (real shadows, denser vegetation later, higher-resolution ground). The 150 draw-call budget is the Quest's; the PC tier may spend more, but the sim stays identical on both.

**Done when:** three tabs (one driven as VR with fake hands, two as PC) finish the MVP checklist job together in an e2e test, through drops and rejoins.

### 1. Survey and grade

The chapter the rest stand on. It builds the job and scoring framework every later chapter reuses.

- **Design surface:** a target shape for a patch of ground (a level pad, a ramp at a gradient, a ditch profile), drawn as a ghost with a cut/fill colour overlay in the ground shader.
- **Scoring:** percentage of the patch within tolerance, and volume over and under. Fast enough to show live.
- **Job cards:** grow the clipboard (`src/game/checklist.js`) from one fixed list into jobs with a spec, a tolerance, a grade and a result that is saved.
- **Survey tools:** the stakes and string line (`src/game/handTools.js`) become how a design is set out on foot; add a level to read height.
- **First job:** level a pad to ±5 cm. The site office appears on it.

**Builds on:** the string line, the checklist, the dozer's auto level, `save.js`.
**Done when:** a scripted dozer run grades a pad to tolerance in an e2e test and the score is asserted.

**Progress:**
- Done: `Design` (a level or sloping plane over a patch, scored for share on grade and volumes to cut and fill), drawn in the ground shader; the site-office pad job with its job card, grade, sign-off and office; the grading stakes read cut and fill. Saved and replicated. `tests/e2e/grade.mjs` grades the pad with a scripted dozer.
- Not yet: setting a design out on foot with the stakes (designs come with the job for now), more than one job of this kind, and a real board of jobs to choose from.

### 2. The road in

- **Roller:** a fifth machine, as a JSON file.
- **Compaction that matters:** the ground already compacts under wheels (`TerrainCore.compact`, counted in the audit). Make it a property jobs can measure: loose fill ruts and settles under traffic, rolled fill holds.
- **Road build-up:** sub-base then a gravel top, each to a thickness, rolled.
- **Traffic as the test:** scripted supply trucks (`src/game/autopilot.js`) drive the road. A good road gets them through; a bad one bogs them.
- **Reward:** deliveries start. Later chapters' materials (pipe, cement, precast parts, trees) arrive by that road.

**Done when:** a truck completes the road built to spec and fails on unrolled fill, both in tests.

### 3. Rain

The cheapest big win: the river and erosion are already there (`src/terrain/water.js`, `erosion` per material).

- **Storms:** rain as an event, with run-off that follows the ground and carries soil off bare slopes.
- **Drainage:** ditches cut to a fall, culverts under the road, a settling pond.
- **Trench and pipe:** dig to a fall with the backhoe, lay pipe, backfill, compact. (Pipes are the first placed objects; if chapter 4's object system is not ready, a pipe can be a terrain feature laid along a trench.)
- **The exam:** the storm arrives after the job is signed off. What you built either stands or washes out.

**Done when:** the same storm washes out an undrained road and leaves a drained one standing, in a test, with the audit balanced.

### 4. Concrete and lifting

The expensive chapter: the game has no placeable rigid objects yet.

- **Concrete:** a material that pours and slumps like mud, then sets hard. It fits the materials table (`src/terrain/materials.js`) plus a setting clock.
- **Placeable parts:** precast beams, culvert sections, wall panels as rigid bodies in the Rapier world, which then become static.
- **Lifting:** a hook and chain on the backhoe or loader (the tow chain in `handTools.js` is the starting point), later a crane.
- **Jobs:** dig and pour footings; build abutments and set a bridge deck to replace the mud-and-gravel crossing; raise the first buildings on finished pads.
- **Co-op role:** a banksman on foot guiding the lift.

**Needs:** placed objects in the save and in the co-op snapshot.
**Done when:** a bridge built by script carries the dumper across, survives a storm, saves and reloads.

### 5. Green

- **Topsoil and seed:** spread topsoil to a depth, seed it with a tractor and seeder (a machine file).
- **Growth:** grass creeps over ground left undisturbed. The ground already tracks disturbance per cell for colour (`dist` in `src/terrain/core.js`); growth is its inverse.
- **Roots hold soil:** planted ground resists erosion, so planting is engineering, not just decoration. Bare banks from chapter 3 are the motive.
- **Time away:** the site is saved, so growth advances between sessions and you come back to find it changed.
- **Trees, a pond, wildlife** as the reward layer. All instanced.

**Done when:** a planted bank loses measurably less soil in the storm test than a bare one, and growth is deterministic from the save.

### 6. Power

- **Dam and turbine** on the river: an earth dam is a grading, compaction and drainage job in one, so it tests everything so far.
- **Cable:** trench, lay, backfill from the turbine to the yard.
- **Charging shed and lights:** the yard lights up at dusk.
- **Electric machines:** a different powertrain behind the same machine (`src/vehicles/powertrain.js`): instant torque, no smoke, a motor whine in place of the diesel. Sound follows the model, as now.

**Done when:** an electric loader passes the same dig-and-load tests as the diesel one, and its voice is covered in `audiolab`.

### 7. Self-sufficient

- **Steam shovel:** the steampunk machine. A boiler whose pressure has to be built and kept, as a third powertrain.
- **Electric fleet:** the diesels are retired one by one.
- **Closing the loop:** the valley supplies itself (quarry, sawmill, power), so the supply trucks stop.
- **Free build:** every tool, machine and part unlocked in the finished valley.

## Order, and why

- 0b before any content because it decides who can play, and retrofitting a third player and a PC seat onto finished chapters costs more.
- 1 first of the content because jobs and scoring are the framework for everything.
- 2 and 3 next because they lean on what exists (compaction, erosion, autopilot), so the game deepens quickly.
- 4 after the cheap wins because placeable objects are new work.
- 5 after 3 because rain gives planting a purpose.
- 6 and 7 last because the dam needs every earlier skill, and the clean machines are the reward the arc has been pointing at.

## Open questions

- **Four players?** Three is the target. Whether family and friends ever play together decides if four is worth designing for.
- **Jobs for three:** which jobs need a third pair of hands (banksman, surveyor, second haul truck) and which just go faster.
- **How much story?** Job cards alone, or a character handing them out.
- **Does time pass while away in real time, or per session?**

## Not testable from here

Everything above that is felt (control reach for new cabs, lifting by hand signals, the electric and steam voices in the headset) needs adding to `docs/quest-test-checklist.md` as each chapter is built.
