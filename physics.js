const GRAVITY = 25;
const FOOT_CLEARANCE = 2.2;
const BODY_RADIUS = 1.15;
const MAX_SPEED = 78;
const EPSILON = 0.002;
const HORSE_MASS = 520;
// A tensile spring (never a rigid pendulum): k/m = 17 s^-2 and damping
// ratio 0.067 retains a strong, playful rebound while still dissipating energy.
const SPRING_STIFFNESS = HORSE_MASS * 17;
const SPRING_DAMPING = HORSE_MASS * 0.55;
const MAX_TETHER_ACCELERATION = 115;
const STREET_CLEARANCE = 17;
const stretchAllowance = (restLength) => clamp(restLength * 0.4, 16, 30);

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

  // Preview the same spring, winch and collision rules used during play. Copies
  // own all mutable state; evaluating a catch never advances the real horse.
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
    let flow = 0, rise = 0;
    const input = { forward: 0, strafe: 0, turn: 0, reel: 0, boost: false, swingHeld: false };
    // Ranking needs a coarse forecast, not 240 full gameplay substeps. Swept
    // collisions still catch thin walls between these 30Hz prediction samples.
    const samples = 60;
    for (let i = 0; i < samples && !preview.lost; i++) {
      preview.integrate(2 / samples, input);
      clearance = Math.min(clearance, preview.pos.y - FOOT_CLEARANCE);
      impact = Math.max(impact, preview.lastImpact?.speed || 0);
      flow += (preview.vel.x * forward.x + preview.vel.z * forward.z) / samples;
      rise = Math.max(rise, preview.vel.y);
      // A clear initial line is insufficient: the swinging cord may hit a wall.
      if (i % 3 === 0) {
        const delta = { x: anchor.x - preview.pos.x, y: anchor.y - preview.pos.y, z: anchor.z - preview.pos.z };
        blocked ||= obstacles.some(box => sweepBox(preview.pos, delta, box));
      }
    }
    const distance = Math.hypot(anchor.x-this.pos.x, anchor.y-this.pos.y, anchor.z-this.pos.z);
    const score = (preview.lost ? -10000 : 0) - impact * 30 - (blocked ? 1500 : 0)
      - Math.max(0, 12 - clearance) * 25 + Math.min(clearance, 25) * 2
      + flow * 3 + Math.min(rise, 30) * .7 - distance * .12;
    return { anchor, score, clearance, impact, blocked, lost: preview.lost };
  }

  rankedAnchors() {
    const cache = this.anchorRanking;
    if (cache && this.time - cache.time < .2 && cache.yaw === this.yaw &&
      Math.hypot(this.pos.x-cache.pos.x,this.pos.y-cache.pos.y,this.pos.z-cache.pos.z) < 2 &&
      Math.hypot(this.vel.x-cache.vel.x,this.vel.y-cache.vel.y,this.vel.z-cache.vel.z) < 3) return cache.ranked;
    // Local broad phase bounds all possible two-second travel, including a
    // stretched cord. Limit previews, reserving candidates on both sides.
    const nearby = this.reachableAnchors(75);
    const ahead = a => (a.x-this.pos.x)*-Math.sin(this.yaw)+(a.z-this.pos.z)*-Math.cos(this.yaw) >= 0;
    const pool = [...nearby.filter(ahead).slice(0,12), ...nearby.filter(a => !ahead(a)).slice(0,12)];
    const local = boxes => boxes.filter(b => b.maxX > this.pos.x-240 && b.minX < this.pos.x+240 && b.maxZ > this.pos.z-240 && b.minZ < this.pos.z+240);
    const buildings = local(this.buildings), obstacles = local(this.ropeObstacles);
    const ranked = pool.map(a => this.evaluateAnchor(a, buildings, obstacles)).sort((a,b) => b.score-a.score).map(result => result.anchor);
    this.anchorRanking = { time:this.time, pos:copy(this.pos), vel:copy(this.vel), yaw:this.yaw, ranked };
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

  findAnchor() {
    const candidates = this.selectableAnchors();
    if (this.selectedAnchor && candidates.includes(this.selectedAnchor)) return this.selectedAnchor;
    this.selectedAnchor = null;
    return candidates[0] || null;
  }

  selectAnchor(direction) {
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
    this.anchorRanking = null;
    const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw);
    const candidate = this.rankedAnchors().find(a =>
      ((a.x - this.pos.x) * forwardX + (a.z - this.pos.z) * forwardZ) * direction > .01);
    if (!candidate) return null;
    this.selectedAnchor = candidate;
    return candidate;
  }

  attach() {
    if (this.lost) return false;
    if (this.anchor) return true;
    this.anchorRanking = null;
    const candidate = this.findAnchor();
    if (!candidate) return false;
    this.connect(candidate);
    return true;
  }

  connect(candidate) {
    if (this.lost || this.anchor) return;
    this.heldAttachmentSpent = true;
    this.anchor = { ...candidate };
    const distance = Math.hypot(this.pos.x - candidate.x, this.pos.y - candidate.y, this.pos.z - candidate.z);
    // The initial preload catches falling momentum progressively. Connection
    // never replaces airborne velocity or teleports the horse onto a sphere.
    this.ropeLength = Math.max(12, distance - 2.8);
    this.launchReelTarget = Math.max(12, Math.min(this.ropeLength, candidate.y - STREET_CLEARANCE - stretchAllowance(this.ropeLength)));
    this.maxRopeLength = this.ropeLength + stretchAllowance(this.ropeLength);
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

  release() {
    const wasAttached = this.anchor !== null;
    this.anchor = null;
    this.launchReelTarget = null;
    this.tension = 0;
    this.tensionForce = 0;
    this.stretch = 0;
    this.stretchRatio = 0;
    return wasAttached;
  }

  maintainHeldSwing() {
    // Retry only the initial catch. A held cord never transfers to a new roof,
    // including after a collision breaks it; the player must release first.
    if (this.anchor || this.heldAttachmentSpent || this.time < this.nextAnchorCheck) return;
    this.nextAnchorCheck = this.time + 0.12;
    this.attach();
  }

  updateTetherState() {
    if (!this.anchor) return;
    const radial = {
      x: this.pos.x - this.anchor.x,
      y: this.pos.y - this.anchor.y,
      z: this.pos.z - this.anchor.z,
    };
    const distance = length(radial);
    this.maxRopeLength = this.ropeLength + stretchAllowance(this.ropeLength);
    this.stretch = Math.max(0, distance - this.ropeLength);
    this.stretchRatio = clamp(this.stretch / stretchAllowance(this.ropeLength), 0, 1);
    const outwardSpeed = distance > 1e-6 ? dot(this.vel, radial) / distance : 0;
    this.tensionForce = this.stretch > 0 ? clamp(SPRING_STIFFNESS * this.stretch + SPRING_DAMPING * outwardSpeed, 0, HORSE_MASS * MAX_TETHER_ACCELERATION) : 0;
    this.tension = this.tensionForce / (HORSE_MASS * MAX_TETHER_ACCELERATION);
    return { radial, distance };
  }

  applyTether(dt, reel) {
    if (!this.anchor) return;
    this.ropeLength = clamp(this.ropeLength - reel * dt * 15, 12, 145);
    // A bounded winch gradually moves the lowest possible arc above traffic.
    // It does work through the spring, so stretching and recoil stay visible.
    if (reel >= 0) {
      const radial = { x: this.pos.x - this.anchor.x, y: this.pos.y - this.anchor.y, z: this.pos.z - this.anchor.z };
      const distance = length(radial);
      const radialSpeed = distance > 1e-6 ? dot(this.vel, radial) / distance : 0;
      const upwardFraction = distance > 1e-6 ? -radial.y / distance : 0;
      let target = this.launchReelTarget;
      let rate = 10;
      if (this.pos.y < 34 && this.vel.y < 5 && upwardFraction > 0.2) {
        // Feed the measured inward speed into the motor, otherwise approaching
        // a roof makes slack faster than a constant-speed winch can remove it.
        // Braking distance determines extra spring load before street contact.
        const stoppingRoom = Math.max(3, this.pos.y - 13);
        const braking = Math.max(0, -this.vel.y) ** 2 / (2 * stoppingRoom) + 12;
        const neededPull = Math.min(MAX_TETHER_ACCELERATION, (GRAVITY + braking) / upwardFraction);
        const extension = clamp((neededPull - (SPRING_DAMPING / HORSE_MASS) * radialSpeed) / (SPRING_STIFFNESS / HORSE_MASS), 2.8, 12);
        target = Math.max(12, Math.min(target ?? this.ropeLength, distance - extension));
        rate = clamp(-radialSpeed + 24, 20, 65);
      }
      if (target !== null && this.ropeLength > target) this.ropeLength = Math.max(target, this.ropeLength - dt * rate);
      if (this.launchReelTarget !== null && this.ropeLength <= this.launchReelTarget) this.launchReelTarget = null;
    }
    const state = this.updateTetherState();
    if (!state || state.distance < 1e-6) return;
    const pull = this.tensionForce / HORSE_MASS * dt / state.distance;
    this.vel.x -= state.radial.x * pull;
    this.vel.y -= state.radial.y * pull;
    this.vel.z -= state.radial.z * pull;
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

  step(dt, { forward = 0, strafe = 0, turn = 0, reel = 0, boost = false, swingHeld = false } = {}) {
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
    if (input.swingHeld) this.maintainHeldSwing();
    else this.heldAttachmentSpent = false;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const acceleration = this.grounded ? 39 : this.anchor ? 13 : 10;
    this.vel.x += (-sin * input.forward + cos * input.strafe) * acceleration * dt;
    this.vel.z += (-cos * input.forward - sin * input.strafe) * acceleration * dt;
    this.vel.y -= GRAVITY * dt;

    if (input.boost && this.energy > 0) {
      const poweredTime = Math.min(dt, this.energy / 0.28);
      this.energy = Math.max(0, this.energy - poweredTime * 0.28);
      this.vel.x -= sin * 31 * poweredTime;
      this.vel.z -= cos * 31 * poweredTime;
      this.vel.y += 5 * poweredTime;
    } else if (!input.boost) {
      this.energy = Math.min(1, this.energy + dt * (this.grounded ? 0.23 : 0.13));
    }
    const drag = Math.exp(-dt * (this.grounded ? 1.65 : this.anchor ? 0.035 : 0.085));
    this.vel.x *= drag;
    this.vel.z *= drag;
    this.applyTether(dt, input.reel);
    this.limitSpeed();

    const before = copy(this.pos);
    this.grounded = false;
    this.resolveOverlap();
    this.move({ x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt });
    // Street contact is terminal before a taut rope can pull us back up.
    if (this.fatalGround) { this.resolveGround(); if (this.lost) return; }
    this.constrainRope();
    this.resolveGround();
    this.enforceBounds();
    this.updateTetherState();
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
    if (speed > 4) this.lastImpact = { time: this.time, speed, normal: copy(normal), kind };
  }

  move(displacement) {
    let delta = { ...displacement };
    let collided = false;
    for (let pass = 0; pass < 3; pass += 1) {
      if (length(delta) < 1e-8) break;
      let nearest = null;
      for (const building of this.buildings) {
        const hit = sweepBox(this.pos, delta, building);
        if (hit && (!nearest || hit.fraction < nearest.fraction)) nearest = hit;
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
    // Emergency stretch stop only. Ordinary motion is governed by the spring
    // above, which allows metres of extension instead of erasing radial speed.
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
