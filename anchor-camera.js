import { MathUtils, Vector3 } from './vendor/three.module.js';

// Fit the actual endpoints in camera space, rather than an oversized enclosing sphere.
export function frameAnchor(position, anchor, yaw, fov, aspect, outPosition, outTarget, elevation = .45) {
  const end = new Vector3(anchor.x, anchor.y, anchor.z);
  outTarget.copy(position);
  const direction = new Vector3(Math.sin(yaw), elevation, Math.cos(yaw)).normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize();
  const up = new Vector3().crossVectors(direction, right);
  const vertical = Math.tan(MathUtils.degToRad(fov * .5)) * .86;
  const horizontal = vertical * aspect;
  let distance = 8.5;
  for (const [point, padding] of [[position, 3], [end, 1.2]]) {
    const offset = point.clone().sub(outTarget);
    distance = Math.max(distance, offset.dot(direction) + padding + Math.max(
      (Math.abs(offset.dot(right)) + padding) / horizontal,
      (Math.abs(offset.dot(up)) + padding) / vertical,
    ));
  }
  outPosition.copy(outTarget).addScaledVector(direction, distance);
}

// Shortest arc avoids a full orbit when crossing the -PI / PI seam.
export function turnTowardAnchor(yaw, position, anchor, dt) {
  const target = Math.atan2(position.x - anchor.x, position.z - anchor.z);
  const turn = Math.atan2(Math.sin(target - yaw), Math.cos(target - yaw));
  return yaw + turn * (1 - Math.exp(-dt * 2.4));
}

// A bounded reveal completes promptly instead of waiting for two damped motions.
export function revealAnchor(camera, lookTarget, horse, anchor, startOffset, startLookOffset, elapsed, buildings = [], state = {}) {
  const eye = new Vector3(), aim = new Vector3();
  const yaw = Math.atan2(horse.x - anchor.x, horse.z - anchor.z);
  state.time = elapsed;
  chooseAnchorView(horse, anchor, yaw, camera.fov, camera.aspect, buildings, state, eye, aim);
  const t = MathUtils.clamp(elapsed / .28, 0, 1);
  const eased = t * t * (3 - 2 * t);
  camera.position.copy(horse).add(startOffset).lerp(eye, eased);
  lookTarget.copy(horse).add(startLookOffset).lerp(aim, eased);
  if (buildings.length && state.eye && elapsed > .28) {
    const dt = Math.max(0, Math.min(.1, elapsed - state.elapsed));
    const previous = state.eye.clone().add(new Vector3().subVectors(horse, state.horse));
    camera.position.copy(previous.lerp(camera.position, 1 - Math.exp(-dt * 8)));
  }
  // Constrain every intermediate frame, not just the final framing position.
  const fraction = cameraClearance(horse, camera.position, buildings, .8);
  camera.position.sub(horse).multiplyScalar(fraction).add(horse);
  state.eye = camera.position.clone(); state.horse = new Vector3().copy(horse); state.elapsed = elapsed;
}

// Slab intersection works for thin facades too; sampling can skip them.
export function cameraClearance(from, to, buildings, padding = 0) {
  let nearest = 1;
  const minX = Math.min(from.x, to.x) - padding, maxX = Math.max(from.x, to.x) + padding;
  const minY = Math.min(from.y, to.y) - padding, maxY = Math.max(from.y, to.y) + padding;
  const minZ = Math.min(from.z, to.z) - padding, maxZ = Math.max(from.z, to.z) + padding;
  for (const b of buildings) {
    if (b.minX > maxX || b.maxX < minX || b.minZ > maxZ || b.maxZ < minZ || b.height < minY || maxY < 0) continue;
    let enter = 0, exit = 1;
    for (const [axis, low, high] of [
      ['x', b.minX - padding, b.maxX + padding],
      ['y', -padding, b.height + padding],
      ['z', b.minZ - padding, b.maxZ + padding],
    ]) {
      const delta = to[axis] - from[axis];
      if (Math.abs(delta) < 1e-9) {
        if (from[axis] < low || from[axis] > high) { exit = -1; break; }
      } else {
        const a = (low - from[axis]) / delta, c = (high - from[axis]) / delta;
        enter = Math.max(enter, Math.min(a, c));
        exit = Math.min(exit, Math.max(a, c));
      }
    }
    if (enter <= exit && exit > .001 && enter < nearest) nearest = Math.max(0, enter - .002);
  }
  return nearest;
}

export function chooseAnchorView(horse, anchor, yaw, fov, aspect, buildings, state, eye, aim) {
  // Re-rank at 10Hz; still constrain the actual camera on every rendered frame.
  if (state.time < state.nextSolve && state.offset !== undefined) {
    frameAnchor(horse, anchor, yaw + state.offset, fov, aspect, eye, aim, state.elevation);
    return;
  }
  if (Number.isFinite(state.time)) state.nextSolve = state.time + .1;
  const candidate = new Vector3(), target = new Vector3();
  let best = Infinity, chosen;
  const options = [[state.offset ?? 0, state.elevation ?? .45]];
  for (const elevation of [.45, .9, 1.5]) {
    for (const offset of [0, -.55, .55, -1.1, 1.1]) options.push([offset, elevation]);
  }
  for (const [offset, elevation] of options) {
    frameAnchor(horse, anchor, yaw + offset, fov, aspect, candidate, target, elevation);
    const horseBlocked = cameraClearance(horse, candidate, buildings, .8) < 1;
    const ledgeBlocked = cameraClearance(candidate, anchor, buildings) < 1;
    const switching = offset !== (state.offset ?? 0) || elevation !== (state.elevation ?? .45);
    const score = (horseBlocked ? 1000 : 0) + (ledgeBlocked ? 100 : 0)
      + Math.abs(offset) * 2 + (elevation - .45) * 2 + (switching ? 3 : 0);
    if (score < best) {
      best = score; chosen = { offset, elevation };
      eye.copy(candidate); aim.copy(target);
    }
  }
  Object.assign(state, chosen);
}

// Follow horizontal travel immediately, but allow bounded vertical screen motion.
export function flightCameraFrame(previousY, position, velocity, dt, { active = true, distance = 10, anchor = null, gravity = 25 } = {}) {
  const limit = Math.min(2.5, distance * .22);
  const reset = !Number.isFinite(previousY) || Math.abs(position.y - previousY) > 20;
  const trackedY = !active || reset ? position.y : MathUtils.clamp(
    MathUtils.lerp(previousY, position.y, 1 - Math.exp(-Math.max(0, dt) * 4)),
    position.y - limit, position.y + limit,
  );
  if (!active) return { trackedY, ahead: { x: 0, y: 0, z: 0 } };
  const horizon = .35;
  let ax = 0, ay = -gravity, az = 0;
  if (anchor) {
    const radial = new Vector3().subVectors(position, anchor);
    const radius = radial.length();
    if (radius > 1) {
      radial.divideScalar(radius);
      const radialSpeed = velocity.x * radial.x + velocity.y * radial.y + velocity.z * radial.z;
      const tangentSpeedSq = Math.max(0, velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2 - radialSpeed ** 2);
      const inward = Math.max(0, tangentSpeedSq / radius - gravity * radial.y);
      ax -= radial.x * inward; ay -= radial.y * inward; az -= radial.z * inward;
    }
  }
  const ahead = new Vector3(velocity.x * horizon + ax * horizon ** 2 / 2,
    velocity.y * horizon + ay * horizon ** 2 / 2,
    velocity.z * horizon + az * horizon ** 2 / 2);
  const horizontal = Math.hypot(ahead.x, ahead.z);
  if (horizontal > 6) { ahead.x *= 6 / horizontal; ahead.z *= 6 / horizontal; }
  ahead.y = MathUtils.clamp(ahead.y * .35, -3, 3);
  return { trackedY, ahead: { x: ahead.x, y: ahead.y, z: ahead.z } };
}
