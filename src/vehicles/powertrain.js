// The diesel and what loads it: a torque balance on the flywheel, so the engine note is a consequence of the work
// being done rather than a number mixed up for the sound.
//
//   governor  all-speed, with droop: it adds fuel as the engine falls below the speed the throttle asks for, so a
//             loaded engine runs a little slower and a lot harder (the sound of "working")
//   turbo     boost follows fuel and speed with a lag; fuel is held back until boost arrives (the smoke limiter),
//             so a sudden load makes the engine sag, smoke, then pull back up as the turbo spools
//   torque    rises toward ~60 % of rated speed: an engine dragged down by load digs in rather than dying
//   loads     the caller sums shaft torque from the hydraulic pump (displacement x pressure) and the drive
//             (torque converter or hydrostatic), see Machine.pre
//
// No DOM, audio or three.js here: it runs in the deterministic sim step and in unit tests.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const RAD = Math.PI / 30; // rpm → rad/s

export class Powertrain {
  /** @param {{idleRpm?: number, maxRpm?: number, power?: number, droop?: number, inertia?: number}} def power in watts at maxRpm */
  constructor({ idleRpm = 800, maxRpm = 2200, power = 150000, droop = 0.08, inertia } = {}) {
    this.idle = idleRpm; this.max = maxRpm; this.power = power; this.droop = droop;
    this.Tr = power / (maxRpm * RAD);          // rated torque, N m
    this.J = inertia ?? this.Tr * 0.0042;      // flywheel + pump + converter: idle to full speed in about a second, unloaded
    this.rpm = 0; this.fuel = 0; this.boost = 0; this.smoke = 0; this.lug = 0; this.torque = 0;
  }

  /** Full-fuel torque at this speed (N m). */
  torqueMax(rpm) {
    const x = rpm / this.max;
    return this.Tr * Math.max(0, 1.28 - 1.94 * (x - 0.62) * (x - 0.62)) * clamp((x - 0.1) / 0.18, 0, 1);
  }
  /** Friction, pumping losses and the fan (N m). */
  friction(rpm) { return this.Tr * (0.05 + 0.15 * rpm / this.max); }

  /**
   * @param {number} dt seconds
   * @param {{running: boolean, cranking?: boolean, target?: number, load?: number}} s
   *        target: the speed the governor is set to (rpm); load: shaft torque taken by pump and drive (N m)
   */
  step(dt, { running, cranking = false, target = this.idle, load = 0 }) {
    const w = this.rpm * RAD;
    if (!running) {
      this.fuel = 0; this.smoke = 0; this.lug = 0; this.torque = 0;
      this.boost += (0 - this.boost) * Math.min(1, dt / 0.5);
      if (cranking) this.rpm += (230 - this.rpm) * Math.min(1, dt / 0.12);               // the starter turns it over
      else this.rpm = Math.max(0, (w - (this.friction(this.rpm) * 3 + this.Tr * 0.08) / this.J * dt) / RAD); // runs down against compression
      return this;
    }
    target = clamp(target, this.idle, this.max);
    // governor: full fuel by the time the engine is `droop` below the set speed; the rack takes a moment to move
    const want = clamp((target - this.rpm) / (this.droop * target), 0, 1);
    const limit = 0.6 + 0.4 * this.boost;                                               // no air, no fuel
    const cmd = Math.min(want, limit);
    this.fuel += clamp(cmd - this.fuel, -10 * dt, 7 * dt);
    this.smoke = clamp((this.fuel - (0.45 + 0.55 * this.boost)) * 5, 0, 1); // more fuel than there is air to burn it
    // turbo: spins up on exhaust energy (fuel x speed), slower to build than to fall away
    const bt = clamp(this.fuel * 1.5 - 0.12, 0, 1) * Math.pow(clamp((this.rpm - this.idle * 0.8) / (this.max - this.idle * 0.8), 0.1, 1), 0.6);
    this.boost += (bt - this.boost) * Math.min(1, dt / (bt > this.boost ? 0.75 : 0.45));
    // anti-stall: pump and converter let go as the engine is dragged far below idle
    load *= clamp((this.rpm - this.idle * 0.5) / (this.idle * 0.3), 0, 1);
    this.torque = this.fuel * this.torqueMax(this.rpm);
    const net = this.torque - this.friction(this.rpm) - load;
    this.rpm = Math.max(this.idle * 0.45, (w + net / this.J * dt) / RAD);
    this.lug = clamp((target * (1 - this.droop) - this.rpm) / (target * 0.2), 0, 1);     // dragged below the governed band
    return this;
  }
}
