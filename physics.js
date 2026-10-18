const GRAVITY = 25;
const FOOT_CLEARANCE = 2.2;
const BODY_RADIUS = 1.15;
const MAX_SPEED = 78;
const EPSILON = 0.002;
const HORSE_MASS = 520;
const MAX_TETHER_ACCELERATION = 115;
const STREET_CLEARANCE = 17;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const length = (vector) => Math.hypot(vector.x, vector.y, vector.z);
const copy = (vector) => ({ x: vector.x, y: vector.y, z: vector.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

function collider(building) {
  return {
    minX: (building.minX ?? building.x - building.width / 2) - BODY_RADIUS,
    maxX: (building.maxX ?? building.x + building.width / 2) + BODY_RADIUS,
    minY: -80,
    maxY: building.height + FOOT_CLEARANCE,
    minZ: (building.minZ ?? building.z - building.depth / 2) - BODY_RADIUS,
    maxZ: (building.maxZ ?? building.z + building.depth / 2) + BODY_RADIUS,
  };
}

// Sweep the horse's center against an expanded building. Unlike endpoint tests,
// this catches a fast horse crossing an entire thin wall within one frame.
function sweepBox(start, delta, box) {
  // Reject disjoint swept bounds before the comparatively expensive slab test.
  if (Math.max(start.x, start.x + delta.x) < box.minX || Math.min(start.x, start.x + delta.x) > box.maxX ||
      Math.max(start.y, start.y + delta.y) < box.minY || Math.min(start.y, start.y + delta.y) > box.maxY ||
      Math.max(start.z, start.z + delta.z) < box.minZ || Math.min(start.z, start.z + delta.z) > box.maxZ) return null;
  let entry = -Infinity;
  let exit = Infinity;
  let normal = null;
  for (const axis of ['x', 'y', 'z']) {
    const upper = axis.toUpperCase();
    const min = box[`min${upper}`];
    const max = box[`max${upper}`];
    if (Math.abs(delta[axis]) < 1e-10) {
      if (start[axis] <= min || start[axis] >= max) return null;
      continue;
    }
    let near = (min - start[axis]) / delta[axis];
    let far = (max - start[axis]) / delta[axis];
    const sign = delta[axis] > 0 ? -1 : 1;
    if (near > far) [near, far] = [far, near];
    if (near > entry) {
      entry = near;
      normal = { x: 0, y: 0, z: 0, [axis]: sign };
    }
    exit = Math.min(exit, far);
    if (entry > exit) return null;
  }
  if (entry < -1e-8 || entry > 1 || exit < 0 || !normal) return null;
  return { fraction: Math.max(0, entry), normal };
}

/** Metre / second simulation, independent of the renderer or frame rate. */
export class SwingPhysics {
  constructor({ buildings = [], anchors = [], spawn = { x: 0, y: 45, z: 50 }, bounds = {}, fatalGround = false, initialVelocity = { x: 0, y: 0, z: -16 } } = {}) {
    this.buildings = buildings.map(collider);
    // Rope visibility uses building surfaces, not the horse's enlarged collision hull.
    this.ropeObstacles = this.buildings.map(box => ({ ...box,
      minX: box.minX + BODY_RADIUS - .15, maxX: box.maxX - BODY_RADIUS + .15,
      minZ: box.minZ + BODY_RADIUS - .15, maxZ: box.maxZ - BODY_RADIUS + .15,
      maxY: box.maxY - FOOT_CLEARANCE + .6,
    }));
    this.anchors = anchors;
    this.spawn = copy(spawn);
    this.initialVelocity = copy(initialVelocity);
    this.fatalGround = fatalGround;
    this.bounds = {
      minX: -800,
      maxX: 800,
      minZ: -1400,
      maxZ: 500,
      maxY: 500,
      ...bounds,
    };
    this.resetCount = -1;
    this.reset();
  }

  reset() {
    this.pos = copy(this.spawn);
    this.vel = copy(this.initialVelocity);
    this.lost = false;
    this.yaw = 0;
    this.grounded = this.pos.y <= FOOT_CLEARANCE;
    this.anchor = null;
    this.selectedAnchor = null;
    this.selectedForward = false;
    this.viewYaw = 0;
    this.recommendedAnchor = null;
    this.recommendationUntil = 0;
    this.previousAnchor = null;
    this.anchorRanking = null;
    this.ropeLength = 0;
    this.launchReelTarget = null;
    this.maxRopeLength = 0;
    this.tension = 0;
    this.tensionForce = 0;
    this.stretch = 0;
    this.stretchRatio = 0;
    this.attachmentCount = 0;
    this.attachedAt = -Infinity;
    this.soarUntil = -Infinity;
    this.catchForwardX = 0; this.catchForwardZ = -1;
    this.catchLength = 0;
    this.swingPeakForward = 0;
    this.swingRearmAt = Infinity;
    this.pointZip = null;
    this.pointLaunchUntil = -Infinity;
    this.airZipUntil = -Infinity;
    this.zipBurstAt = -Infinity;
    this.pointLaunchDirection = { x:0, z:-1 };
    this.wallRun = null;
    this.wallRecoveryUntil = -Infinity;
    this.vaultUntil = -Infinity;
    this.releasedAt = -Infinity;
    this.lastSnap = null;
    this.nextAnchorCheck = 0;
    this.heldAttachmentSpent = false;
    this.energy = 1;
    this.time = 0;
    this.distanceTravelled = 0;
    this.lastImpact = null;
    this.resetCount += 1;
    return this.snapshot();
  }

  reachableAnchors(maxDistance = 145) {
    return this.anchors.filter(candidate => {
      const delta = { x: candidate.x - this.pos.x, y: candidate.y - this.pos.y, z: candidate.z - this.pos.z };
      const distance = length(delta);
      return distance >= 3 && distance <= maxDistance && !this.ropeObstacles.some(box => sweepBox(this.pos, delta, box));
    }).sort((a, b) => Math.hypot(a.x-this.pos.x,a.y-this.pos.y,a.z-this.pos.z) - Math.hypot(b.x-this.pos.x,b.y-this.pos.y,b.z-this.pos.z));
  }

  // Forecast the first useful release, then check a short stretch of its flight.
  // Copies own mutable vectors; ranking never advances the real horse.
  evaluateAnchor(anchor, buildings = this.buildings, obstacles = this.ropeObstacles) {
    const preview = Object.assign(Object.create(SwingPhysics.prototype), this, {
      pos: copy(this.pos), vel: copy(this.vel), anchor: null, lastImpact: null,
      buildings, ropeObstacles: obstacles, fatalGround: true,
    });
    preview.connect(anchor);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const forward = speed > 3 ? { x: this.vel.x / speed, z: this.vel.z / speed }
      : { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
    let clearance = this.pos.y - FOOT_CLEARANCE, impact = 0, blocked = false;
    let release = null, interrupted = false, samplesUsed = 0;
    const input = { forward: 0, strafe: 0, turn: 0, reel: 0, boost: false, swingHeld: false };
    const observe = () => {
      clearance = Math.min(clearance, preview.pos.y - FOOT_CLEARANCE);
      impact = Math.max(impact, preview.lastImpact?.speed || 0);
    };
    // Two seconds at 30 Hz, with at most eight additional flight samples.
    for (let i = 0; i < 60 && !preview.lost; i++) {
      preview.integrate(1 / 30, input); samplesUsed++; observe();
      if (!preview.anchor) { interrupted = true; break; }
      const delta = { x: anchor.x - preview.pos.x, y: anchor.y - preview.pos.y, z: anchor.z - preview.pos.z };
      blocked ||= obstacles.some(box => sweepBox(preview.pos, delta, box));
      if (blocked) break;
      if (preview.releaseAssist() > 0) {
        preview.jumpAction();
        const horizontal = Math.hypot(preview.vel.x, preview.vel.z);
        release = {
          velocity: copy(preview.vel), position: copy(preview.pos), time: preview.time - this.time,
          forwardSpeed: preview.vel.x * forward.x + preview.vel.z * forward.z,
          lateralSpeed: Math.abs(preview.vel.x * forward.z - preview.vel.z * forward.x),
          pitch: Math.atan2(preview.vel.y, horizontal) * 180 / Math.PI,
        };
        // Reject a good-looking launch that immediately runs into a facade.
        for (let flight = 0; flight < 8 && !preview.lost; flight++) {
          preview.integrate(1 / 30, input); samplesUsed++; observe();
        }
        break;
      }
    }
    const distance = Math.hypot(anchor.x-this.pos.x, anchor.y-this.pos.y, anchor.z-this.pos.z);
    const launchScore = release
      ? 200 + release.forwardSpeed * 8 + Math.min(release.velocity.y, 20) * 2
        - release.lateralSpeed * 3 - Math.abs(release.pitch - 30) * 2 - release.time * 8
      : -250; // Reachable fallback, but no useful release within this horizon.
    const score = (preview.lost ? -10000 : 0) - impact * 60 - (blocked ? 1500 : 0)
      - (interrupted ? 800 : 0) - Math.max(0, 12 - clearance) * 25
      + Math.min(clearance, 25) * 2 + launchScore - distance * .12;
    return { anchor, score, clearance, impact, blocked, lost: preview.lost, interrupted, release, samplesUsed };
  }

  rankedAnchors() {
    const cache = this.anchorRanking;
    if (cache && this.time - cache.time < .2 && cache.yaw === this.yaw && cache.viewYaw === this.viewYaw &&
      Math.hypot(this.pos.x-cache.pos.x,this.pos.y-cache.pos.y,this.pos.z-cache.pos.z) < 2 &&
      Math.hypot(this.vel.x-cache.vel.x,this.vel.y-cache.vel.y,this.vel.z-cache.vel.z) < 3) return cache.ranked;
    // Local broad phase bounds the swing and brief release-flight forecast. Limit previews, reserving candidates on both sides.
    const nearby = this.reachableAnchors(75);
    const ahead = a => this.viewAlignment(a) >= Math.cos(50 * Math.PI / 180);
    const pool = [...nearby.filter(ahead).slice(0,12), ...nearby.filter(a => !ahead(a)).slice(0,12)];
    const local = boxes => boxes.filter(b => b.maxX > this.pos.x-240 && b.minX < this.pos.x+240 && b.maxZ > this.pos.z-240 && b.minZ < this.pos.z+240);
    const buildings = local(this.buildings), obstacles = local(this.ropeObstacles);
    const evaluations = pool.map(a => this.evaluateAnchor(a, buildings, obstacles)).sort((a,b) => b.score-a.score);
    const ranked = evaluations.map(result => result.anchor);
    this.anchorRanking = { time:this.time, pos:copy(this.pos), vel:copy(this.vel), yaw:this.yaw, viewYaw:this.viewYaw, ranked, evaluations };
    return ranked;
  }

  selectableAnchors() {
    const ranked = this.rankedAnchors();
    const choices = ranked.slice(0,5);
    // Keep an explicitly chosen reachable pivot stable while momentum changes.
    if (this.selectedAnchor && ranked.includes(this.selectedAnchor) && !choices.includes(this.selectedAnchor)) {
      choices[choices.length-1] = this.selectedAnchor;
    }
    return choices;
  }

  isReachableAnchor(candidate) {
    if (!candidate || !this.anchors.includes(candidate)) return false;
    const delta = { x: candidate.x - this.pos.x, y: candidate.y - this.pos.y, z: candidate.z - this.pos.z };
    const distance = length(delta);
    return distance >= 3 && distance <= 75 && !this.ropeObstacles.some(box => sweepBox(this.pos, delta, box));
  }

  viewAlignment(candidate, yaw = this.viewYaw) {
    const x = candidate.x - this.pos.x, z = candidate.z - this.pos.z;
    const distance = Math.hypot(x,z);
    return distance > .01 ? (x * -Math.sin(yaw) + z * -Math.cos(yaw)) / distance : -1;
  }

  isForwardAnchor(candidate) {
    if (!candidate) return false;
    if (this.previousAnchor && candidate.x === this.previousAnchor.x && candidate.y === this.previousAnchor.y && candidate.z === this.previousAnchor.z) return false;
    return this.viewAlignment(candidate) >= Math.cos(50 * Math.PI / 180);
  }

  forwardCandidates() {
    const ranked = this.rankedAnchors();
    const score = (a) => (this.anchorRanking?.evaluations?.find(result => result.anchor === a)?.score ?? -ranked.indexOf(a))
      - 500 * (1 - this.viewAlignment(a));
    return ranked.filter(a => this.isForwardAnchor(a) && this.isReachableAnchor(a)).sort((a,b) => score(b)-score(a));
  }

  findAnchor() {
    if (this.selectedAnchor && this.isReachableAnchor(this.selectedAnchor) && (!this.selectedForward || this.isForwardAnchor(this.selectedAnchor))) return this.selectedAnchor;
    this.selectedAnchor = null;
    if (this.time < this.recommendationUntil && this.isReachableAnchor(this.recommendedAnchor) && this.isForwardAnchor(this.recommendedAnchor)) return this.recommendedAnchor;
    this.recommendedAnchor = this.forwardCandidates()[0] || null;
    this.recommendationUntil = this.time + .45;
    return this.recommendedAnchor;
  }

  selectAnchor(direction) {
    this.selectedForward = false;
    this.anchorRanking = null;
    const candidates = this.selectableAnchors();
    if (!candidates.length) { this.selectedAnchor = null; return null; }
    if (direction === 0) { this.selectedAnchor = candidates[0]; return this.selectedAnchor; }
    const current = this.selectedAnchor || this.anchor || candidates[0];
    const index = candidates.findIndex(a => a.x === current.x && a.y === current.y && a.z === current.z);
    this.selectedAnchor = candidates[((index < 0 ? 0 : index) + direction + candidates.length) % candidates.length];
    return this.selectedAnchor;
  }

  selectDirectionalAnchor(yaw, direction) {
    this.viewYaw = yaw;
    this.selectedForward = false;
    this.anchorRanking = null;
    const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw);
    const candidate = this.rankedAnchors().find(a =>
      ((a.x - this.pos.x) * forwardX + (a.z - this.pos.z) * forwardZ) * direction > .01);
    if (!candidate) return null;
    this.selectedAnchor = candidate;
    return candidate;
  }

  selectNextForwardAnchor(yaw, current = null) {
    this.viewYaw = yaw;
    this.selectedForward = true;
    const candidates = this.forwardCandidates();
    if (!candidates.length) {
      this.selectedAnchor = null; this.recommendedAnchor = null; this.recommendationUntil = 0;
      return null;
    }
    const index = candidates.findIndex(a => current && a.x === current.x && a.y === current.y && a.z === current.z);
    this.selectedAnchor = candidates[(index + 1) % candidates.length];
    return this.selectedAnchor;
  }

  attach(candidate = undefined) {
    if (this.lost) return false;
    if (this.anchor) return true;
    // An explicit target is the one shown by the HUD. Never silently replace
    // it at keydown if movement has made it invalid.
    if (candidate === undefined) candidate = this.findAnchor();
    if (!this.isReachableAnchor(candidate)) return false;
    if ((candidate !== this.selectedAnchor || this.selectedForward) && !this.isForwardAnchor(candidate)) return false;
    this.connect(candidate);
    return true;
  }

  connect(candidate) {
    if (this.lost || this.anchor) return;
    this.swingRearmAt = Infinity;
    this.pointZip = null; this.pointLaunchUntil = -Infinity;
    this.heldAttachmentSpent = true;
    this.anchor = { ...candidate };
    const distance = Math.hypot(this.pos.x - candidate.x, this.pos.y - candidate.y, this.pos.z - candidate.z);
    // The initial preload catches falling momentum progressively. Connection
    // never replaces airborne velocity or teleports the horse onto a sphere.
    this.ropeLength = Math.max(12, distance);
    this.launchReelTarget = Math.max(12, Math.min(this.ropeLength, candidate.y - STREET_CLEARANCE));
    this.maxRopeLength = this.ropeLength + 1.2;
    this.soarUntil = -Infinity;
    this.releasedAt = -Infinity;
    this.wallRun = null; this.vaultUntil = -Infinity;
    this.catchLength = this.ropeLength;
    const horizontalSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.catchForwardX = horizontalSpeed > 1 ? this.vel.x / horizontalSpeed : -Math.sin(this.yaw);
    this.catchForwardZ = horizontalSpeed > 1 ? this.vel.z / horizontalSpeed : -Math.cos(this.yaw);
    this.swingPeakForward = horizontalSpeed;
    this.attachedAt = this.time;
    this.attachmentCount += 1;
    this.nextAnchorCheck = this.time + 0.45;
    if (this.grounded || this.pos.y < FOOT_CLEARANCE + 3) {
      // Deliberate street launch, distinct from airborne spring attachment.
      this.pos.y += 0.06;
      this.vel.y = Math.max(this.vel.y, 18);
      this.vel.x -= Math.sin(this.yaw) * 5;
      this.vel.z -= Math.cos(this.yaw) * 5;
    }
    this.grounded = false;
    this.updateTetherState();
  }

  releaseAssist() {
    // Representative early launch sample for anchor ranking (not a player timing gate).
    if (!this.anchor || this.vel.y < 3 || this.time - this.attachedAt < .2) return 0;
    const state = this.updateTetherState();
    const angle = Math.atan2(Math.hypot(state.radial.x, state.radial.z), -state.radial.y);
    const forward = this.vel.x * this.catchForwardX + this.vel.z * this.catchForwardZ;
    if (state.distance < this.ropeLength - .3 || angle < .35 || angle > .7 || forward < 8) return 0;
    return 3;
  }

  swingTelemetry() {
    const ready = !!this.anchor && !this.lost && !this.grounded && this.time - this.attachedAt >= .12 && this.releaseAssist() > 0;
    const angle = this.anchor ? Math.atan2(Math.hypot(this.pos.x - this.anchor.x, this.pos.z - this.anchor.z), this.anchor.y - this.pos.y) * 180 / Math.PI : null;
    const phase = !this.anchor ? (this.time < this.soarUntil ? 'Soaring' : 'Detached') : this.vel.y > 1 ? 'Rising' : this.vel.y < -1 ? 'Descending' : 'Turning';
    return { ready, angle, phase, speed: length(this.vel), verticalSpeed: this.vel.y, lastSnap: this.lastSnap };
  }

  release({ launch = false, intentional = false, boosted = true } = {}) {
    if (!launch) { this.swingRearmAt = Infinity; this.soarUntil = -Infinity; this.releasedAt = -Infinity; }
    if (launch && this.anchor && !this.lost && !this.grounded && this.time - this.attachedAt >= .12) {
      this.releasedAt = this.time;
      const snap = this.releaseAssist();
      const speedBefore = length(this.vel);
      if (snap > 0) {
        // Small assist along the existing trajectory; no fabricated upward floor.
        const speed = length(this.vel);
        const scale = (speed + snap) / Math.max(speed, 1);
        this.vel.x *= scale; this.vel.y *= scale; this.vel.z *= scale;
        this.limitSpeed();
        this.soarUntil = this.time + .65;
        this.lastSnap = { time: this.time, before: speedBefore, after: length(this.vel), gain: length(this.vel) - speedBefore };
      }
    }
    if (intentional && this.anchor && !this.lost && !this.grounded) {
      this.releasedAt = this.time;
      // A bounded kick along the existing trajectory rewards a committed swing.
      if (boosted && this.time - this.attachedAt >= .3 && this.vel.y >= 0) {
        const speed = length(this.vel);
        if (speed > 8) {
          const factor = (speed + Math.min(6, speed * .15)) / speed;
          this.vel.x *= factor; this.vel.y *= factor; this.vel.z *= factor;
          this.limitSpeed();
        }
      }
      if (this.vel.y >= 0) this.soarUntil = this.time + .85;
    }
    const wasAttached = this.anchor !== null;
    if (this.anchor) {
      this.previousAnchor = { ...this.anchor };
      if (this.selectedAnchor && this.selectedAnchor.x === this.anchor.x && this.selectedAnchor.y === this.anchor.y && this.selectedAnchor.z === this.anchor.z) this.selectedAnchor = null;
      this.recommendedAnchor = null; this.recommendationUntil = 0; this.anchorRanking = null;
    }
    this.anchor = null;
    this.launchReelTarget = null;
    this.tension = 0;
    this.tensionForce = 0;
    this.stretch = 0;
    this.stretchRatio = 0;
    return wasAttached;
  }

  maintainHeldSwing(candidate = undefined) {
    if (this.time >= this.swingRearmAt) { this.heldAttachmentSpent = false; this.swingRearmAt = Infinity; }
    if (this.anchor && !this.grounded && !this.lost) {
      const forward = this.vel.x * this.catchForwardX + this.vel.z * this.catchForwardZ;
      this.swingPeakForward = Math.max(this.swingPeakForward, forward);
      const state = this.updateTetherState();
      const angle = Math.atan2(Math.hypot(state.radial.x, state.radial.z), -state.radial.y);
      // Finish the useful ascending arc before forward progress collapses.
      // Never force a release during the catch, initial dive, or slack flight.
      if (this.time - this.attachedAt > .45 && this.vel.y > 2 &&
          state.distance >= this.ropeLength - .3 && angle > Math.PI / 5 &&
          this.swingPeakForward > 12 && forward < this.swingPeakForward * .78) {
        this.release({intentional:true});
        this.swingRearmAt = this.time + .7;
        this.heldAttachmentSpent = true;
      }
      return;
    }
    // Only intentional swing exits rearm; collision breaks still require a new press.
    if (this.pointZip || this.wallRun || this.time < this.vaultUntil || this.anchor || this.heldAttachmentSpent || this.time < this.nextAnchorCheck) return;
    this.nextAnchorCheck = this.time + 0.12;
    this.attach(candidate);
  }

  soarWeight() {
    if (this.anchor || this.grounded || this.lost) return 0;
    const remaining = clamp((this.soarUntil - this.time) / .45, 0, 1);
    const descent = clamp((this.vel.y + 8) / 8, 0, 1);
    const smooth = x => x * x * (3 - 2 * x);
    return smooth(remaining) * smooth(descent);
  }

  updateTetherState() {
    if (!this.anchor) return;
    const radial = {
      x: this.pos.x - this.anchor.x,
      y: this.pos.y - this.anchor.y,
      z: this.pos.z - this.anchor.z,
    };
    const distance = length(radial);
    const compliance = Math.max(0, 1 - (this.time - this.attachedAt) / .18);
    this.maxRopeLength = this.ropeLength + 1.2 * compliance;
    this.stretch = Math.max(0, distance - this.ropeLength);
    this.stretchRatio = clamp(this.stretch / 1.2, 0, 1);
    // Load is a presentation estimate, not a competing spring force.
    this.tensionForce = distance >= this.ropeLength - .1 ? HORSE_MASS * Math.min(MAX_TETHER_ACCELERATION, length(this.vel) ** 2 / Math.max(distance, 1) + GRAVITY * Math.max(0, -radial.y / Math.max(distance, 1))) : 0;
    this.tension = this.tensionForce / (HORSE_MASS * MAX_TETHER_ACCELERATION);
    return { radial, distance };
  }

  applyTether(dt, reel) {
    if (!this.anchor) return;
    this.ropeLength = clamp(this.ropeLength - reel * dt * 15, 12, 145);
    // One bounded target-length controller, including street clearance.
    if (reel >= 0 && this.launchReelTarget !== null) {
      this.ropeLength = Math.max(this.launchReelTarget, this.ropeLength - dt * 14);
      if (this.ropeLength <= this.launchReelTarget) this.launchReelTarget = null;
    }
    const state = this.updateTetherState();
    if (!state || state.distance < 1e-6) return;
    const below = -state.radial.y / state.distance;
    // Assist only within 35 degrees of the bottom and only while taut.
    if (below > Math.cos(35 * Math.PI / 180) && state.distance >= this.ropeLength - .1 && this.time - this.attachedAt >= .18) {
      const radialForward = (this.catchForwardX * state.radial.x + this.catchForwardZ * state.radial.z) / state.distance ** 2;
      const tangent = { x: this.catchForwardX - state.radial.x * radialForward, y: -state.radial.y * radialForward, z: this.catchForwardZ - state.radial.z * radialForward };
      const magnitude = length(tangent);
      if (magnitude > .2) {
        const along = dot(this.vel, tangent) / magnitude;
        const assist = along >= 0 ? Math.min(18 * dt, Math.max(0, 38 - along)) : 0;
        this.vel.x += tangent.x / magnitude * assist;
        this.vel.y += tangent.y / magnitude * assist;
        this.vel.z += tangent.z / magnitude * assist;
      }
    }
  }

  contextualAction(yaw, candidate = undefined) {
    const near = this.pointZip && this.pointZip.stage === 1 && length({x:this.pos.x-this.pointZip.landing.x,y:this.pos.y-this.pointZip.landing.y,z:this.pos.z-this.pointZip.landing.z}) < 8;
    if (near || this.time <= this.pointLaunchUntil) return {label:'Launch', kind:'jump'};
    if (this.pointZip) return {label:'Zip', kind:'wait'};
    if (this.anchor || this.grounded) return {label:'Jump', kind:'jump'};
    const target = candidate === undefined ? this.pointCandidate(yaw) : candidate && this.pointCandidate(yaw, candidate.anchor);
    return target ? {label:'Zip', kind:'perch', target} : {label:'Jump', kind:'jump'};
  }

  contextualJump(yaw, candidate = undefined) {
    const action = this.contextualAction(yaw, candidate);
    if (action.kind === 'wait') return false;
    if (action.kind === 'perch') return this.zipToPoint(action.target);
    return this.jumpAction();
  }

  pointCandidate(yaw, onlyAnchor = null) {
    let best=null, bestScore=-Infinity;
    for (const anchor of this.anchors) {
      if (onlyAnchor && anchor !== onlyAnchor) continue;
      const alignment=this.viewAlignment(anchor,yaw);
      if(alignment<Math.cos(Math.PI/15))continue;
      const box=this.buildings.find(b=>Math.abs(anchor.y-b.maxY)<3 && anchor.x>=b.minX-1 && anchor.x<=b.maxX+1 && anchor.z>=b.minZ-1 && anchor.z<=b.maxZ+1);
      if(!box)continue;
      const xSide=anchor.x<(box.minX+box.maxX)/2 ? -1 : 1;
      const zSide=anchor.z<(box.minZ+box.maxZ)/2 ? -1 : 1;
      const staging={x:xSide<0?box.minX-.5:box.maxX+.5,y:box.maxY+3,z:zSide<0?box.minZ-.5:box.maxZ+.5};
      const delta={x:staging.x-this.pos.x,y:staging.y-this.pos.y,z:staging.z-this.pos.z};
      const distance=length(delta);
      if(Math.abs(delta.y)>Math.hypot(delta.x,delta.z)*.75 || distance<5 || distance>65 || this.buildings.some(b=>sweepBox(this.pos,delta,b)))continue;
      const landing={x:clamp(anchor.x,box.minX+2,box.maxX-2),y:box.maxY+3,z:clamp(anchor.z,box.minZ+2,box.maxZ-2)};
      const score=alignment*100-distance*.5;
      if(score>bestScore){bestScore=score;best={anchor,staging,landing};}
    }
    return best;
  }

  zipToPoint(candidate) {
    if(this.lost || this.pointZip || !candidate)return false;
    // Validate against current geometry, not a stale marker or caller-provided path.
    const yaw=Math.atan2(-(candidate.anchor.x-this.pos.x),-(candidate.anchor.z-this.pos.z));
    const current=this.pointCandidate(yaw,candidate.anchor);
    if(!current || current.anchor!==candidate.anchor)return false;
    this.release(); this.wallRun=null; this.vaultUntil=-Infinity;
    const dx=current.landing.x-this.pos.x,dz=current.landing.z-this.pos.z,n=Math.hypot(dx,dz)||1;
    this.pointLaunchDirection={x:dx/n,z:dz/n};
    this.pointZip={...current,stage:0,until:this.time+2.5};
    this.zipBurstAt=this.time;
    this.pointLaunchUntil=-Infinity; this.heldAttachmentSpent=true; this.grounded=false;
    return true;
  }

  pointLaunch() {
    const near=this.pointZip && this.pointZip.stage===1 && Math.hypot(this.pos.x-this.pointZip.landing.x,this.pos.y-this.pointZip.landing.y,this.pos.z-this.pointZip.landing.z)<8;
    if(this.lost || (!near && this.time>this.pointLaunchUntil))return false;
    this.pointZip=null; this.pointLaunchUntil=-Infinity; this.grounded=false;
    this.vel={x:this.pointLaunchDirection.x*32,y:15,z:this.pointLaunchDirection.z*32};
    this.releasedAt=this.time; this.soarUntil=this.time+.45;
    return true;
  }

  jumpAction() {
    if(this.lost)return false;
    if(this.pointLaunch())return true;
    if(this.pointZip)return false;
    if(this.grounded)return this.jump();
    if(this.anchor) {
      const before = length(this.vel);
      const horizontal = Math.hypot(this.vel.x, this.vel.z);
      const angle = Math.atan2(Math.hypot(this.pos.x-this.anchor.x, this.pos.z-this.anchor.z), this.anchor.y-this.pos.y);
      // A continuous speed/height tradeoff across the ascent, not a timing gate.
      const ascent = clamp(this.vel.y / 3, 0, 1);
      const progress = clamp(angle / (Math.PI / 2), 0, 1);
      const heightBias = progress * progress * (3 - 2 * progress) * ascent;
      const forwardPush = 7 - 5 * heightBias;
      const lift = 3 + 6 * heightBias;
      const dx = horizontal > 1 ? this.vel.x / horizontal : this.catchForwardX;
      const dz = horizontal > 1 ? this.vel.z / horizontal : this.catchForwardZ;
      this.release({intentional:true, boosted:false});
      this.vel.x += dx * forwardPush; this.vel.z += dz * forwardPush;
      this.vel.y += lift;
      this.limitSpeed();
      this.lastSnap = {time:this.time, before, after:length(this.vel), gain:length(this.vel)-before};
      this.releasedAt=this.time; this.heldAttachmentSpent=true; this.swingRearmAt=this.time+.55;
      return true;
    }
    // A short forward web zip needs geometry and cannot be spammed for flight.
    if(this.time<this.airZipUntil || !this.findAnchor())return false;
    const speed=Math.min(72, Math.max(42, Math.hypot(this.vel.x,this.vel.z)+18));
    this.vel.x=-Math.sin(this.viewYaw)*speed;this.vel.z=-Math.cos(this.viewYaw)*speed;
    this.vel.y=Math.max(this.vel.y,-2);this.airZipUntil=this.time+.8;
    this.releasedAt=this.time;this.zipBurstAt=this.time;this.soarUntil=this.time+.7;this.limitSpeed();return true;
  }

  updatePointZip(dt) {
    const zip=this.pointZip;
    if(!zip)return false;
    if(this.time>zip.until){this.pointZip=null;return false;}
    let target=zip.stage===0?zip.staging:zip.landing;
    let delta={x:target.x-this.pos.x,y:target.y-this.pos.y,z:target.z-this.pos.z};
    let distance=length(delta);
    if(distance<.4) {
      if(zip.stage===0){this.pointZip={...zip,stage:1};return true;}
      this.pointZip=null;this.pointLaunchUntil=this.time+.2;this.vel={x:0,y:0,z:0};return true;
    }
    const speed=Math.min(68,distance/dt);
    this.vel={x:delta.x/distance*speed,y:delta.y/distance*speed,z:delta.z/distance*speed};
    const collided=this.move({x:this.vel.x*dt,y:this.vel.y*dt,z:this.vel.z*dt});
    if(collided){this.pointZip=null;this.pointLaunchUntil=-Infinity;}
    return true;
  }

  jump() {
    if (this.lost) return false;
    if (!this.grounded) return false;
    this.grounded = false;
    this.pos.y += 0.06;
    this.vel.y = 17;
    this.vel.x -= Math.sin(this.yaw) * 5;
    this.vel.z -= Math.cos(this.yaw) * 5;
    return true;
  }

  boost() {
    if (this.lost) return false;
    if (this.energy < 0.2) return false;
    this.energy = Math.max(0, this.energy - 0.2);
    this.vel.x -= Math.sin(this.yaw) * 11;
    this.vel.z -= Math.cos(this.yaw) * 11;
    this.vel.y += this.grounded ? 9 : 3;
    this.grounded = false;
    this.limitSpeed();
    return true;
  }

  step(dt, { forward = 0, strafe = 0, turn = 0, reel = 0, boost = false, swingHeld = false, swingTarget = undefined } = {}) {
    if (this.lost || !Number.isFinite(dt) || dt <= 0) return this.snapshot();
    // Drop excess time after a background tab resumes; never integrate a huge
    // single step. At normal frame rates the same fixed upper step is used.
    const frameTime = Math.min(dt, 0.12);
    const count = Math.ceil(frameTime / (1 / 120));
    const h = frameTime / count;
    const input = {
      forward: clamp(Number(forward) || 0, -1, 1),
      strafe: clamp(Number(strafe) || 0, -1, 1),
      turn: clamp(Number(turn) || 0, -1, 1),
      reel: clamp(Number(reel) || 0, -1, 1),
      boost: Boolean(boost),
      swingHeld: Boolean(swingHeld),
      swingTarget,
    };
    for (let index = 0; index < count && !this.lost; index += 1) this.integrate(h, input);
    if (
      ![this.pos.x, this.pos.y, this.pos.z, this.vel.x, this.vel.y, this.vel.z].every(Number.isFinite) ||
      this.pos.y < -45 || this.pos.y > this.bounds.maxY + 100 ||
      this.pos.x < this.bounds.minX - 50 || this.pos.x > this.bounds.maxX + 50 ||
      this.pos.z < this.bounds.minZ - 50 || this.pos.z > this.bounds.maxZ + 50
    ) this.reset();
    return this.snapshot();
  }

  integrate(dt, input) {
    this.time += dt;
    this.yaw += input.turn * dt * 1.5;
    if(this.pointZip) {
      const before=copy(this.pos);
      if(this.updatePointZip(dt)) {
        this.distanceTravelled+=Math.hypot(this.pos.x-before.x,this.pos.z-before.z);
        this.resolveGround();this.enforceBounds();return;
      }
    }
    if (input.swingHeld) this.maintainHeldSwing(input.swingTarget);
    else { this.heldAttachmentSpent = false; this.swingRearmAt = Infinity; }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const acceleration = this.grounded ? 39 : this.anchor ? 13 : 10;
    this.vel.x += (-sin * input.forward + cos * input.strafe) * acceleration * dt;
    this.vel.z += (-cos * input.forward - sin * input.strafe) * acceleration * dt;
    const soarWeight = this.soarWeight();
    this.vel.y -= GRAVITY * (1 - .15 * soarWeight) * dt;
    if (!this.grounded && input.turn) {
      // Rotate momentum rather than adding speed; steering works in swing and air.
      const angle = input.turn * dt * (this.anchor ? .85 : 1.15);
      const x = this.vel.x, z = this.vel.z;
      if (this.anchor) {
        const state = this.updateTetherState();
        const n = { x: state.radial.x / state.distance, y: state.radial.y / state.distance, z: state.radial.z / state.distance };
        const radialSpeed = dot(this.vel, n);
        const tangent = { x: x - n.x * radialSpeed, y: this.vel.y - n.y * radialSpeed, z: z - n.z * radialSpeed };
        const speed = length(tangent);
        const lateral = { x: tangent.z, y: 0, z: -tangent.x };
        const outward = dot(lateral, n);
        tangent.x += (lateral.x - n.x * outward) * angle;
        tangent.y -= n.y * outward * angle;
        tangent.z += (lateral.z - n.z * outward) * angle;
        const scale = speed / Math.max(length(tangent), 1e-9);
        this.vel = { x: tangent.x * scale + n.x * radialSpeed, y: tangent.y * scale + n.y * radialSpeed, z: tangent.z * scale + n.z * radialSpeed };
      } else {
        this.vel.x = x * Math.cos(angle) + z * Math.sin(angle);
        this.vel.z = z * Math.cos(angle) - x * Math.sin(angle);
      }
      const fx = this.catchForwardX, fz = this.catchForwardZ;
      this.catchForwardX = fx * Math.cos(angle) + fz * Math.sin(angle);
      this.catchForwardZ = fz * Math.cos(angle) - fx * Math.sin(angle);
      this.anchorRanking = null;
      this.recommendationUntil = 0;
    }

    if (input.boost && this.energy > 0) {
      const poweredTime = Math.min(dt, this.energy / 0.28);
      this.energy = Math.max(0, this.energy - poweredTime * 0.28);
      this.vel.x -= sin * 31 * poweredTime;
      this.vel.z -= cos * 31 * poweredTime;
      this.vel.y += 5 * poweredTime;
    } else if (!input.boost) {
      this.energy = Math.min(1, this.energy + dt * (this.grounded ? 0.23 : 0.13));
    }
    const drag = Math.exp(-dt * (this.grounded ? 1.65 : this.anchor ? 0.035 : (.06 - .045 * soarWeight)));
    this.vel.x *= drag;
    this.vel.z *= drag;
    this.updateWallRun();
    this.applyTether(dt, input.reel);
    this.limitSpeed();

    const before = copy(this.pos);
    this.grounded = false;
    this.resolveOverlap();
    this.move({ x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt }, true);
    // Street contact is terminal before a taut rope can pull us back up.
    if (this.fatalGround) { this.resolveGround(); if (this.lost) return; }
    this.constrainRope();
    this.resolveGround();
    this.enforceBounds();
    this.updateTetherState();
    if (this.grounded) { this.soarUntil = -Infinity; this.wallRun = null; this.vaultUntil = -Infinity; }
    this.distanceTravelled += Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
  }

  limitSpeed() {
    const speed = length(this.vel);
    if (speed > MAX_SPEED) {
      const factor = MAX_SPEED / speed;
      this.vel.x *= factor;
      this.vel.y *= factor;
      this.vel.z *= factor;
    }
  }

  recordImpact(normal, kind = 'building') {
    const speed = Math.max(0, -dot(this.vel, normal));
    if (speed > 4) this.soarUntil = -Infinity;
    if (speed > 4) this.lastImpact = { time: this.time, speed, normal: copy(normal), kind };
  }

  beginWallRun(box, normal) {
    const incoming = Math.hypot(this.vel.x, this.vel.z);
    if (this.wallRun || this.grounded || this.lost || this.time < this.wallRecoveryUntil ||
        Math.abs(normal.y) > .1 || this.pos.y < FOOT_CLEARANCE + 2 || incoming < 8 || -dot(this.vel, normal) < 4) return;
    this.release();
    this.heldAttachmentSpent = true;
    this.wallRun = { box, normal: copy(normal), until: this.time + 1.15, speed: incoming, climb: clamp(incoming * .7, 14, 28) };
    this.wallRecoveryUntil = this.time + 2.4;
    this.vel.y = Math.max(this.vel.y, this.wallRun.climb);
  }

  updateWallRun() {
    const wall = this.wallRun;
    if (!wall) return;
    const {box, normal} = wall;
    const gap = normal.x ? Math.abs(this.pos.x - (normal.x < 0 ? box.minX : box.maxX)) : Math.abs(this.pos.z - (normal.z < 0 ? box.minZ : box.maxZ));
    const beside = normal.x ? this.pos.z >= box.minZ && this.pos.z <= box.maxZ : this.pos.x >= box.minX && this.pos.x <= box.maxX;
    if (this.lost || this.grounded || this.time > wall.until || gap > 2 || !beside) { this.wallRun = null; return; }
    if (this.pos.y > box.maxY + .15) {
      // Clearance is earned by climbing: sweep the vault normally, never teleport.
      const into = dot(this.vel, normal);
      const forward = clamp(wall.speed * .8, 14, 32);
      this.vel.x -= normal.x * (into + forward);
      this.vel.z -= normal.z * (into + forward);
      this.vel.y = Math.max(7, Math.min(this.vel.y, 12));
      this.wallRun = null;
      this.vaultUntil = this.time + .45;
      return;
    }
    this.vel.y = Math.max(this.vel.y, wall.climb);
    const into = dot(this.vel, normal);
    this.vel.x -= normal.x * (into + 2);
    this.vel.z -= normal.z * (into + 2);
  }

  move(displacement, recover = false) {
    let delta = { ...displacement };
    let collided = false;
    for (let pass = 0; pass < 3; pass += 1) {
      if (length(delta) < 1e-8) break;
      let nearest = null;
      for (const building of this.buildings) {
        const hit = sweepBox(this.pos, delta, building);
        if (hit && (!nearest || hit.fraction < nearest.fraction)) nearest = { ...hit, box: building };
      }
      if (!nearest) {
        this.pos.x += delta.x;
        this.pos.y += delta.y;
        this.pos.z += delta.z;
        break;
      }
      collided = true;
      const { fraction, normal } = nearest;
      this.pos.x += delta.x * fraction + normal.x * EPSILON;
      this.pos.y += delta.y * fraction + normal.y * EPSILON;
      this.pos.z += delta.z * fraction + normal.z * EPSILON;
      this.recordImpact(normal);
      if (recover) this.beginWallRun(nearest.box, normal);
      const intoWall = dot(this.vel, normal);
      if (intoWall < 0) {
        this.vel.x -= normal.x * intoWall;
        this.vel.y -= normal.y * intoWall;
        this.vel.z -= normal.z * intoWall;
      }
      if (normal.y > 0.5) this.grounded = true;
      delta.x *= 1 - fraction;
      delta.y *= 1 - fraction;
      delta.z *= 1 - fraction;
      const remainingIntoWall = dot(delta, normal);
      if (remainingIntoWall < 0) {
        delta.x -= normal.x * remainingIntoWall;
        delta.y -= normal.y * remainingIntoWall;
        delta.z -= normal.z * remainingIntoWall;
      }
    }
    return collided;
  }

  resolveOverlap() {
    for (const box of this.buildings) {
      if (
        this.pos.x <= box.minX || this.pos.x >= box.maxX ||
        this.pos.y <= box.minY || this.pos.y >= box.maxY ||
        this.pos.z <= box.minZ || this.pos.z >= box.maxZ
      ) continue;
      const exits = [
        { distance: this.pos.x - box.minX, axis: 'x', value: box.minX - EPSILON, normal: { x: -1, y: 0, z: 0 } },
        { distance: box.maxX - this.pos.x, axis: 'x', value: box.maxX + EPSILON, normal: { x: 1, y: 0, z: 0 } },
        { distance: this.pos.z - box.minZ, axis: 'z', value: box.minZ - EPSILON, normal: { x: 0, y: 0, z: -1 } },
        { distance: box.maxZ - this.pos.z, axis: 'z', value: box.maxZ + EPSILON, normal: { x: 0, y: 0, z: 1 } },
        { distance: box.maxY - this.pos.y, axis: 'y', value: box.maxY + EPSILON, normal: { x: 0, y: 1, z: 0 } },
      ];
      const exit = exits.reduce((best, item) => item.distance < best.distance ? item : best);
      this.pos[exit.axis] = exit.value;
      this.recordImpact(exit.normal);
      if (this.vel[exit.axis] * exit.normal[exit.axis] < 0) this.vel[exit.axis] = 0;
      if (exit.normal.y > 0) this.grounded = true;
    }
  }

  constrainRope() {
    if (!this.anchor) return;
    const radial = {
      x: this.pos.x - this.anchor.x,
      y: this.pos.y - this.anchor.y,
      z: this.pos.z - this.anchor.z,
    };
    const distance = length(radial);
    // Catch compliance tapers into a firm pendulum limit. Remove outward
    // radial motion at that limit while retaining tangential momentum.
    if (distance <= this.maxRopeLength || distance < 1e-6) return;
    radial.x /= distance;
    radial.y /= distance;
    radial.z /= distance;
    const excess = distance - this.maxRopeLength;
    this.move({ x: -radial.x * excess, y: -radial.y * excess, z: -radial.z * excess });
    const outward = dot(this.vel, radial);
    if (outward > 0) {
      this.vel.x -= radial.x * outward;
      this.vel.y -= radial.y * outward;
      this.vel.z -= radial.z * outward;
    }
    // A wall obstructing a shortened tether must never drag the horse through
    // a building. Break the tether while preserving the collision response.
    if (Math.hypot(this.pos.x - this.anchor.x, this.pos.y - this.anchor.y, this.pos.z - this.anchor.z) > this.maxRopeLength + 0.25) this.release();
  }

  resolveGround() {
    if (this.vel.y <= 0) {
      for (const roof of this.buildings) {
        if (
          this.pos.x > roof.minX && this.pos.x < roof.maxX &&
          this.pos.z > roof.minZ && this.pos.z < roof.maxZ &&
          this.pos.y >= roof.maxY && this.pos.y < roof.maxY + 0.012
        ) {
          this.pos.y = roof.maxY + EPSILON;
          this.vel.y = 0;
          this.grounded = true;
        }
      }
    }
    if (this.pos.y <= FOOT_CLEARANCE) {
      this.recordImpact({ x: 0, y: 1, z: 0 }, 'ground');
      this.pos.y = FOOT_CLEARANCE;
      if (this.fatalGround) {
        this.lost = true; this.grounded = true; this.release();
        this.vel = { x: 0, y: 0, z: 0 };
        return;
      }
      this.vel.y = Math.max(0, this.vel.y);
      this.grounded = this.vel.y < 0.1;
      // A tether shorter than the distance to a grounded horse cannot remain
      // taut without pulling it underground; release it for a clean landing.
      if (this.anchor && Math.hypot(this.pos.x - this.anchor.x, this.pos.y - this.anchor.y, this.pos.z - this.anchor.z) > this.maxRopeLength + 0.01) this.release();
    }
  }

  enforceBounds() {
    for (const axis of ['x', 'z']) {
      const suffix = axis.toUpperCase();
      const min = this.bounds[`min${suffix}`];
      const max = this.bounds[`max${suffix}`];
      if (this.pos[axis] < min - 50 || this.pos[axis] > max + 50) continue;
      if (this.pos[axis] < min || this.pos[axis] > max) {
        this.pos[axis] = clamp(this.pos[axis], min, max);
        this.vel[axis] *= -0.2;
        this.release();
      }
    }
  }

  snapshot() {
    return {
      pos: copy(this.pos),
      vel: copy(this.vel),
      yaw: this.yaw,
      traversalPhase: this.pointZip ? 'point-zip' : this.grounded ? 'grounded' : this.wallRun ? 'wall-run' : this.time < this.vaultUntil ? 'vault' : this.anchor ? (this.time - this.attachedAt < .18 ? 'catch' : 'swing') : this.time < this.soarUntil ? 'soar' : 'air',
      grounded: this.grounded,
      lost: this.lost,
      anchor: this.anchor ? { ...this.anchor } : null,
      ropeLength: this.ropeLength,
      maxRopeLength: this.maxRopeLength,
      tension: this.tension,
      tensionForce: this.tensionForce,
      stretch: this.stretch,
      stretchRatio: this.stretchRatio,
      attachmentCount: this.attachmentCount,
      attachedAt: this.attachedAt,
      energy: this.energy,
      speed: length(this.vel),
      verticalSpeed: this.vel.y,
      time: this.time,
      distanceTravelled: this.distanceTravelled,
      resetCount: this.resetCount,
      lastImpact: this.lastImpact ? { ...this.lastImpact, normal: copy(this.lastImpact.normal) } : null,
    };
  }
}
