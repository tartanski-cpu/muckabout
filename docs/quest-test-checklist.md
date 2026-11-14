# Quest test checklist

Nothing below has been tried on a headset. Each item says what to do and what to tell Claude if it is wrong. Open the Pages URL in the Quest Browser.

## 1. First minute

1. Page loads and shows the yard, four machines, the hopper, the river in the distance. *If it stays on "Loading…" or shows "failed to start", read out the text bottom-left.*
2. Press **Enter VR**. You should be standing in the yard at your real height.
3. Look at your left wrist: the perf panel. Note **fps**, **worst frame ms**, and which bar is longest. `X` hides it.
4. Hands: orange gloves where your controllers are. *Are they rotated oddly or offset from your real hands?* (The 40° pitch is borrowed from SWVR.)
5. Walk with the left stick (push fully to run), snap-turn with the right. Does the ground height follow you down a bank?

## 2. Getting in and the cab

6. Walk to the **loader**, grab the yellow handrail (left side of the cab). You should land in the seat looking forward.
7. Is your head at a sensible driver's height? Press `B` to recentre. Sit down in real life and press `B` again.
8. Can you comfortably reach: steering wheel, loader joystick (right), shuttle lever and key on the dash, throttle and park brake (left)? *Tell me which are too far, too low or in the way; positions are one line each in `machines/*.json`.*
9. Are the labels readable? The trigger placard is gone and the instrument cluster has moved to the front right corner: is the view over the wheel clear now, in every machine? The dash readout is now up in the top right of the windscreen: readable there, or in the way?
10. Clipboard (left of the dash): grab it, bring it to your face, let go. Does it go back?

## 3. Driving the loader

11. Key: grab and twist clockwise (or grab and release). Engine cranks, then runs. *Sound: is it recognisably a diesel, or just noise? Too loud?*
12. Poke the park brake rocker off. Push the shuttle to F (you should feel a click).
13. Left hand on the wheel, right hand on the joystick, squeeze the right trigger: it should pull away. Left trigger brakes.
14. Steering: turn the wheel hand over hand. Does the glove stay on the rim? Does the machine articulate at a believable rate?
15. Joystick: back raises the boom, left curls the bucket. Hold a function against its stop: clank, thump in the hands, then a squeal.
16. Rev with the hand throttle: hydraulics should get noticeably faster.
17. Dig the gravel stockpile (east side of the yard): bucket flat, drive in, curl, lift. Does the bucket visibly fill? Does the machine bog and the engine lug?
18. Tip it out. Do the clods look right falling and does a heap form?
19. Does anything make you queasy? Try right-stick click (horizon lock) on a bank.

## 3b. Custom physics against Rapier

The game starts on the **custom** vehicle model (the proof of concept's style). Seated, **click the left stick** to flip to Rapier and back; the dash display says which is on.

- Drive the same stretch on each: over a bank edge, across ruts, up to the stockpile. Which feels more like a heavy machine?
- Dig on each: does the custom one bog believably when the bucket is in the pile?
- Dozer on each at a terrace crest. On Rapier it can nose over and get stuck; on custom it should just follow the ground.
- Backhoe legs on each: both should lift the back end.
- On custom, drive into another machine: it should stop with a thump, not push it.
- Tell me which you want as the default for each machine; they can differ.

## 4. The other machines

20. **Dumper:** `Y` to get out, climb in. Drive it. Tipper lever back raises the bed. Load it with the loader (this needs two people or patience) and tip.
21. **Dozer:** two levers, both forward = forward, one forward = turn. Blade joystick back = raise. Cut a strip of topsoil; then try cutting into a terrace bank to start a ramp. Does it stall sensibly rather than stop dead or fly?
22. **Backhoe:** drive it like the loader. Poke **SWIVEL SEAT**: you should turn to face the rear. Two short levers lower the legs (push forward); the back should lift. Left stick swings and moves the dipper, right stick boom and bucket. Dig a hole and dump to the side.
23. On each: does anything feel wildly over- or under-powered, too fast or too slow?

## 5. The job

24. Cut a road from the yard down the three banks. Roughly how long does one bank take with the dozer?
25. At the river: push mud from the flats into the channel. Watch whether it washes away over a few minutes. Then cap a crossing with gravel hauled from the yard and see if it holds.
26. Drive the dumper and loader across. Do they bog in the mud and grip on the gravel?
27. Dig sand on the far side, haul it back, reverse the dumper up to the hopper wall and tip. Does the sign count up?
28. Does the clipboard tick items off at sensible moments?

## 6. Stress test (end of every milestone)

29. On foot, click the **left stick**: all four machines start working on their own and gravel fountains out of the stockpile. Stand near them for a minute.
30. Read the wrist panel: fps, worst frame, and the `vehicles`, `terrain`, `upload`, `render` rows, plus `calls` and `tris`. **Target: 72 fps, worst frame under ~16 ms.** Send me the numbers.
31. If it is under 72: note whether it is `render` (too much to draw) or `vehicles`/`upload` (too much to compute).

## 7. Two players

32. Headset A: on the start page press **Host a game**; read the five-digit room number (also on the dash display once seated).
33. Headset B: type the number, press **Join**. *If it says it cannot reach the matchmaking server or the room, tell me the exact message.* This path has never been tested over a real network.
34. Can you see each other (hard hat, body, gloves)? Do the other person's machines and digging appear, slightly delayed?
35. B drives a machine: how laggy does it feel? A tries to grab the same machine's handrail: should be refused with a buzz.
36. Take a headset off for 15 s and put it back on: does the game recover?

## Things I already suspect

- Control positions are guesses made without seeing them in VR.
- The sound engine is new and tuned by measurement and spectrogram, never heard on the headset's speakers. See "Sound" below.
- The dozer needs a careful driver at a bank crest: go over too fast and it noses down and cannot back out until you cut more.
- The loader spills roughly a third of each bucket when loading the dumper under the scripted driver; a human can place it better, but the reach is tight.

## 8. Light and effects (added after the first headset session)

37. Golden hour is the default. On foot, click the **right stick** to step through day → golden → dusk. Does each look right in the headset, and is anything too dark to work in at dusk?
38. At dusk: do the lamps glow, the beacons flash, and the headlamp pool land on the ground ahead of a running machine?
39. Is there a soft patch of shade under each machine, and does it sit in the right place relative to the sun?
40. Exhaust: thin grey at idle, thick and black when you rev hard or push into a pile, a black cough on start-up. Too much, too little, wrong place?
41. Dust off the wheels on dry ground; spray in the river; mud off a spinning tyre in the mud flats; dust where a bucketful lands.
42. **Frame rate with all of this on**, standing near the four working machines in the stress test. It was a solid 90 before this pass.

## Digging and granules (new)

- Loader: lower the boom right down with the bucket flat and drive at flat ground. It should now bite about 30 cm and fill, where before it skated. Too greedy? Does the machine bog down believably?
- Dozer: blade right down now cuts about 25 cm and the machine slows as the heap builds, down to a crawl with a big heap. Feather the blade up to keep moving. Is that the right amount of material, and the right amount of slowing?
- Chunks should tumble in front of the cutting edge while it is pushing soil, and the bucket and bed now show a heap of lumps rather than a smooth surface. Is it clear when the bucket is full? Does the frame rate hold with a full dumper bed in view?

## Sound (new engine)

Listen for each of these, from the seat and standing beside the machine. For each: is it there, is it believable, is it too loud or too quiet against the rest?

- Start: starter whine, the engine catching, settling to a lumpy idle with diesel clatter. Key off: it should run down, not cut dead.
- Throttle up with no load, then back: the note should rise and fall without sounding like a synthesiser sweep.
- Raise the empty boom, then raise it with a full bucket: the pump whine and the engine should both work noticeably harder with the load. Lowering should be nearly free.
- Hold a lever against its stop: relief squeal, engine pulled down, and it should recover the moment you let go.
- Drive the loader hard into the stockpile: revs sag, the exhaust barks, a puff of black smoke, the turbo whistle rises, then it steadies. Come off the pedal: it should come back up.
- Dozer with the blade in: the same, building as the heap builds.
- From the seat the engine should be duller and boomier than from outside; step out and it should open up. Walk away: it should get duller with distance, with a faint echo.
- Wheeled machines: tyre roar and a transmission whine rising with speed. Dozer: track slap and squeak.
- Each machine should sound like a different engine (the dozer biggest and slowest, the backhoe a smaller four-cylinder).
- With all four engines running, does the frame rate hold? (Each engine is one audio worklet.)
- On the headset's own speakers there is little bass: can you still hear the idle clearly?
