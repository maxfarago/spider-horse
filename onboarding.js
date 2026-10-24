// Simulation time keeps the lesson independent of frame rate and time spent paused.
export class SwingOnboarding {
  constructor() { this.stage = 'done'; }
  reset() { this.stage = 'fall'; this.anchor = null; }
  get waiting() { return this.stage === 'hold' || this.stage === 'release'; }
  update(physics) {
    if (this.stage === 'fall' && physics.time >= .5) {
      this.anchor = physics.findAnchor();
      if (this.anchor) this.stage = 'hold';
    }
    if (this.stage === 'swing' && physics.anchor && physics.time - physics.attachedAt >= .3 && physics.vel.y >= 10) this.stage = 'release';
  }
  press() { if (this.stage === 'hold') this.stage = 'swing'; }
  release() { if (this.stage === 'release') this.stage = 'done'; }
}
