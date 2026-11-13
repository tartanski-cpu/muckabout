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
9. Are the labels readable? Is the placard about triggers visible on the windscreen frame?
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
- The engine and hydraulic sounds are tuned by numbers, not by ear.
- The dozer needs a careful driver at a bank crest: go over too fast and it noses down and cannot back out until you cut more.
- The loader spills roughly a third of each bucket when loading the dumper under the scripted driver; a human can place it better, but the reach is tight.
