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

## Avatars and vehicle look (new)

- Two-player: the other player is now a full figure as in SWVR (head with a face and hat, torso, arms with elbows, the faceted hands, legs). Standing: do the feet sit on the ground and the arms follow the hands believably? In a cab: do they sit, with the hands on the controls? Each player should get a different outfit.
- Vehicles are cel shaded with a dark outline; nothing else is. Is the outline the right weight up close in the cab and from 20 m? Any flicker or gaps at panel corners? Does the frame rate hold with four machines in view (the outline draws each machine part twice)?
- Pushed soil: the granules ahead of the blade should travel with it, roll forward, and sink into the heap about two seconds after you stop. Granule size right?

## Getting about (new)

- On foot, squeeze a grip on thin air and pull: the world should move with your hand, in all three directions, straight through the machines. Let go: you stay at the height you pulled yourself to. Push the left stick to walk: you settle back onto the ground.
- Both grips: pull and twist to turn yourself. Comfortable, or does it need a dead zone?
- A grip squeezed near a handrail or a control should still take hold of it, not the world. Any place where you grab the world when you meant to grab a lever?
- Seated: push the left stick sideways for a 30° turn in the seat (B recentres). The left stick's forward and back still works the boom, blade or bed; its sideways push no longer curls the bucket or tilts the blade (the right stick does). Is that the right trade?
- On foot the right stick still snap-turns.

## The bog (new)

- On the middle terrace, east of the way down (a dark patch about 26 m by 10 m), is deep wet mud. Drive the loader in: the wheels should sink about 30 cm and the machine should slow to a crawl, engine working hard. Can you still get out? Is it too punishing, or not enough?
- The dozer should keep going through it at a slow walk where the wheeled machines nearly stop.
- The ruts should slowly close up after you have gone. Too fast, too slow?
- It is soil like the rest: dig it with the loader or the hoe, carry it, tip it somewhere else. A heap of it should slump almost flat. Tipping gravel or clay into the bog to make a firm crossing should work, as at the ford.
- Does the frame rate hold while a machine churns through it?

## Hand tools (new)

They lie on the ground beside where you start (shovel, two stakes, a chain with two hooks). Grip to pick one up; let go to put it down.

- Shovel: hold it and push the blade into the ground ahead of you. It should take a shovelful (a lump shows on the blade, and you feel it in the controller). Turn it over, or squeeze the trigger, to throw the soil off. Is the reach right? Is the blade angle comfortable, or does it need to dip more or less? Let go: it should stand in the ground.
- Grading stakes: carry the red-topped one to where the ground is right and let go; it plants itself. Plant the blue one some metres away. A pink level line runs between them at the height of the red stake's top, with droppers to the ground every half metre: green where the ground is level with the red stake's foot, red where it is high, blue where it is low. Readable from a cab? Is 4 cm the right tolerance for green?
- Tow chain: carry a hook to the back of one machine and let go near the middle of its rear; it should hitch. Hitch the other hook to the front of a machine stuck in the bog, release that machine's park brake, then drive the first one off. The chain is 7 m. Does it take up smoothly, or snatch? Does the stuck machine come out?
- Any time you grab the world when you meant to grab a tool, or a tool when you meant a lever?

## Comfort (new)

- Turning any vehicle: the world should now sweep past smoothly at the headset's frame rate. Before, the machines moved 60 times a second under a 90 Hz display, which looked like a low frame rate. Is the judder gone on the wheeled machines and on the dozer? On both physics models?
- Steering wheels are higher, nearer and clear of the dash; the dozer's track levers are 12 cm higher; the wipers are gone from every windscreen. Reach and height right now?

