import { MathUtils, Vector3 } from './vendor/three.module.js';

// Fit the actual endpoints in camera space, rather than an oversized enclosing sphere.
export function frameAnchor(position, anchor, yaw, fov, aspect, outPosition, outTarget) {
  const end = new Vector3(anchor.x, anchor.y, anchor.z);
  outTarget.copy(position);
  const direction = new Vector3(Math.sin(yaw), .45, Math.cos(yaw)).normalize();
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
export function revealAnchor(camera, lookTarget, horse, anchor, startOffset, startLookOffset, elapsed) {
  const eye = new Vector3(), aim = new Vector3();
  const yaw = Math.atan2(horse.x - anchor.x, horse.z - anchor.z);
  frameAnchor(horse, anchor, yaw, camera.fov, camera.aspect, eye, aim);
  const t = MathUtils.clamp(elapsed / .28, 0, 1);
  const eased = t * t * (3 - 2 * t);
  camera.position.copy(horse).add(startOffset).lerp(eye, eased);
  lookTarget.copy(horse).add(startLookOffset).lerp(aim, eased);
}
