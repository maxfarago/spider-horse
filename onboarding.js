export const OPENING_SPAWN = Object.freeze({ x: 144, y: 125, z: -550 });

// Simulation time excludes pauses, so every lesson gets actual flight time.
export class SwingOnboarding {
  constructor() { this.stage = 'done'; }
  reset() { this.stage = 'fall'; this.anchor = null; this.target = null; this.readyAt = .7; this.nextForecast = 0; this.leapHeight = null; this.faceGoalOnLanding = false; this.turnCheckpoint = null; }
  get waiting() { return ['hold', 'release', 'boost', 'zip', 'leap', 'turn', 'goal-release', 'complete'].includes(this.stage); }
  get steeringLocked() { return this.faceGoalOnLanding === true; }
  get freeControl() { return ['done', 'seek-zip', 'turning'].includes(this.stage); }
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
    else if (this.stage === 'zip') { this.stage = 'landing'; this.target = null; }
    else if (this.stage === 'leap') { this.stage = 'seek-turn'; this.readyAt = time + .45; }
  }
  update(physics, goal = null, steer = 0, swingHeld = false) {
    if (this.stage === 'seek-turn' && physics.time >= this.readyAt && physics.vel.y <= -18 && (this.leapHeight === null || physics.pos.y <= this.leapHeight - 8) && !physics.lost && !physics.grounded && !physics.pointZip && !physics.wallRun) {
      const anchor = physics.findAnchor();
      if (anchor) {
        const heading = Math.atan2(-physics.vel.x, -physics.vel.z);
        const goalYaw = goal ? Math.atan2(-(goal.x-physics.pos.x), -(goal.z-physics.pos.z)) : heading + Math.PI/2;
        const difference = Math.atan2(Math.sin(goalYaw-heading), Math.cos(goalYaw-heading));
        this.direction = difference >= 0 ? 1 : -1;
        this.anchor = anchor; this.stage = 'turn'; this.turnTime = 0; this.lastTurnTime = physics.time;
        this.captureTurn(physics);
      }
    }
    if (this.stage === 'turning') {
      const dt = Math.max(0, physics.time - this.lastTurnTime); this.lastTurnTime = physics.time;
      if (physics.anchor && swingHeld && steer * this.direction > .25) this.turnTime += dt;
      const heading = Math.atan2(-physics.vel.x, -physics.vel.z);
      const goalYaw = goal ? Math.atan2(-(goal.x-physics.pos.x), -(goal.z-physics.pos.z)) : heading;
      const error = Math.abs(Math.atan2(Math.sin(goalYaw-heading), Math.cos(goalYaw-heading)));
      if (this.turnTime >= .35 && physics.anchor && physics.vel.y >= 3 && error <= Math.PI / 18) this.stage = 'goal-release';
      else if (!physics.anchor && !physics.lost) { this.stage = 'seek-turn'; this.readyAt = physics.time + .15; }
    }
    if (this.stage === 'landing' && !physics.lost) {
      if (!physics.perch && !physics.pointZip) { this.stage = 'seek-zip'; this.readyAt = physics.time + .3; }
    }
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
  cameraSettled(physics) {
    if (this.stage !== 'landing' || !physics.perch || physics.lost) return false;
    this.stage = 'leap'; this.leapHeight = physics.pos.y;
    return true;
  }
  captureTurn(physics) {
    const shared = new Set(['buildings','rooftopObstacles','ropeObstacles','anchors','island','bounds','spawn','initialVelocity','anchorRanking','recommendedAnchor','selectedAnchor','previousAnchor']);
    const state = Object.fromEntries(Object.entries(physics).filter(([key]) => !shared.has(key)));
    this.turnCheckpoint = {state:structuredClone(state), anchor:this.anchor, direction:this.direction};
  }
  retryTurn(physics) {
    if (this.stage !== 'turning' || !this.turnCheckpoint) return false;
    const saved = this.turnCheckpoint;
    Object.assign(physics, structuredClone(saved.state));
    physics.anchorRanking = null; physics.recommendedAnchor = null; physics.selectedAnchor = null;
    this.anchor = saved.anchor; this.direction = saved.direction;
    this.stage = 'turn'; this.turnTime = 0; this.lastTurnTime = physics.time;
    return true;
  }
  faceLanding(physics, goal) {
    if (!this.faceGoalOnLanding || physics.lost || !physics.grounded) return false;
    this.faceGoalOnLanding = false;
    if (!goal) return false;
    const dx = goal.x - physics.pos.x, dz = goal.z - physics.pos.z;
    if (Math.hypot(dx, dz) < .1) return false;
    physics.yaw = Math.atan2(-dx, -dz);
    physics.viewYaw = physics.yaw;
    this.stage = 'complete';
    return true;
  }
  finish() { if (this.stage === 'complete') this.stage = 'done'; }
  press() { if (this.stage === 'hold') this.stage = 'swing'; else if (this.stage === 'turn') this.stage = 'turning'; }
  release(time) { if (this.stage === 'goal-release') { this.stage = 'done'; this.faceGoalOnLanding = true; return; } if (this.stage === 'release') { this.stage = 'seek-zip'; this.readyAt = time + 1.2; } }
}
