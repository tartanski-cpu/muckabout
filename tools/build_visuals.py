#!/usr/bin/env python3
"""Art pass for the machines: writes the "visuals" list of every machines/*.json (and moves each cab to its
floor height). Everything else in those files (physics, hydraulics, tools, controls) is left alone.

The models are built from painted boxes and cylinders, merged at load into one mesh per moving part, so detail
is nearly free in draw calls. Coordinates are in each node's own frame (see the nodes in the JSON); for bodies
that is the machine frame: forward = -z, y up.   Run:  python3 tools/build_visuals.py
"""
import json, math, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'machines')
PI = math.pi

def load(n): return json.load(open(os.path.join(ROOT, n + '.json')))
def dump(n, d):
    open(os.path.join(ROOT, n + '.json'), 'w').write("{\n" + ",\n".join('  ' + json.dumps(k) + ': ' + json.dumps(v) for k, v in d.items()) + "\n}\n")
R = lambda v: [round(x, 4) for x in v]
def B(parent, size, pos, mat='yellow', rot=None, taper=None, lean=None):
    v = {"parent": parent, "box": R(size), "pos": R(pos), "mat": mat}
    if rot: v["rot"] = R(rot)
    if taper: v["taper"] = taper
    if lean: v["lean"] = lean
    return v
def C(parent, r0, r1, h, pos, mat='dark', rot=None, seg=10):
    v = {"parent": parent, "cyl": [r0, r1, h, seg], "pos": R(pos), "mat": mat}
    if rot: v["rot"] = R(rot)
    return v
AX = [0, 0, PI / 2]   # cylinder lying across the machine (axis along x)
AZ = [PI / 2, 0, 0]   # cylinder lying along the machine (axis along z)

def cab(p, cx, cz, fl, col, col2, column=True, seat=True, steps=None):
    """Operator's cab: glass to the floor at the front so the work is visible. Eye point is (cx, fl+1.31, cz+0.1)."""
    o = [B(p, [1.66, 0.08, 1.74], [cx, fl - 0.04, cz], 'dark'), B(p, [1.5, 0.02, 1.5], [cx, fl + 0.005, cz], 'black')]
    for sx in (-0.78, 0.78):
        for sz in (-0.8, 0.8): o.append(B(p, [0.09, 1.76, 0.09], [cx + sx, fl + 0.88, cz + sz], col))
    o += [B(p, [1.86, 0.1, 1.96], [cx, fl + 1.8, cz], col), B(p, [1.5, 0.06, 1.5], [cx, fl + 1.88, cz], col2),
          B(p, [1.86, 0.05, 0.28], [cx, fl + 1.74, cz - 1.06], col2, rot=[0.25, 0, 0]),
          C(p, 0.06, 0.07, 0.12, [cx + 0.62, fl + 1.97, cz + 0.55], 'amber'), C(p, 0.075, 0.075, 0.03, [cx + 0.62, fl + 1.9, cz + 0.55], 'black')]
    for sx in (-0.6, 0.6):   # roof work lights
        o += [B(p, [0.2, 0.13, 0.12], [cx + sx, fl + 1.68, cz - 0.9], 'black'), B(p, [0.16, 0.09, 0.03], [cx + sx, fl + 1.68, cz - 0.97], 'lamp')]
    o += [B(p, [1.5, 1.72, 0.02], [cx, fl + 0.88, cz - 0.8], 'glass'), B(p, [1.5, 1.05, 0.02], [cx, fl + 1.24, cz + 0.8], 'glass'),
          B(p, [0.02, 1.05, 1.5], [cx - 0.78, fl + 1.24, cz], 'glass'), B(p, [0.02, 1.05, 1.5], [cx + 0.78, fl + 1.24, cz], 'glass'),
          B(p, [0.05, 0.62, 1.52], [cx - 0.79, fl + 0.36, cz], col), B(p, [0.05, 0.62, 1.52], [cx + 0.79, fl + 0.36, cz], col),
          B(p, [0.07, 0.07, 1.52], [cx - 0.79, fl + 0.7, cz], col2), B(p, [0.07, 0.07, 1.52], [cx + 0.79, fl + 0.7, cz], col2),
          B(p, [1.5, 0.66, 0.05], [cx, fl + 0.36, cz + 0.8], col), B(p, [1.5, 0.1, 0.04], [cx, fl + 0.05, cz - 0.8], col2)]
    for sx in (-0.42, 0.42):  # side consoles the levers stand on
        o += [B(p, [0.17, 0.42, 0.64], [cx + sx, fl + 0.42, cz + 0.04], 'dark'), B(p, [0.19, 0.03, 0.66], [cx + sx, fl + 0.62, cz + 0.04], 'black')]
    # a slim column and a narrow pod for the key, shuttle and buttons: nothing wide in front of the driver
    o += [B(p, [0.2, 0.62, 0.13], [cx, fl + 0.33, cz - 0.38], 'dark'), B(p, [1.0, 0.09, 0.15], [cx, fl + 0.635, cz - 0.33], 'black')]
    if seat:
        o += [B(p, [0.3, 0.32, 0.3], [cx, fl + 0.18, cz + 0.2], 'black'), B(p, [0.52, 0.12, 0.5], [cx, fl + 0.5, cz + 0.18], 'seat'),
              B(p, [0.5, 0.64, 0.1], [cx, fl + 0.9, cz + 0.47], 'seat', rot=[0.12, 0, 0]), B(p, [0.26, 0.18, 0.08], [cx, fl + 1.3, cz + 0.52], 'seat')]
    for sx in (-1, 1):       # mirrors
        o += [B(p, [0.5, 0.03, 0.03], [cx + sx * 1.03, fl + 1.42, cz - 0.82], 'black'), B(p, [0.04, 0.3, 0.18], [cx + sx * 1.3, fl + 1.36, cz - 0.82], 'black')]
    for (x, y, z) in (steps or []):
        o += [B(p, [0.46, 0.05, 0.26], [x, y, z], 'grey'), B(p, [0.04, 0.05, 0.3], [x - 0.24 * (1 if x < 0 else -1), y, z], 'black')]
    return o

def ladder(p, x, z, top, bottom=0.5):
    """Boarding steps on one side: two stiles and deep tread-plate rungs, from near the ground up to `top`."""
    sx = 1 if x > 0 else -1; o = []; h = top - bottom + 0.1
    for dz in (-0.21, 0.21): o.append(B(p, [0.05, h, 0.05], [x, bottom + h / 2 - 0.05, z + dz], 'black'))
    y = bottom
    while y < top - 0.05:
        o.append(B(p, [0.24, 0.045, 0.42], [x - sx * 0.1, y, z], 'grey')); y += 0.36
    return o + [B(p, [0.3, 0.05, 0.46], [x - sx * 0.13, top, z], 'grey')]

def teeth(p, n, half, y, z, length=0.26, forward=-1):
    return [B(p, [0.1, 0.07, length], [-half + 0.12 + i * (2 * half - 0.24) / (n - 1), y, z + forward * length / 2], 'chrome', taper=[0.7, 1]) for i in range(n)]

def loader_bucket(p, half, floor, back, lip, n_teeth):
    w = 2 * half; depth = back - lip; mid = (back + lip) / 2
    o = [B(p, [w, 0.06, depth], [0, floor - 0.03, mid], 'dark'), B(p, [w, 0.62, 0.06], [0, floor + 0.3, back + 0.02], 'dark'),
         B(p, [w, 0.5, 0.06], [0, floor + 0.78, back - 0.1], 'dark', rot=[-0.5, 0, 0]), B(p, [w + 0.04, 0.06, 0.1], [0, floor + 0.98, back - 0.27], 'yellow2'),
         B(p, [w + 0.1, 0.05, 0.16], [0, floor - 0.02, lip - 0.06], 'chrome')]
    for sx in (-1, 1):
        o += [B(p, [0.06, 0.92, depth], [sx * half, floor + 0.44, mid], 'dark', taper=[1, 0.36], lean=[0, depth * 0.31]),
              B(p, [0.08, 0.1, depth * 0.9], [sx * half, floor + 0.02, mid], 'yellow2')]
    for x in (-half * 0.5, 0, half * 0.5): o.append(B(p, [0.1, 0.04, depth * 0.9], [x, floor - 0.075, mid], 'black'))
    return o + teeth(p, n_teeth, half, floor - 0.01, lip - 0.1)

# ---------------------------------------------------------------------------------------------------------------- loader
def loader():
    fl, cz = 2.0, -0.7; v = []
    v += [B('rear', [1.3, 0.7, 3.7], [0, 1.0, 0.35], 'dark'), B('rear', [2.0, 0.3, 0.42], [0, 0.75, 0], 'black'), B('rear', [1.5, 0.5, 1.62], [0, 1.72, cz], 'dark'),
          B('rear', [1.72, 1.05, 2.1], [0, 1.9, 1.32], 'yellow', taper=[0.86, 0.94]), B('rear', [1.0, 0.04, 1.3], [0, 2.44, 1.3], 'black'),
          B('rear', [1.42, 0.82, 0.06], [0, 1.85, 2.4], 'black'), B('rear', [2.3, 0.78, 0.56], [0, 1.15, 2.56], 'yellow2', taper=[1, 0.78]),
          B('rear', [0.3, 0.16, 0.3], [0, 0.86, 2.9], 'black'), C('rear', 0.06, 0.06, 1.0, [0.5, 2.9, 0.95], 'dark'), C('rear', 0.085, 0.085, 0.1, [0.5, 3.42, 0.95], 'black'),
          C('rear', 0.13, 0.13, 0.42, [-0.5, 2.62, 0.85], 'black'), C('rear', 0.16, 0.16, 0.08, [-0.5, 2.86, 0.85], 'yellow2'),
          C('rear', 0.13, 0.13, 0.52, [0, 1.0, -1.5], 'chrome'), C('rear', 0.1, 0.1, 0.3, [0, 1.55, -1.5], 'chrome')]
    for i in range(4): v.append(B('rear', [1.44, 0.05, 0.09], [0, 1.56 + i * 0.19, 2.44], 'yellow2'))
    for sx in (-1, 1):
        v += [B('rear', [0.04, 0.52, 1.25], [sx * 0.84, 1.82, 1.4], 'black'), B('rear', [0.74, 0.08, 1.9], [sx * 1.05, 1.62, 0.05], 'yellow'),
              B('rear', [0.74, 0.44, 0.08], [sx * 1.05, 1.42, -0.9], 'yellow', rot=[0.5, 0, 0]), B('rear', [0.74, 0.44, 0.08], [sx * 1.05, 1.42, 1.0], 'yellow', rot=[-0.5, 0, 0]),
              B('rear', [0.42, 0.5, 0.9], [sx * 0.92, 1.25, 1.55], 'yellow2'), B('rear', [0.22, 0.14, 0.05], [sx * 0.85, 1.62, 2.86], 'tail'),
              B('rear', [0.64, 0.05, 1.0], [sx * 1.12, 1.98, cz], 'grey'), B('rear', [0.6, 0.3, 0.9], [sx * 1.1, 1.8, cz], 'yellow2')]
    v += cab('rear', 0, cz, fl, 'yellow', 'yellow2') + ladder('rear', -1.33, -1.2, 1.95) + ladder('rear', 1.33, -1.2, 1.95)
    v += [B('rear', [2.32, 0.3, 0.03], [0, 1.2, 2.845], 'hazard'), B('rear', [0.03, 0.3, 0.5], [-1.16, 1.2, 2.58], 'hazard'), B('rear', [0.03, 0.3, 0.5], [1.16, 1.2, 2.58], 'hazard')]
    v += [B('front', [1.0, 0.52, 2.3], [0, 0.93, -2.6], 'yellow2'), B('front', [2.0, 0.3, 0.42], [0, 0.75, -3.0], 'black'), B('front', [1.08, 0.2, 0.22], [0, 1.45, -2.25], 'yellow2')]
    for sx in (-1, 1):
        v += [B('front', [0.17, 1.15, 0.7], [sx * 0.62, 1.72, -1.78], 'yellow', lean=[0, -0.22]), B('front', [0.74, 0.08, 1.7], [sx * 1.05, 1.62, -3.0], 'yellow'),
              B('front', [0.74, 0.4, 0.08], [sx * 1.05, 1.44, -2.2], 'yellow', rot=[-0.5, 0, 0]), B('front', [0.26, 0.2, 0.2], [sx * 1.05, 1.76, -3.74], 'black'),
              B('front', [0.2, 0.14, 0.04], [sx * 1.05, 1.76, -3.85], 'lamp'), C('front', 0.075, 0.075, 0.95, [sx * 0.38, 1.42, -2.45], 'black', rot=[1.15, 0, 0]),
              C('front', 0.04, 0.04, 0.8, [sx * 0.38, 1.75, -3.15], 'chrome', rot=[1.15, 0, 0])]
    for sx in (-1, 1):
        v += [B('boom', [0.16, 0.36, 3.2], [sx * 0.62, 0, -1.6], 'yellow'), B('boom', [0.2, 0.46, 0.7], [sx * 0.62, 0, -0.3], 'yellow'),
              C('boom', 0.21, 0.21, 0.22, [sx * 0.62, 0, 0], 'yellow2', rot=AX), C('boom', 0.2, 0.2, 0.22, [sx * 0.62, 0, -3.2], 'yellow2', rot=AX)]
    v += [C('boom', 0.11, 0.11, 1.26, [0, 0, -2.0], 'yellow2', rot=AX), B('boom', [0.13, 0.17, 1.5], [0, 0.4, -2.25], 'yellow', rot=[0.28, 0, 0]),
          C('boom', 0.075, 0.075, 0.75, [0, 0.5, -0.55], 'black', rot=[1.42, 0, 0]), C('boom', 0.04, 0.04, 0.9, [0, 0.6, -1.3], 'chrome', rot=[1.42, 0, 0]),
          B('boom', [0.1, 0.5, 0.14], [0, 0.3, -2.95], 'yellow2')]
    v += loader_bucket('bucket', 1.2, -0.275, 0.15, -1.15, 8)
    for sx in (-1, 1): v.append(B('bucket', [0.22, 0.46, 0.3], [sx * 0.62, 0.05, 0.25], 'yellow'))
    return v

# ---------------------------------------------------------------------------------------------------------------- dumper
def dumper():
    fl, cz = 1.8, -1.9; v = []
    v += [B('front', [1.5, 0.6, 3.1], [0, 1.05, -1.75], 'dark'), B('front', [2.1, 0.3, 0.42], [0, 0.8, -1.8], 'black'), B('front', [1.6, 0.4, 1.72], [0, 1.58, cz], 'dark'),
          B('front', [2.0, 0.95, 0.95], [0, 1.95, -3.25], 'orange', taper=[0.88, 0.62], lean=[0, 0.14]), B('front', [1.5, 0.62, 0.06], [0, 1.78, -3.74], 'black'),
          B('front', [2.5, 0.36, 0.32], [0, 1.08, -3.66], 'dark'), B('front', [0.7, 0.1, 0.06], [0, 1.08, -3.83], 'orange2'),
          C('front', 0.07, 0.07, 1.7, [0.62, 2.75, -0.92], 'dark'), C('front', 0.095, 0.095, 0.1, [0.62, 3.62, -0.92], 'black'),
          B('front', [0.62, 0.75, 0.5], [-0.62, 1.75, -0.72], 'orange2'), C('front', 0.13, 0.13, 0.5, [0, 1.0, 0], 'chrome')]
    for i in range(4): v.append(B('front', [1.52, 0.05, 0.08], [0, 1.56 + i * 0.15, -3.77], 'orange2'))
    for sx in (-1, 1):
        v += [B('front', [0.78, 0.08, 2.0], [sx * 1.1, 1.72, -1.8], 'orange'), B('front', [0.78, 0.46, 0.08], [sx * 1.1, 1.52, -2.86], 'orange', rot=[0.5, 0, 0]),
              B('front', [0.78, 0.46, 0.08], [sx * 1.1, 1.52, -0.74], 'orange', rot=[-0.5, 0, 0]), B('front', [0.28, 0.17, 0.05], [sx * 0.86, 1.56, -3.77], 'lamp'),
              B('front', [0.12, 0.1, 0.05], [sx * 1.12, 1.56, -3.76], 'amber')]
    v += cab('front', 0, cz, fl, 'orange', 'orange2') + ladder('front', -1.3, -3.08, 1.72) + ladder('front', 1.3, -3.08, 1.72)
    v += [B('front', [2.52, 0.2, 0.03], [0, 1.08, -3.83], 'hazard'), B('rear', [2.0, 0.22, 0.03], [0, 1.02, 4.9], 'hazard'), B('rear', [2.0, 0.3, 0.06], [0, 1.02, 4.86], 'dark')]
    v += [B('rear', [1.1, 0.5, 4.7], [0, 1.15, 2.45], 'dark'), B('rear', [2.1, 0.26, 0.38], [0, 0.8, 1.9], 'black'), B('rear', [2.1, 0.26, 0.38], [0, 0.8, 3.5], 'black'),
          B('rear', [1.0, 0.2, 0.1], [0, 1.25, 4.83], 'dark')]
    for sx in (-1, 1):
        v += [B('rear', [0.24, 0.34, 2.3], [sx * 0.72, 0.86, 2.7], 'black'), B('rear', [0.66, 0.52, 0.04], [sx * 1.1, 0.72, 4.42], 'black'),
              B('rear', [0.2, 0.12, 0.05], [sx * 0.42, 1.27, 4.86], 'tail'), C('rear', 0.085, 0.085, 1.5, [sx * 0.74, 1.32, 1.55], 'black', rot=[1.0, 0, 0]),
              C('rear', 0.05, 0.05, 1.2, [sx * 0.74, 1.72, 0.95], 'chrome', rot=[1.0, 0, 0])]
    bd = 'bed'
    v += [B(bd, [2.52, 0.1, 4.5], [0, 0.03, -2.3], 'orange2'), B(bd, [2.52, 1.4, 0.1], [0, 0.72, -4.53], 'orange'), B(bd, [2.7, 0.1, 1.0], [0, 1.44, -5.0], 'orange'),
          B(bd, [2.7, 0.22, 0.08], [0, 1.36, -5.5], 'orange2'), B(bd, [2.52, 0.1, 0.72], [0, 0.17, -0.1], 'orange2', rot=[0.38, 0, 0]),
          B(bd, [0.9, 0.08, 4.3], [0, -0.06, -2.3], 'dark')]
    for sx in (-1, 1):
        v += [B(bd, [0.1, 1.05, 4.5], [sx * 1.27, 0.58, -2.3], 'orange', lean=[sx * 0.14, 0]), B(bd, [0.18, 0.1, 4.62], [sx * 1.43, 1.13, -2.3], 'orange2')]
        for i in range(6): v.append(B(bd, [0.08, 0.98, 0.13], [sx * 1.37, 0.58, -0.5 - i * 0.74], 'orange2', lean=[sx * 0.13, 0]))
    return v

# ---------------------------------------------------------------------------------------------------------------- dozer
def dozer():
    fl, cz = 1.75, 0.2; v = []; p = 'chassis'
    for sx in (-1, 1):
        x = sx * 1.0
        v += [B(p, [0.56, 0.09, 3.3], [x, 0.8, 0], 'track'), B(p, [0.56, 0.09, 3.3], [x, 0.045, 0], 'track'), B(p, [0.36, 0.46, 3.0], [x, 0.42, 0], 'dark'),
              C(p, 0.42, 0.42, 0.56, [x, 0.42, -1.65], 'track', rot=AX, seg=12), C(p, 0.42, 0.42, 0.56, [x, 0.42, 1.65], 'track', rot=AX, seg=12),
              C(p, 0.24, 0.24, 0.6, [x, 0.42, 1.65], 'yellow2', rot=AX), C(p, 0.2, 0.2, 0.6, [x, 0.42, -1.65], 'dark', rot=AX),
              B(p, [0.64, 0.07, 2.7], [x, 0.98, 0.45], 'yellow'), B(p, [0.5, 0.52, 1.1], [x, 1.27, 0.8], 'yellow2'), B(p, [0.14, 0.3, 0.3], [sx * 1.34, 0.5, -0.4], 'yellow2')]
        for i in range(5): v.append(C(p, 0.13, 0.13, 0.5, [x, 0.19, -1.0 + i * 0.5], 'black', rot=AX, seg=8))
        for i in range(14):   # grousers along the top and bottom runs
            z = -1.62 + i * 0.25
            v += [B(p, [0.6, 0.05, 0.07], [x, 0.87, z], 'black'), B(p, [0.6, 0.05, 0.07], [x, -0.005, z], 'black')]
    v += [B(p, [1.42, 0.56, 3.6], [0, 0.76, 0.05], 'dark'), B(p, [1.5, 0.5, 3.3], [0, 1.2, 0.1], 'yellow'), B(p, [1.6, 0.36, 1.72], [0, 1.55, cz], 'yellow2'),
          B(p, [1.06, 0.72, 1.7], [0, 1.8, -1.4], 'yellow', taper=[0.86, 0.96]), B(p, [0.7, 0.03, 1.2], [0, 2.17, -1.4], 'black'),
          B(p, [1.26, 1.2, 0.12], [0, 1.6, -2.3], 'yellow2'), B(p, [1.0, 0.92, 0.06], [0, 1.62, -2.38], 'black'),
          C(p, 0.06, 0.06, 0.9, [0.3, 2.6, -1.15], 'dark'), C(p, 0.085, 0.085, 0.08, [0.3, 3.07, -1.15], 'black'), C(p, 0.11, 0.11, 0.3, [-0.3, 2.3, -1.7], 'black'),
          B(p, [1.5, 0.85, 0.5], [0, 1.3, 1.98], 'yellow2'), B(p, [0.3, 0.16, 0.4], [0, 0.5, 2.1], 'black')]
    for i in range(5): v.append(B(p, [1.02, 0.05, 0.08], [0, 1.24 + i * 0.18, -2.4], 'yellow2'))
    for sx in (-1, 1): v += [B(p, [0.04, 0.4, 1.2], [sx * 0.52, 1.75, -1.4], 'black'), B(p, [0.2, 0.12, 0.05], [sx * 0.5, 1.5, 2.24], 'tail')]
    v += cab(p, 0, cz, fl, 'yellow', 'yellow2') + ladder(p, -1.36, 1.25, 1.0, bottom=0.42) + ladder(p, 1.36, 1.25, 1.0, bottom=0.42)
    v += [B(p, [1.52, 0.26, 0.03], [0, 1.02, 2.245], 'hazard')]
    a = 'arms'
    for sx in (-1, 1):
        v += [B(a, [0.18, 0.3, 2.75], [sx * 1.42, -0.32, -1.2], 'yellow'), C(a, 0.16, 0.16, 0.24, [sx * 1.42, -0.32, 0.1], 'yellow2', rot=AX),
              C(a, 0.07, 0.07, 0.9, [sx * 0.72, 0.42, -1.35], 'black', rot=[2.2, 0, 0]), C(a, 0.04, 0.04, 0.8, [sx * 0.72, 0.1, -2.0], 'chrome', rot=[2.2, 0, 0]),
              B(a, [0.5, 0.14, 0.14], [sx * 1.2, -0.3, -2.3], 'yellow2')]
    b = 'blade'
    v += [B(b, [3.4, 0.62, 0.1], [0, -0.24, 0], 'yellow'), B(b, [3.4, 0.58, 0.1], [0, 0.3, -0.09], 'yellow', rot=[-0.36, 0, 0]),
          B(b, [3.46, 0.09, 0.18], [0, 0.57, -0.22], 'yellow2'), B(b, [3.46, 0.15, 0.06], [0, -0.48, -0.08], 'chrome')]
    for sx in (-1, 1): v += [B(b, [0.08, 1.16, 0.46], [sx * 1.72, 0.01, -0.12], 'yellow2'), B(b, [0.4, 0.5, 0.2], [sx * 1.2, -0.25, 0.14], 'dark')]
    for x in (-1.1, -0.38, 0.38, 1.1): v.append(B(b, [0.1, 0.95, 0.22], [x, 0, 0.13], 'dark'))
    return v

# ---------------------------------------------------------------------------------------------------------------- backhoe
def backhoe():
    fl, cz = 1.55, -0.75; v = []; p = 'chassis'
    v += [B(p, [1.1, 0.5, 4.4], [0, 0.95, -0.9], 'dark'), B(p, [1.9, 0.2, 0.3], [0, 0.5, -2.3], 'black'), B(p, [2.0, 0.3, 0.42], [0, 0.8, 0], 'black'),
          B(p, [1.6, 0.36, 1.72], [0, 1.35, cz], 'dark'),
          B(p, [1.2, 0.85, 1.5], [0, 1.65, -2.36], 'yellow', taper=[0.84, 0.8], lean=[0, 0.14]), B(p, [0.96, 0.6, 0.06], [0, 1.5, -3.13], 'black'),
          B(p, [1.34, 0.36, 0.32], [0, 0.98, -3.18], 'yellow2'), C(p, 0.05, 0.05, 0.9, [0.4, 2.5, -2.2], 'dark'), C(p, 0.07, 0.07, 0.08, [0.4, 2.97, -2.2], 'black'),
          B(p, [2.1, 0.6, 0.36], [0, 0.95, 1.2], 'yellow2'), B(p, [0.9, 0.5, 0.5], [0, 1.3, 1.05], 'dark'),
          B(p, [1.2, 0.6, 0.14], [0, fl + 0.33, cz + 0.5], 'dark')]
    for i in range(4): v.append(B(p, [0.98, 0.04, 0.07], [0, 1.3 + i * 0.14, -3.16], 'yellow2'))
    for sx in (-1, 1):
        v += [B(p, [0.14, 0.95, 0.5], [sx * 0.75, 1.5, -1.75], 'yellow', lean=[0, -0.12]), B(p, [0.62, 0.08, 1.5], [sx * 0.95, 1.7, 0.0], 'yellow'),
              B(p, [0.62, 0.44, 0.08], [sx * 0.95, 1.5, -0.74], 'yellow', rot=[0.5, 0, 0]), B(p, [0.62, 0.44, 0.08], [sx * 0.95, 1.5, 0.74], 'yellow', rot=[-0.5, 0, 0]),
              B(p, [0.5, 0.42, 0.8], [sx * 0.86, 0.78, -1.25], 'yellow2' if sx < 0 else 'dark'), B(p, [0.17, 0.12, 0.05], [sx * 0.42, 1.86, -3.08], 'lamp'),
              B(p, [0.18, 0.12, 0.05], [sx * 0.8, 1.2, 1.4], 'tail'), B(p, [0.4, 0.2, 0.06], [sx * 0.9, 0.7, -2.3], 'yellow2')]
    v += cab(p, 0, cz, fl, 'yellow', 'yellow2', seat=False) + ladder(p, -1.2, -1.32, 1.5) + ladder(p, 1.2, -1.32, 1.5)
    v += [B(p, [2.12, 0.2, 0.03], [0, 0.95, 1.39], 'hazard')]
    v += [B('seat', [0.3, 0.3, 0.3], [0, -0.42, 0.06], 'black'), B('seat', [0.5, 0.12, 0.46], [0, -0.2, 0.1], 'seat'),
          B('seat', [0.5, 0.62, 0.1], [0, 0.2, 0.36], 'seat', rot=[0.12, 0, 0]), B('seat', [0.26, 0.18, 0.08], [0, 0.6, 0.41], 'seat')]
    for sx in (-1, 1):
        v += [B('lboom', [0.14, 0.3, 2.3], [sx * 0.75, 0, -1.15], 'yellow'), C('lboom', 0.17, 0.17, 0.2, [sx * 0.75, 0, 0], 'yellow2', rot=AX),
              C('lboom', 0.16, 0.16, 0.2, [sx * 0.75, 0, -2.3], 'yellow2', rot=AX), C('lboom', 0.06, 0.06, 0.8, [sx * 0.75, 0.3, -0.6], 'black', rot=[1.35, 0, 0]),
              C('lboom', 0.035, 0.035, 0.8, [sx * 0.75, 0.42, -1.3], 'chrome', rot=[1.35, 0, 0])]
    v += [C('lboom', 0.09, 0.09, 1.5, [0, 0, -1.5], 'yellow2', rot=AX)]
    v += loader_bucket('lbucket', 1.1, -0.25, 0.12, -1.0, 7)
    v += [B('slew', [0.44, 0.9, 0.44], [0, 0.22, 0.1], 'dark'), C('slew', 0.14, 0.14, 0.5, [0, 0.3, 0.2], 'chrome', rot=AX)]
    hb = 'hboom'
    v += [B(hb, [0.26, 0.4, 2.6], [0, 0, 1.3], 'yellow'), B(hb, [0.3, 0.52, 0.7], [0, 0, 0.35], 'yellow'), B(hb, [0.2, 0.3, 1.5], [0, 0.26, 1.35], 'yellow', taper=[1, 0.6]),
          C(hb, 0.16, 0.16, 0.34, [0, 0, 2.6], 'yellow2', rot=AX), C(hb, 0.075, 0.075, 1.0, [0, 0.52, 0.75], 'black', rot=AZ), C(hb, 0.04, 0.04, 1.0, [0, 0.52, 1.7], 'chrome', rot=AZ),
          C(hb, 0.07, 0.07, 1.1, [0, -0.36, 0.65], 'black', rot=[1.2, 0, 0])]
    dp = 'dipper'
    v += [B(dp, [0.2, 0.3, 1.9], [0, 0, 0.95], 'yellow'), B(dp, [0.24, 0.44, 0.55], [0, 0.03, 0.22], 'yellow'), C(dp, 0.13, 0.13, 0.3, [0, 0, 1.9], 'yellow2', rot=AX),
          C(dp, 0.065, 0.065, 0.8, [0, 0.3, 0.6], 'black', rot=AZ), C(dp, 0.035, 0.035, 0.8, [0, 0.3, 1.35], 'chrome', rot=AZ), B(dp, [0.1, 0.1, 0.5], [0, 0.22, 1.72], 'yellow2')]
    k = 'hbucket'; W = 0.3
    v += [B(k, [0.62, 0.05, 0.75], [0, 0.02, 0.375], 'dark'), B(k, [0.62, 0.5, 0.05], [0, -0.22, 0.0], 'dark'), B(k, [0.62, 0.05, 0.3], [0, -0.45, 0.12], 'dark', rot=[0.5, 0, 0]),
          B(k, [0.66, 0.05, 0.1], [0, 0.02, 0.77], 'chrome'), B(k, [0.2, 0.16, 0.2], [0, 0.1, 0.02], 'yellow2')]
    for sx in (-1, 1): v += [B(k, [0.04, 0.47, 0.72], [sx * W, -0.2, 0.36], 'dark'), B(k, [0.05, 0.2, 0.12], [sx * (W + 0.02), -0.1, 0.72], 'chrome')]
    v += teeth(k, 4, W, 0.02, 0.8, length=0.2, forward=1)
    for node, sx in (('legL', -1), ('legR', 1)):
        v += [B(node, [1.15, 0.18, 0.22], [sx * 0.575, 0, 0], 'yellow'), B(node, [0.7, 0.09, 0.1], [sx * 0.6, 0.13, 0], 'chrome'),
              B(node, [0.42, 0.07, 0.52], [sx * 1.15, -0.06, 0], 'dark'), C(node, 0.1, 0.1, 0.26, [sx * 0.02, 0, 0], 'yellow2', rot=AZ)]
    return v

FLOOR = {'loader': (2.0, 1.55, 'rear'), 'dumper': (1.8, 1.6, 'front'), 'dozer': (1.75, 1.55, 'chassis'), 'backhoe': (1.55, 1.45, 'chassis')}
RAILS = {'loader': (1.33, -1.2), 'dumper': (1.3, -3.08), 'dozer': (1.36, 1.25), 'backhoe': (1.2, -1.32)}
BUILD = {'loader': loader, 'dumper': dumper, 'dozer': dozer, 'backhoe': backhoe}
for name, fn in BUILD.items():
    d = load(name); new, first, cabBody = FLOOR[name]
    dy = round(new - d.get('cabFloor', first), 4)       # move the cab's contents with its floor (once: the height is remembered)
    if dy:
        for c in d['controls']:
            if c['type'] != 'handrail': c['pos'][1] = round(c['pos'][1] + dy, 4)
        seatNode = d['seat']['node']
        moved = False
        for n in d.get('nodes', []):
            if n['name'] == seatNode: n['pos'][1] = round(n['pos'][1] + dy, 4); moved = True
        if not moved: d['seat']['eye'][1] = round(d['seat']['eye'][1] + dy, 4)
        if 'placard' in d: d['placard']['pos'][1] = round(d['placard']['pos'][1] + dy, 4)
        for b in d['bodies']:
            for c in b.get('colliders', []):
                if c['size'] == [1.7, 1.8, 1.7]: c['pos'][1] = round(c['pos'][1] + dy, 4)
    d['cabFloor'] = new
    lx, lz = RAILS[name]                      # the handrail is the ladder's outer stile
    for c in d['controls']:
        if c['type'] == 'handrail': c['pos'] = [round((1 if c['pos'][0] > 0 else -1) * (lx + 0.06), 3), 1.5, round(lz + 0.21, 3)]; c['length'] = 1.6
    d['visuals'] = fn()
    dump(name, d); print(name, len(d['visuals']), 'parts, cab floor', new)
