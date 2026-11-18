# Soil round a dozer blade: what is wrong, how real soil behaves, and the plan

Status: plan, not built. Measuring tools: `node tools/bladeprobe.mjs [flat|trench|pile]` (headless, numbers) and
`npm run build && node tools/bladeshots.mjs [tag]` (screenshots into `shots/`).

## 1. What happens now (measured, November 2026)

Owner's report from the headset: the bow wave and particles are good on virgin flat ground. Dig in deeper and the
"voxel" dirt thrown to the sides lands too far out, as tall mounds. Drive into soil that is already heaped and the
particles are thrown far out in front, as if hitting the pile set off the wrong effect.

`tools/bladeprobe.mjs` (test map, custom physics, dozer at 0.8 track lever) confirms both, and finds why:

| Case | What the probe shows |
|---|---|
| Virgin flat ground, the first ~1.5 s | All the cut soil is heaped 0.7 m ahead of the lip; granules within ~1 m of the blade. This is the part that looks right. |
| Blade held down (it dives: 0.74 m down after 1.7 s, 2.5 m after 5 s) | Once the soil ahead stands 0.9 m above the edge, 98–100 % of what is cut is put 1.9 m **past the blade end**, all at one spot. Berms of +2.4 m stand as cones ~4 m from the centre line. |
| Into a standing ridge of pushed soil, 1.7 m high | Granules run up to 4.2–4.5 m ahead of the blade, **faster than the blade** (1.9 m/s against 1.7); a quarter of them are more than 2 m ahead. Half the cut soil is thrown 2.0–2.2 m to the sides. The dozer hardly slows (never below 1.1 m/s) and drives up and over the ridge. |

Causes, in the code:

- **Side spill is teleported.** `TerrainCore.cut` (`src/terrain/core.js`): when the ground at the windrow point stands more
  than `heap` (0.9 m) above the cutting edge, every bit of soil cut that step is deposited at one point beside the
  nearer blade end, 0.55 m out, or `SPILL_CLEAR` (1.6 m) beyond a wall if it finds one. In a cut deeper than 0.9 m the
  *untouched face ahead* counts as heap, so it all goes there. `SPILL_CLEAR` was added (597ed64) because spill left on
  the lip of a trench slumped back in behind the blade and the cut levelled off ~1 m down.
- **The granules take the whole pile for the pushed heap.** `PushHeap` (`src/render/pushHeap.js`) calls any disturbed
  ground standing 7 cm above the cut floor "heap", looks up to 3.4 m ahead for its toe, seeds granules anywhere on it,
  and rolls the surface forward at 1.1–1.5 × blade speed out to that toe. On a heap the blade made itself that is
  about right; on a standing pile the whole pile qualifies, so it is set "flowing" end to end. The owner's guess was
  close: the impact itself does nothing, but the pile is mistaken for the moving heap.
- **Resistance only counts soil being cut**, `Σ volume × dig` per step, including soil that is re-cut every step as
  the heap is shoved along. The weight of the load being pushed, and the much deeper face a pile presents, are not in
  it, so hitting a pile does not bog the machine down.
- Every transfer is a point deposit (4 cells), so spill builds needle cones that relaxation then has to flatten.

Screenshots: `shots/before_pile_*.png` (granules carpet the whole ridge, the dozer climbs it),
`shots/before_deep_*.png` (cones beside the trench).

## 2. How real soil behaves round a blade

From a research pass (engineering literature, Army and Cat operating doctrine, and real-time soil simulators). [S] =
sourced, [D] = derived from sourced formulas, [G] = judgement. Sources are listed at the end.

**The cut and the moving wedge.**
- [S] Ahead of a blade the soil fails along a plane rising from the cutting edge at about 45° − φ/2 (φ = friction
  angle, ~30–40° for soil).
- [S] The block above that plane moves with the blade (McKyes; fundamental earthmoving equation, FEE). It reaches
  d·(cot ρ + cot β) ahead along the surface, with d the cut depth and ρ the blade's rake.
- [D] That is about **1.7–2.5 × the cut depth**: a 20 cm cut disturbs the ground 35–60 cm ahead, 1.5–2.5 of our cells.
- [S] The soil beyond the wedge does not move. A dead zone sits at the cutting edge.

**The heap (surcharge).**
- [S] Cut soil builds a heap against the blade. Its front face is straight, at the dynamic angle of repose (sand and
  soil 35–36° in Sauret et al.'s plate-bulldozing experiments). The toe moves with the blade, and the face avalanches
  steadily rather than in lumps.
- [S] The heap grows until it is **as high as the blade**, and from then on spills at the rate it is fed
  (Rubinstein/Shmulevich; Servin et al.).
- [S/D] Rated capacity of a straight blade is 0.8·W·H² (ISO 9246, SAE J1265). That is exactly a triangle of height H
  with its toe 1.6 H ahead, a ~32° face.
- [D] For our blade (W 3.4 m, H ≈ 1.2 m): about 3.9 m³, with the toe about 1.9 m ahead of the blade. Operators fill a
  blade within about two machine lengths.

**The rolling motion.**
- [S] A blade is shaped to roll the soil.
- [D] Soil climbs the moldboard at ~0.5–0.6 × blade speed, curls over the top edge and tumbles down the heap face
  (faster than the blade, briefly). It comes to rest at the toe, is overrun, and goes round again.
- [D] So individual lumps ride the whole push. Nothing is thrown much beyond the toe.

**Side spill and windrows.**
- [S] Once the blade is full, soil leaks off **both ends** and is left as windrows ("dirt spills off both sides and
  leaves windrows").
- [S] Spreading along the blade is slow: advection–diffusion, much slower than the forward avalanching.
- [D/G] The windrow is a ridge at the angle of repose, its crest just outside the blade-end line, low (a few tenths of
  blade height). It is not a mound thrown a metre or two out.
- [S] Cohesive soil keeps almost all of it in front of the blade.
- [D] No measured spill percentage was found. Cat's figure that a slot adds up to 30 % blade load implies an open
  straight blade loses roughly a quarter.

**Slot dozing.**
- [S] The first passes' windrows become the walls of a slot. The walls then stop side spill (FM 5-434), and the slot
  can be as deep as the blade is high.
- [S] Production goes up about 20 % (×1.2 in the Army and Cat correction tables).
- [S] Slots are cut in passes, each carrying its load to the end; berms of ~⅓ blade width are left between slots and
  pushed off last.
- [D/G] Spill that meets a slot wall piles against it and slides back into the slot ahead of the blade. A heightfield
  gets this for free if the spill only moves by repose.

**Driving into a loose pile.**
- [D] A pile face already stands at repose and has no reserve strength. The blade's wedge forms inside the pile, so the
  engaged height jumps from the cut depth to the pile height in contact. The FEE weight term goes as d², so the force
  jumps and the machine bogs (tracks slip, revs drop).
- [D/G] The face bulges and avalanches *back down onto the blade*. Material is not thrown forward; the toe moves with
  the blade.
- [S] Doctrine: raise the blade before the pile and let material drift under it to form a ramp; cut a big pile from the
  side with a third of the blade; collapsing faces are a known hazard.

**How real-time simulators do it.**
- [S] AGX Dynamics, Vortex and Holz et al. all keep the soil at rest as a heightfield. The blade drives a co-moving
  wedge zone sized by the failure plane, and the soil in that zone (the surcharge) is the moving part.
- [S] Excess leaves by avalanching under the same repose rule as the rest of the ground (cellular automaton, mass
  conserved). Blade forces come from FEE-style trial wedges, low-pass filtered.
- [S] Sumner et al. and Chrono SCM move displaced soil to the cells bordering the tool, then let slope-limited erosion
  spread it. Nobody teleports it.

## 3. The plan

The shape of it: put displaced soil against the blade, make the blade a wall the ground cannot flow through, and let
the existing repose relaxation do the spilling. Then windrows land at the blade ends at repose, slot walls hold the
load, and the heap face stays the heap face. The granules then only need to know where the moving part is.

### A. Terrain: the soil goes against the blade and flows round it (`src/terrain/core.js`)

1. **Deposit at the face, not 0.7 m ahead.**
   - Soil the cut cannot give to a container goes into the cells just ahead of the lip (the contour of the swept
     rectangle, Sumner-style), at its own place across the blade.
   - As the blade advances it sweeps those cells again and puts them ahead again. That re-sweeping *is* pushing a heap.
     It happens today too, from 0.7 m out.
   - `ahead` stays for buckets, which have no face to push against.
2. **The blade is a wall for relaxation, during the step it is there.**
   - `cut` marks the cells under the blade's face (the swept rectangle, as high as the blade's top) in a per-tick mask.
   - `relax` moves no soil into a masked cell.
   - The heap can then only slump forward and out round the ends. Windrows form by repose just outside the blade ends,
     as low as the heap at the ends lets them be.
   - In a slot the end cell is wall, so nothing leaves and the load is held.
   - Cost: one byte per cell and one test per transfer, only near blades.
3. **A heap never stands above the blade's top.**
   - Soil put in a face cell higher than the blade top (plus a few cm) moves along the face toward the nearer end, a
     cell or two a step: the slow along-blade spreading the experiments show.
   - At an end it leaves only by repose into the neighbour beyond, so it lands at the end, not 1.9 m out.
   - If both ends are walled (a full slot), the owner decides what happens: see decision 2 in section 4.
4. **Remove the point spill.** `heapMax`, `SPILL_CLEAR` and the wall search go. The `heap` field of a tool becomes
   "blade top above the edge", taken from the machine file (`machines/dozer.json`), not a default 0.9.
5. **Report what the blade is doing, not just what it cut.** `cut` returns three figures:
   - `fresh`: soil cut out of ground the blade had not just put there, i.e. below the previous step's surface ahead of
     the face.
   - `load`: soil in the heap zone in front of the blade, from the face to the first cell that has fallen to the cut
     floor, capped at 1.6 H.
   - `face`: the engaged height, how high soil stands against the blade.

   The point is that resistance, sound and effects stop counting the heap every time it is re-swept.
6. **Volume.** No new term in the audit: soil only moves between cells. The probe and the tests check it to 0.1 %.
   Swell (bank to loose, ~1.25) stays out for now. It would need its own audit term, and is a separate decision.

### B. What the machine feels (`src/vehicles/machine.js`; no audio changes)

1. **Resistance from the soil, not the re-sweeping.** The blade's push becomes:
   - cutting: `fresh × dig`, as now;
   - plus **dragging the load**: load mass × soil-on-soil friction (μ ≈ 0.5–0.6);
   - plus the **face term**: γ·face²·N_γ per metre of blade, from the FEE.

   All three are low-pass filtered as Vortex does. The face term is what bogs a dozer that hits a pile: the face
   height goes from 0.2 m to 1.2 m and the force rises about 25-fold.
2. **The load feeds the existing chain unchanged.** `digRate` keeps its meaning (resistance per second, filtered) and
   goes on driving `lug`, the track push, the hydrostatic load in `Machine.pre` and so the engine note. So the sound
   follows the engine model, as `CLAUDE.md` asks.
   - Tune so that a full blade (≈3.9 m³) on flat ground slows the dozer to a crawl in low range.
   - Tune so that hitting a pile 1.2 m high costs most of its speed within half a metre, with the tracks slipping (the
     slip already makes spray).
   - The constants go in `machines/dozer.json` (`drive.digLug`, a new `tools[].face`), not code.
3. **Note: the blade dives.** Held right down, the edge reaches 2.5 m down in 7 m of travel today. Real full drop is
   about 0.5 m below the tracks, and the dive works only because nothing holds the load back. With A and B, a blade held
   down fills, lugs and stalls first. That is right, but it changes a promise: see decision 1.

### C. Granules that move like heavy soil (`src/render/pushHeap.js`; cosmetic, Math.random allowed)

1. **Only the moving zone moves.**
   - Each frame, find the heap in contact with the blade: walk forward from the face down each of a few lines across
     the blade. Stop where the surface falls to the cut floor, or where it stops falling at repose and starts rising
     (the foot of a standing pile), or at 1.6 H.
   - That strip, plus a band beyond each end where the terrain has just spilled, is the only place granules are seeded
     and driven.
   - A standing pile beyond it is ground: its granules come to rest and sink in as they do now.
   - The core's `load`/`face` figures can drive it; on a co-op client, the host's `dig` figure as today.
2. **The circulation, with speeds from the wedge.**
   - The heap's core moves with the blade (never faster).
   - Granules at the face rise up the moldboard at ~0.55 × blade speed, curl over the top edge, and tumble down the
     front face under gravity along the terrain's slope. They stop at the toe, are overrun and go round again.
   - Nothing goes more than ~0.3 m beyond the toe. That is the "heavy fluid" look: a slow churning roll, not a spray.
3. **Ends.**
   - A slow drift along the face toward each end, as strong as the terrain's spill at that end (the core returns spill
     per end).
   - Granules drop off the end and come to rest on the windrow, within about half a metre of the blade-end line.
4. **Hitting a pile.**
   - No forward throw. Instead, a few lumps break off the pile face above the blade and roll down onto the heap and
     blade, with a puff of dust scaled by how fast `face` rose.
   - The chunks thrown up by the play scene's `churn` and the dust in `Effects` are driven by `fresh`, not by everything
     re-swept, so a blade shoving an existing heap rolls it rather than spraying it.
5. **Size.** Today a granule is 7–23 cm and the large ones read as voxels. Proposed: mostly 5–12 cm with a few big
   clods, bigger for clay and spoil, smaller and rounder for sand and gravel (one mesh, scaled per instance: no new
   draw calls). Owner's eye decides: decision 3.

### D. Proving it

- `tests/blade.test.js` (new, vitest, inline terrain), built from `tools/bladeprobe.mjs`. Targets from section 2, each
  with the reason in a comment:
  - **Virgin flat ground, edge 20 cm down:** the heap rises to blade height within ~10 m and only then spills.
    Windrow crest within 0.5 m of the blade-end line, no higher than 0.6 m. Spill only at the ends.
  - **Slot** (walls of untouched ground at the blade ends): nothing leaves the slot. A full load reaches ≥ 1.15 × the
    open-ground load before the machine stalls.
  - **Standing pile 1.2–1.7 m:** speed falls below 40 % within 1 m of contact. No granule more than toe + 0.3 m ahead,
    none faster than 1.2 × blade speed except down the face. No soil put more than 0.6 m past a blade end.
  - Audit to 0.1 % in each, and determinism (the same commands give the same arrays).
- Existing tests that encode today's behaviour and need revisiting:
  - `the heap in front of a blade`: keep its intent (no bow wave at eye height, windrows beside the cut, soil
    balances).
  - `digging down in one pass` and `digging down`: depend on decision 1.
  - `tests/e2e/grade.mjs` must still level the pad in two passes.
- `node tools/bladeshots.mjs after`, compared with the `before` set; `node tools/video.mjs dozer` for the motion.
- Budgets: worker tick unchanged within noise (the mask is tiny); no new draw calls; granule count unchanged.
- Quest checklist entries for what only the headset can judge (look of the roll, windrow placement, the jolt of
  hitting a pile, granule size). Nothing here can be checked in VR from the build machine.

### Order of work (each step shippable and tested)

1. Instrument `cut` to return `fresh`, `load`, `face` and per-end spill. Nothing else changes yet, so the effects and
   tests keep working.
2. Terrain A1–A4 together, with the new blade test. This alone fixes the far, tall mounds.
3. Machine resistance B, tuned against the probe. This makes a pile bog the machine down.
4. Granules C1–C3, then C4–C5. This fixes the forward spray on a pile.
5. Retune and review the existing dozer tests, write the checklist entries, take before/after shots and video.

## 4. Decisions for the owner

1. **Digging down in one pass.** Today a dozer with the blade held right down dives to the rock (2.5 m) in one go,
   and a test holds it there.
   - Real soil would fill the blade within about two machine lengths, bog the dozer down, and leave you to lift, carry
     the load out and come back: slot dozing, pass by pass.
   - Recommended: realistic. A held-down blade cuts in, fills, lugs and stalls; slots deepen pass by pass.
   - The alternative is to keep the dive and accept less realistic loads in a trench.
2. **A full blade in a slot.** When both ends are walled and the heap is at blade height, the surplus either goes
   **over the top** (it drops between blade and tracks, and the tracks climb it, as a real overfull blade does), or the
   machine simply **stalls** with the tracks slipping and nothing moves.
   - Recommended: stall, with a little over the top only when forced well beyond full.
3. **Granule size.** Smaller (mostly 5–12 cm, per material), or keep today's chunky look?

## Sources

- Servin et al., multiscale terrain (AGX): failure wedge, soil-to-particle rules, bulldozing tests. https://www.algoryx.se/papers/terrain/multiscale_terrain.pdf (arXiv 2011.00459)
- FEE and the Vortex soil model: https://arxiv.org/html/2505.19330v1
- FM 5-434, Earthmoving Operations (slot and side-by-side dozing, stockpiles, correction factors): https://wiki.opensourceecology.org/images/d/d0/FM5-434.pdf
- ISO 9246 blade capacity: https://cdn.standards.iteh.ai/samples/16896/5a6f46f6f3b346a8b6611c72c2604e06/ISO-9246-1988.pdf
- Rubinstein, Shmulevich & Franco, heap build-up in front of a blade: https://cris.ariel.ac.il/en/publications/prediction-of-the-forces-of-blade-penetration-and-build-up-heap-i/
- Sauret, Balmforth, Caulfield & McElwaine, "Bulldozing of granular material" (J. Fluid Mech. 2014): https://arxiv.org/abs/1405.0183
- "Doze more dirt", Construction Equipment (Cat operator know-how): https://constructionequipment.com/doze-more-dirt
- KSU CE419 (Cat Handbook blade-load method, slot dozing): https://faculty.ksu.edu.sa/sites/default/files/4.CE419-Ch4.2.pdf
- Holz et al. 2013 (ISARC): https://www.iaarc.org/publications/fulltext/isarc2013Paper172.pdf
- Chrono SCM bulldozing parameters: https://api.projectchrono.org/9.0.0/classchrono_1_1vehicle_1_1_s_c_m_terrain.html
- Sumner, O'Brien & Hodgins 1998: https://graphicsinterface.org/proceedings/gi1998/gi1998-16/
- Footage worth watching (picked by title, not yet watched): look for the heap face against blade height, the roll at
  the top edge, windrows at the blade ends, and how hard the machine slows at a pile.
  - Komatsu D39 slot dozing: https://www.youtube.com/watch?v=svJTH7x7OLs
  - D65PX side-of-cab view: https://www.youtube.com/watch?v=QHPPlo19P3o
  - Slot dozing explained: https://www.youtube.com/watch?v=O9cxaCyc31M
