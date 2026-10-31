// Presentation envelopes use simulation time: pause cannot advance an accent.
export function traversalFeel(physics, reduceMotion = false) {
  const active = !physics.grounded && !physics.lost;
  const attached = active && !!physics.anchor;
  const catchAge = physics.time - physics.attachedAt;
  const releaseAge = physics.time - physics.releasedAt;
  const catchWeight = attached ? Math.max(0, 1 - catchAge / .18) : 0;
  const release = active && !attached ? Math.max(0, 1 - releaseAge / .38) : 0;
  const soar = active && !attached && physics.time < physics.soarUntil ? 1 - release : 0;
  const swing = attached ? 1 - catchWeight : 0;
  const wallRun = active && !!physics.wallRun ? 1 : 0;
  const vault = active ? Math.max(0, Math.min(1, ((physics.vaultUntil ?? -Infinity) - physics.time) / .45)) : 0;
  const zip = physics.pointZip ? 1 : 0;
  const arrival = physics.perch ? Math.max(0, 1 - (physics.time - physics.perchedAt) / .24) : 0;
  const phase = physics.perch ? 'perched' : physics.pointZip ? 'point-zip' : wallRun ? 'wall-run' : vault > 0 ? 'vault' : !active ? 'grounded' : catchWeight > 0 ? 'catch' : attached ? 'swing' : release > 0 ? 'release' : soar > 0 ? 'soar' : 'air';
  const leap = active && !attached && !physics.pointZip && !physics.wallRun ? Math.max(0, Math.min(1, (.9 - (physics.time - (physics.leapedAt ?? -Infinity))) / .25)) : 0;
  const motion = reduceMotion ? 0 : 1;
  return {
    phase, leap, catch: catchWeight, swing, release, soar, wallRun, vault, zip, arrival,
    distance: motion * (-.8 * catchWeight + 1.8 * release + .8 * soar + 1.2 * zip - .6 * arrival),
    height: motion * (-.35 * catchWeight + .35 * swing + .5 * soar),
    fov: motion * (-2 * catchWeight + 5 * release + 2 * soar + 4 * zip - 2 * arrival),
    lookAhead: motion * (2 * swing + 4 * release + 3 * soar),
  };
}
