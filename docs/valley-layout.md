# The valley: layout proposal

A proposal to mark up, not a decision. It places everything the roadmap (`docs/roadmap.md`) needs on one map, so the chapters can be built where they will stay. Numbers in brackets are roadmap chapters.

![Valley layout sketch](valley-layout.svg)

## Size and shape

- **240 × 240 m**, four times today's ground, at the same 0.25 m cells. North at the top: the ground falls from hills about 25 m high in the north to river flats in the south.
- **Today's 120 m map sits in the middle, unchanged:** the yard at 9 m, the terraces, the river, the ford and the sand site keep their coordinates. Saved sites, tests and scripted drivers that use today's map keep working.
- Coordinates as in the code: x runs west to east, z runs north to south, both from −120 to 120.

Why this size: it fits every chapter with room between them, so each job feels like a separate place on the walk or drive between them. It also stays within what the engine was measured to carry (below). Bigger is possible, but every extra metre is ground nobody works.

## What goes where

| Area | Where (x, z) | Chapter | What it is for |
|---|---|---|---|
| Yard and office pad | today's, about (0, −45) | 1 | Machines, hopper, site office on its levelled pad |
| Road in | east edge (120, −46) to the yard (58, −46) | 2 | A rough track to build up, roll and open to supply trucks |
| Gully | across the road near (90, −45) | 3 | Run-off from the woodland crosses the road: a culvert job |
| Old tip and ruined pond | south-west, (−110…−40, 50…110) | 3, 5 | Rubble and a silted pond: drainage, then a clean pond |
| River | across the whole valley, z ≈ 20 | 3, 4 | Today's river, carried on to both edges |
| Bridge site | (30, 18), a narrow, firm-banked reach | 4 | Abutments, footings, a deck lifted on; replaces the ford |
| Spoil heaps and scrub | south-east, (40…110, 40…110) | 5 | The "horrible place": bare, poor soil to topsoil, seed and plant as an orchard |
| Stream | from the dam (−62, −88) down the west side to the river at (−60, 20) | 3, 6 | Carries water past the terraces; erodes them until drained |
| Dam site and reservoir | north-west, dam at (−62, −88), water behind it to (−62, −100) | 6 | An earth dam: grading, compaction and drainage in one job |
| Turbine house | below the dam, (−66, −78) | 6 | Power; a cable trench from it to the yard, about 100 m |
| Quarry | west, (−118…−86, −70…−38) | 7 | A rock face: stone for roads and the bridge, so deliveries can stop |
| Woodland and sawmill | north-east, (60…110, −90…−55) | 7 | Timber; the trees also shed the gully's water |

## How it starts, and how it ends

- **At the start it is a mess:** the tip, scrub and spoil heaps in the south, a silted pond, bare and gullied banks, and the stream running wild down the west side. Today's yard is the one tidy corner.
- **By chapter 7:** a road in, a bridge, drained slopes, a clean pond, an orchard on what were spoil heaps, a dam and turbine, electric machines charging in the yard, and the quarry and sawmill supplying everything.

## What the engine can carry

Measured on a 240 m test map (`?map=xl`: today's layout on four times the ground), desktop software rendering. These show how cost scales, not Quest frame rates.

| | 120 m today | 240 m |
|---|---|---|
| Draw calls, standing in the yard | 100 | 136 (budget 150) |
| Triangles, standing in the yard | 287k | 363k |
| Terrain simulation per tick | under 1 ms | under 1 ms (untouched ground costs nothing) |
| Load to first frames | 3.2 s | 4.5 s (mostly the river settling at start-up) |
| Save, and a newcomer's download in co-op | 0.6 MB | 0.6 MB (only worked ground is kept and sent) |

The engine changes behind those numbers: far ground drawn in fewer, coarser meshes (`src/render/ground.js`), saves holding only the chunks changed since the map was built (`TerrainCore.snapshot`), and co-op joins measured from the map as built.

## Work still needed before the valley can be built

1. **Water in more than one place.** Today the water simulation runs in one band along the river. The stream, the reservoir and the pond need either several bands or a sparse grid that only runs where there is water.
2. **The scenery has to follow the map's size.** The backdrop and tree ring are placed for the 120 m map.
3. **Rock.** The quarry needs a hard material that only breaks with ripping or blasting. `ROCK` exists as a material but nothing digs it yet.
4. **Map building as layers.** One function builds today's map. The valley is better built from named features (hills, stream, river, pads, tip), so each chapter can adjust its own area without touching the rest.
5. **The river warm-up.** About 1 s of start-up for every 60 m of river. If it grows with the stream and reservoir, cache the settled water.

## Questions for you

- **Size:** is 240 × 240 m right, or do you want a longer, narrower valley (say 320 × 180) so the drive from the road in to the dam feels like a journey?
- **Shape:** north-to-south fall, a river across the bottom and a stream down the side: does that match what you picture? Is there a real place you have in mind?
- **Height:** hills about 25 m above the yard give a view from the top. Higher looks better in VR but makes the roads harder.
- **Order:** should the bridge (chapter 4) come before the orchard (chapter 5), so the south side is reachable without the ford?
- **Two groups, one valley?** Should family and friends have separate saved valleys, or share one?
