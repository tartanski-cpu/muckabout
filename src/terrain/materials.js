// Material table shared by the terrain core, renderer and vehicles.
export const NONE = 0, TOPSOIL = 1, MUD = 2, CLAY = 3, SAND = 4, GRAVEL = 5, ROCK = 6;
export const NMAT = 7;

// repose/reposeWet: degrees. dig: relative resistance to cutting. compaction: how much tyres rut it.
// erosion: how readily flowing water carries it off. grip: tyre friction coefficient.
export const MATERIALS = [
  { name: 'none',    density: 0,    repose: 45, reposeWet: 45, dig: 0,   compaction: 0,    erosion: 0,    grip: 0.8,  color: [0, 0, 0],          chip: 0 },
  { name: 'topsoil', density: 1400, repose: 40, reposeWet: 26, dig: 1.0, compaction: 0.3,  erosion: 0.5,  grip: 0.75, color: [0.47, 0.30, 0.17], chip: 3 },
  { name: 'mud',     density: 1700, repose: 28, reposeWet: 14, dig: 0.8, compaction: 0.5,  erosion: 1.0,  grip: 0.42, color: [0.33, 0.24, 0.16], chip: 2 },
  { name: 'clay',    density: 1800, repose: 58, reposeWet: 34, dig: 1.8, compaction: 0.1,  erosion: 0.2,  grip: 0.6,  color: [0.66, 0.36, 0.20], chip: 2 },
  { name: 'sand',    density: 1600, repose: 33, reposeWet: 24, dig: 0.7, compaction: 0.25, erosion: 0.6,  grip: 0.6,  color: [0.86, 0.72, 0.45], chip: 0 },
  { name: 'gravel',  density: 1750, repose: 38, reposeWet: 34, dig: 1.2, compaction: 0.05, erosion: 0.02, grip: 0.92, color: [0.56, 0.54, 0.50], chip: 1 },
  { name: 'rock',    density: 2600, repose: 85, reposeWet: 85, dig: 99,  compaction: 0,    erosion: 0,    grip: 0.85, color: [0.42, 0.41, 0.40], chip: 0 },
];
export const GRASS_COLOR = [0.33, 0.52, 0.18];
export const matId = (name) => MATERIALS.findIndex((m) => m.name === name);
