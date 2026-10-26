export const OPENING_SPAWN = Object.freeze({ x: 144, y: 125, z: -550 });

// Simulation time excludes pauses, so every lesson gets actual flight time.
export class SwingOnboarding {
  constructor() { this.stage = 'done'; }
  reset() { this.stage = 'fall'; this.anchor = null; this.target = null; this.readyAt = .7; this.nextForecast = 0; }
  get waiting() { return ['hold', 'release', 'boost', 'zip'].includes(this.stage); }
  get freeControl() { return ['done', 'seek-zip'].includes(this.stage); }
  updateContext(physics, action) {
    if (physics.time < this.readyAt || physics.lost || physics.grounded || physics.anchor || physics.wallRun || physics.pointZip) return;
    if (this.stage === 'fall' && action.boostReady) this.stage = 'boost';
    else if (this.stage === 'seek-zip' && action.kind === 'perch' && action.target?.anchor) {
      this.target = action.target; this.stage = 'zip';
    }
  }
  shift(succeeded, time) {
    if (!succeeded) return;
    if (this.stage === 'boost') { this.stage = 'seek-swing'; this.readyAt = time + .3; }
    else if (this.stage === 'zip') { this.stage = 'done'; this.target = null; }
  }
  update(physics) {
    if (this.stage === 'seek-swing' && physics.time >= this.readyAt && physics.time >= this.nextForecast && !physics.lost && !physics.grounded && !physics.wallRun) {
      this.nextForecast = physics.time + .15;
      const anchor = physics.findAnchor();
      if (anchor) {
        // Wait for a roof that supports a complete rising arc, not just a catch.
        const local = boxes => boxes.filter(b => b.maxX > physics.pos.x-240 && b.minX < physics.pos.x+240 && b.maxZ > physics.pos.z-240 && b.minZ < physics.pos.z+240);
        const forecast = physics.anchorRanking?.evaluations?.find(result => result.anchor === anchor)
          || physics.evaluateAnchor(anchor, local(physics.buildings), local(physics.ropeObstacles), local(physics.rooftopObstacles));
        if (forecast.release && forecast.release.time >= .7 && !forecast.blocked && !forecast.lost && !forecast.interrupted) {
          this.anchor = anchor; this.stage = 'hold';
        }
      }
    }
    if (this.stage === 'swing' && physics.anchor && physics.time - physics.attachedAt >= .7 && physics.vel.y >= 10) this.stage = 'release';
  }
  press() { if (this.stage === 'hold') this.stage = 'swing'; }
  release(time) { if (this.stage === 'release') { this.stage = 'seek-zip'; this.readyAt = time + 1.2; } }
}
