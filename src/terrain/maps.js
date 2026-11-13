// Hand-built maps. A map is a function that fills a TerrainCore column by column, plus placement data
// (spawn points, hopper, river) the game reads. Deterministic: no RNG, only analytic shapes.
import { TOPSOIL, MUD, CLAY, SAND, GRAVEL } from './materials.js';
import { smooth } from '../util/rng.js';

const wob = (x, z) => Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.05 + Math.sin(x * 0.07 + 1.3) * Math.sin(z * 0.09 + 0.4) * 0.07;

export const MAPS = {
  // 40 m test patch: topsoil over clay, a sand heap and a gravel heap. Used by unit tests and the stress scene.
  test: {
    cfg: { nx: 160, nz: 160, cell: 0.25, ox: -20, oz: -20 },
    spawn: { loader: [0, 6, 0], dumper: [-8, 4, 0], dozer: [8, 8, 0], backhoe: [-6, 12, 0] },
    build(core) {
      const { nx, nz, cell, ox, oz } = core.cfg;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = ox + i * cell, z = oz + j * cell;
        const layers = [[CLAY, 2.2], [TOPSOIL, 0.3]];
        const r1 = Math.hypot(x - 5, z + 8), r2 = Math.hypot(x + 6, z + 10);
        if (r1 < 6) layers.push([SAND, Math.min(2.4, 3.0 * (1 - r1 / 6))]);
        else if (r2 < 4) layers.push([GRAVEL, Math.min(1.8, 2.4 * (1 - r2 / 4))]);
        core.setColumn(j * nx + i, -2.5, layers);
      }
    },
  },

  // The MVP map: yard on the top terrace, three terraces stepping down (south = +z), river, sand site beyond.
  dirttown: {
    cfg: { nx: 480, nz: 480, cell: 0.25, ox: -60, oz: -60 },
    spawn: { loader: [-4, -44, Math.PI], dumper: [4, -44, Math.PI], dozer: [-12, -42, Math.PI], backhoe: [12, -42, Math.PI], player: [0, -50, Math.PI] },
    hopper: { x: -24, z: -46, w: 5, d: 4, depth: 1.2, target: 20 },
    river: { z: 20, halfWidth: 3.5, level: 0, bed: -1.0, x0: -60, x1: 60 },
    sandSite: { x: 0, z: 42, r: 14 },
    riverZ: (x) => 20 + 1.5 * Math.sin(x * 0.08),
    build(core) {
      const { nx, nz, cell, ox, oz } = core.cfg, me = MAPS.dirttown;
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const x = ox + i * cell, z = oz + j * cell;
        // terraces: 9 m yard, 6 m, 3 m, then the river flat at 0.8 m; banks are ~3 m wide
        const b1 = smooth(-30, -26.8, z), b2 = smooth(-12, -8.8, z), b3 = smooth(6, 8.6, z);
        let g = 9 - 3 * b1 - 3 * b2 - 2.2 * b3;
        const onBank = [b1, b2, b3].some((b) => b > 0.02 && b < 0.98); // bare clay faces: topsoil would slide off
        const dr = Math.abs(z - me.riverZ(x));           // distance from the river centreline
        const chan = smooth(7, 2.5, dr);                  // 0 on the bank → 1 in the channel
        const south = smooth(26, 34, z);                  // sand site rises gently
        g += south * 0.8;
        const edge = Math.min(i, j, nx - 1 - i, nz - 1 - j) * cell;
        g += wob(x, z) * smooth(0, 4, edge) * (1 - chan);
        const surface = g - chan * 1.8;                   // channel bed ≈ -1.0
        const bed = Math.min(surface - 0.05, g - 4.5 + chan * 2.2);
        const depth = surface - bed;
        let layers;
        const rs = Math.hypot(x - me.sandSite.x, z - me.sandSite.z);
        if (chan > 0.97) layers = [[CLAY, depth - 0.3], [SAND, 0.3]];
        else if (chan > 0 || onBank) layers = [[CLAY, depth]];
        else if (dr < 12) layers = [[CLAY, depth - 1.2], [MUD, 1.2]];                 // muddy river flats
        else if (rs < me.sandSite.r) layers = [[CLAY, depth - 3.6], [SAND, 3.6]];    // the sand deposit
        else layers = [[CLAY, depth - 0.3], [TOPSOIL, 0.3]];
        const rg = Math.hypot(x - 22, z + 46);            // gravel stockpile in the yard
        if (rg < 5.5) layers.push([GRAVEL, Math.min(3.0, 4.0 * (1 - rg / 5.5))]);
        // the hopper is a pit in the yard: bare floor, nothing to dig or slump
        const hp = me.hopper;
        if (Math.abs(x - hp.x) < hp.w / 2 + 0.3 && Math.abs(z - hp.z) < hp.d / 2 + 0.3) { core.setColumn(j * nx + i, 9 - hp.depth - 0.05, []); continue; }
        core.setColumn(j * nx + i, bed, layers);
      }
    },
  },
};
