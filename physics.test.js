import test from 'node:test';
import assert from 'node:assert/strict';
import { SwingPhysics } from './physics.js';
import { createCity } from './city.js';
import { Scene, Raycaster, Vector3 } from './vendor/three.module.js';

const stepFor = (physics, seconds, input = {}) => {
  for (let frame = 0; frame < seconds * 120; frame += 1) physics.step(1 / 120, input);
};

test('survival starts falling unattached and ground contact ends the run until reset', () => {
  const setup = { fatalGround: true, spawn: { x: 0, y: 124, z: 50 }, initialVelocity: { x: 0, y: -18, z: -8 } };
  const physics = new SwingPhysics(setup);
  assert.equal(physics.anchor, null);
  assert.ok(physics.vel.y < 0);
  physics.step(1 / 60);
  assert.ok(physics.pos.y < 124 && physics.vel.y < -18);
  stepFor(physics, 5);
  assert.equal(physics.lost, true);
  assert.equal(physics.pos.y, 2.2);
  const end = physics.snapshot();
  stepFor(physics, 2, { swingHeld: true, boost: true, forward: 1 });
  assert.equal(physics.attach(), false);
  assert.equal(physics.jump(), false);
  assert.equal(physics.boost(), false);
  assert.deepEqual(physics.snapshot(), end);
  physics.reset();
  assert.equal(physics.lost, false);
  assert.deepEqual(physics.pos, setup.spawn);
  assert.deepEqual(physics.vel, setup.initialVelocity);
});

test('even a soft street contact loses, before a rope constraint can rescue the horse', () => {
  const physics = new SwingPhysics({ fatalGround: true, spawn: { x: 0, y: 2.201, z: 0 } });
  physics.vel = { x: 0, y: -0.1, z: 0 };
  physics.step(1 / 120);
  assert.equal(physics.lost, true);
  const roof = new SwingPhysics({ fatalGround: true, spawn: { x: 0, y: 35, z: 0 }, initialVelocity: { x: 0, y: -8, z: 0 }, buildings: [{ x: 0, z: 0, width: 20, depth: 20, height: 20 }] });
  stepFor(roof, 2);
  assert.equal(roof.lost, false, 'rooftops are safe; street contact is the loss condition');
  assert.equal(roof.grounded, true);
});

test('elastic catch settles into a limited-extension swing', () => {
  const physics = new SwingPhysics({ spawn: { x: 0, y: 90, z: 0 }, initialVelocity: { x: 0, y: -20, z: 0 } });
  physics.connect({ x: 0, y: 150, z: 0 });
  physics.launchReelTarget = null;
  let stretch = 0, rebounds = 0, wasRising = false;
  for (let i = 0; i < 720; i++) {
    physics.step(1 / 120);
    stretch = Math.max(stretch, physics.stretch);
    if (physics.vel.y > 10 && !wasRising) { rebounds++; wasRising = true; }
    if (physics.vel.y < 0) wasRising = false;
  }
  assert.ok(stretch > 0 && stretch <= 1.2, `bounded catch extension: ${stretch}m`);
  assert.ok(physics.stretch <= 1.5 + 1e-7, 'settled arc has limited extension');
  assert.ok(physics.ropeLength <= physics.catchLength, 'controller never lengthens the arc');
});

test('initial momentum faces down the avenue and reset restores the launch', () => {
  const physics = new SwingPhysics();
  physics.step(1 / 60);
  assert.ok(physics.pos.z < 50);
  physics.reset();
  assert.deepEqual(physics.pos, { x: 0, y: 45, z: 50 });
  assert.deepEqual(physics.vel, { x: 0, y: 0, z: -16 });
  assert.equal(physics.energy, 1);
});

test('attachment favors a strong forward release over a safe but weaker launch', () => {
  const forward={x:0,y:100,z:-30}, lateral={x:25,y:100,z:-30}, high={x:0,y:120,z:-10};
  const p=new SwingPhysics({anchors:[lateral,high,forward],spawn:{x:0,y:70,z:0},initialVelocity:{x:0,y:-18,z:-25}});
  const before=p.snapshot();
  const best=p.evaluateAnchor(forward), weaker=p.evaluateAnchor(high), sideways=p.evaluateAnchor(lateral);
  assert.ok(best.release.forwardSpeed>weaker.release.forwardSpeed);
  assert.ok(best.score>weaker.score && best.score>sideways.score);
  assert.ok(sideways.release.lateralSpeed>20);
  assert.deepEqual(p.snapshot(),before,'predictions never mutate gameplay');
  assert.equal(p.findAnchor(),forward);
  assert.equal(p.attach(),true);assert.deepEqual(p.anchor,forward);
});

test('rope constraint settles after catch and retains the pendulum arc', () => {
  const physics = new SwingPhysics({ anchors: [{ x: 0, y: 100, z: 0 }], spawn: { x: 0, y: 60, z: 25 } });
  physics.attach();
  physics.vel = { x: 0, y: -14, z: 0 };
  let peakStretch = 0;
  let recoiled = false;
  let swung = false;
  let previousStretch = physics.stretch;
  for (let frame = 0; frame < 720; frame += 1) {
    physics.step(1 / 120);
    assert.ok(physics.anchor);
    const distance = Math.hypot(physics.pos.x, physics.pos.y - 100, physics.pos.z);
    assert.ok(distance <= physics.maxRopeLength + 1e-7);
    peakStretch = Math.max(peakStretch, physics.stretch);
    if (peakStretch > 3 && physics.stretch < previousStretch && physics.vel.y > 1) recoiled = true;
    if (physics.pos.z < -5 && physics.vel.z < -5) swung = true;
    previousStretch = physics.stretch;
    assert.ok(physics.tension >= 0 && physics.tension <= 1);
  }
  assert.ok(peakStretch <= 1.2 + 1e-7, 'compliance is brief and bounded');
  assert.ok(physics.stretch < 1e-6, 'settled rope does not stretch');
  assert.ok(swung, 'radial spring force preserves the pendulum arc');
});

test('reeling shortens the rope and release retains momentum', () => {
  const physics = new SwingPhysics({ anchors: [{ x: 0, y: 100, z: 0 }], spawn: { x: 0, y: 60, z: 25 } });
  physics.attach();
  const previousLength = physics.ropeLength;
  stepFor(physics, 1, { reel: 1 });
  assert.ok(physics.ropeLength < previousLength - 14);
  const before = { ...physics.vel };
  physics.release();
  assert.deepEqual(physics.vel, before);
  assert.equal(physics.anchor, null);
});

test('ground landing is stable and jumping and attachment can launch from the street', () => {
  const physics = new SwingPhysics({ spawn: { x: 0, y: 4, z: 0 }, anchors: [{ x: 12, y: 35, z: -35 }] });
  physics.vel = { x: 0, y: -12, z: 0 };
  stepFor(physics, 1);
  assert.equal(physics.pos.y, 2.2);
  assert.equal(physics.grounded, true);
  assert.equal(physics.vel.y, 0);
  assert.equal(physics.lastImpact.kind, 'ground');
  assert.equal(physics.jump(), true);
  assert.ok(physics.vel.y > 15);
  assert.equal(physics.jump(), false);
  physics.pos.y = 2.2;
  physics.grounded = true;
  assert.equal(physics.attach(), true);
  assert.ok(physics.vel.y >= 16);
  assert.equal(physics.grounded, false);
});

test('continuous collision stops a fast horse at a thin wall and preserves sliding', () => {
  const physics = new SwingPhysics({
    spawn: { x: 0, y: 15, z: 8 },
    buildings: [{ minX: -20, maxX: 20, minZ: 0, maxZ: 0.1, height: 30 }],
  });
  physics.vel = { x: 12, y: 0, z: -500 };
  stepFor(physics, 0.3);
  assert.ok(physics.pos.z >= 1.25);
  assert.ok(physics.pos.x > 0);
  assert.equal(physics.vel.z, 0);
  assert.equal(physics.lastImpact.kind, 'building');
});

test('street launch takes up tether slack so its swing arc clears the pavement', () => {
  const physics = new SwingPhysics({
    spawn: { x: 0, y: 2.2, z: 0 },
    anchors: [{ x: 10, y: 35, z: -35 }],
  });
  physics.attach();
  stepFor(physics, 2, { forward: 1 });
  assert.ok(physics.anchor);
  assert.ok(physics.pos.y > 7);
  assert.ok(physics.ropeLength < 26);
  assert.equal(physics.grounded, false);
});

test('roof collision supports the horse without falling through', () => {
  const physics = new SwingPhysics({
    spawn: { x: 0, y: 35, z: 0 },
    buildings: [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30, height: 20 }],
  });
  physics.vel = { x: 0, y: -40, z: 0 };
  stepFor(physics, 1);
  assert.ok(Math.abs(physics.pos.y - 22.2) < 0.003);
  assert.equal(physics.grounded, true);
  for (let frame = 0; frame < 30; frame += 1) {
    physics.step(1 / 120);
    assert.equal(physics.grounded, true);
  }
});

test('boost consumes a bounded reserve and recharges without producing unlimited velocity', () => {
  const physics = new SwingPhysics();
  assert.equal(physics.boost(), true);
  assert.ok(physics.energy < 1);
  stepFor(physics, 8, { boost: true, forward: 1 });
  assert.ok(physics.energy >= 0 && physics.energy < 0.03);
  assert.ok(physics.snapshot().speed <= 78.001);
  stepFor(physics, 10);
  assert.equal(physics.energy, 1);
});

test('large frame gaps and mixed controls stay finite and the world boundary recovers escapes', () => {
  const physics = new SwingPhysics({ bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 100 } });
  for (let frame = 0; frame < 1000; frame += 1) {
    physics.step(frame % 13 === 0 ? 2 : 1 / 60, { forward: 1, strafe: Math.sin(frame), turn: Math.cos(frame), boost: true });
    assert.ok(Object.values(physics.pos).every(Number.isFinite));
    assert.ok(physics.pos.x >= -50 && physics.pos.x <= 50);
    assert.ok(physics.pos.z >= -50 && physics.pos.z <= 100);
  }
  physics.pos.x = 999;
  physics.step(1 / 60);
  assert.deepEqual(physics.pos, physics.spawn);
  assert.equal(physics.anchor, null);
  assert.equal(physics.resetCount, 1);
});

test('snapshot vectors cannot mutate the simulation', () => {
  const physics = new SwingPhysics();
  const snapshot = physics.snapshot();
  snapshot.pos.x = 900;
  snapshot.vel.y = 900;
  assert.equal(physics.pos.x, 0);
  assert.equal(physics.vel.y, 0);
});


function avenueFixture() {
  const anchors = [];
  const buildings = [];
  for (let block = 0; block < 28; block += 1) {
    for (const side of [-1, 1]) {
      const height = 55 + (block * 17 + (side + 1) * 11) % 46;
      const z = -block * 72;
      buildings.push({ minX: side < 0 ? -44 : 16, maxX: side < 0 ? -16 : 44, minZ: z - 20, maxZ: z + 20, height });
      for (const offset of [-22, 22]) anchors.push({ x: side * 12, y: height + 4, z: z + offset });
    }
  }
  return { anchors, buildings, bounds: { minZ: -2300 } };
}

test('holding swing keeps one world-space anchor throughout the arc', () => {
  const physics = new SwingPhysics(avenueFixture());
  assert.ok(physics.attach());
  const original = { ...physics.anchor };
  stepFor(physics, 20, { swingHeld: true, forward: 1 });
  assert.equal(physics.attachmentCount, 1, 'passing a roof must not hand off');
  if (physics.anchor) assert.deepEqual(physics.anchor, original);
  // A broken cord must not silently attach elsewhere while the key is held.
  physics.release();
  physics.pos = { x: 0, y: 35, z: -120 };
  stepFor(physics, .5, { swingHeld: true });
  assert.equal(physics.anchor, null);
  physics.step(1 / 120, { swingHeld: false });
  stepFor(physics, .5, { swingHeld: true });
  assert.equal(physics.attachmentCount, 2, 'a fresh press can catch a new roof');
});

test('an active anchor cannot be replaced even by an explicit connect call', () => {
  const physics = new SwingPhysics();
  physics.connect({ x: 20, y: 80, z: 0 });
  physics.connect({ x: -20, y: 100, z: -40 });
  assert.deepEqual(physics.anchor, { x: 20, y: 80, z: 0 });
  physics.release();
  physics.connect({ x: -20, y: 100, z: -40 });
  assert.deepEqual(physics.anchor, { x: -20, y: 100, z: -40 });
});

test('anchor selection rejects a roof whose tether would cross a building', () => {
  const blocked = { x: 0, y: 80, z: -50 };
  const visible = { x: 35, y: 85, z: -20 };
  const physics = new SwingPhysics({
    spawn: { x: 0, y: 35, z: 20 },
    anchors: [blocked, visible],
    buildings: [{ minX: -10, maxX: 10, minZ: -12, maxZ: -5, height: 90 }],
  });
  assert.equal(physics.findAnchor(), visible);
  physics.attach();
  assert.deepEqual(physics.anchor, visible);
});

test('new airborne attachment preserves velocity and release preserves spring recoil', () => {
  const physics = new SwingPhysics({ anchors: [{ x: 12, y: 95, z: 0 }] });
  physics.vel = { x: 6, y: -22, z: -30 };
  const incoming = { ...physics.vel };
  assert.ok(physics.attach());
  assert.deepEqual(physics.vel, incoming, 'attaching applies force over time, never an artificial kick');
  stepFor(physics, 0.4);
  const outgoing = { ...physics.vel };
  physics.release();
  assert.deepEqual(physics.vel, outgoing);
  const attachments = physics.attachmentCount;
  stepFor(physics, 0.4);
  assert.equal(physics.anchor, null, 'release remains free flight without swingHeld');
  assert.equal(physics.attachmentCount, attachments);
});

test('bottom assistance remains bounded through repeated swings', () => {
  const p=new SwingPhysics({spawn:{x:0,y:60,z:25}});p.connect({x:0,y:100,z:0});
  p.launchReelTarget=null;
  for(let i=0;i<3600;i++) {
    p.step(1/120);
    assert.ok(Math.hypot(p.vel.x,p.vel.y,p.vel.z)<=78+1e-8);
    assert.ok(p.stretch<=1.2+1e-7);
  }
  assert.equal(p.attachmentCount,1);
});

test('30, 60 and 120 FPS produce the same fixed-anchor spring trajectory', () => {
  const results = [];
  for (const fps of [30, 60, 120]) {
    const physics = new SwingPhysics(avenueFixture());
    for (let frame = 0; frame < fps * 12; frame += 1) physics.step(1 / fps, { forward: 1, swingHeld: true });
    results.push(physics.snapshot());
  }
  for (const state of results.slice(1)) {
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(Math.abs(state.pos[axis] - results[0].pos[axis]) < 1e-7);
      assert.ok(Math.abs(state.vel[axis] - results[0].vel[axis]) < 1e-7);
    }
    assert.equal(state.attachmentCount, results[0].attachmentCount);
    assert.equal(state.ropeLength, results[0].ropeLength);
  }
});


function actualCityFixture(scene = new Scene()) {
  const previousDocument = globalThis.document;
  // Painting is irrelevant to collision/anchor generation. The real seeded
  // city builder runs unchanged; only the browser's canvas surface is mocked.
  const context = canvas => new Proxy({
    canvas,
    getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }),
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0 };
    canvas.getContext = () => context(canvas);
    return canvas;
  } };
  try {
    return createCity(scene);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

test('real city anchors touch rendered rooftop ledges and stay fixed during a held catch', () => {
  const scene = new Scene();
  const city = actualCityFixture(scene);
  scene.updateMatrixWorld(true);
  assert.ok(city.anchors.length > 1000);
  // Test the actual rendered surfaces, not only duplicated coordinate formulas.
  const ray = new Raycaster();
  const samples = city.anchors.filter((_, i) => i % 71 === 0);
  samples.push(...city.anchors.filter(a => Math.abs(a.x - 108) < 24 && Math.abs(a.z + 765) < 24));
  for (const anchor of samples) {
    ray.set(new Vector3(anchor.x, anchor.y + .05, anchor.z), new Vector3(0, -1, 0));
    ray.far = .1;
    const hits = ray.intersectObjects(scene.children, true);
    assert.ok(hits.length, `anchor ${anchor.toArray()} must touch visible ledge geometry`);
    assert.ok(Math.abs(hits[0].point.y - anchor.y) < .01);
  }
  const physics = new SwingPhysics({ ...city, spawn: { ...city.spawn, y: city.spawn.y + 55 }, fatalGround: true, initialVelocity: { x: 0, y: -18, z: -8 } });
  let original = null;
  for (let frame = 0; frame < 2400; frame += 1) {
    physics.step(1 / 120, { swingHeld: true });
    if (physics.anchor) {
      original ??= { ...physics.anchor };
      assert.deepEqual(physics.anchor, original);
    }
    assert.ok(physics.snapshot().speed <= 78.001);
    for (const box of physics.buildings) {
      assert.ok(!(physics.pos.x > box.minX && physics.pos.x < box.maxX && physics.pos.z > box.minZ && physics.pos.z < box.maxZ && physics.pos.y < box.maxY), 'horse must remain outside buildings');
    }
  }
  assert.ok(original, 'the sky drop must be able to catch a real ledge');
  assert.equal(physics.attachmentCount, 1);
});

test('arrow cycling wraps ranked choices and never silently transfers an attached web', () => {
  const anchors = [{x:0,y:60,z:55},{x:20,y:65,z:50},{x:30,y:80,z:40}];
  const p = new SwingPhysics({anchors});
  const choices = p.selectableAnchors();
  assert.equal(p.findAnchor(), choices.find(a=>p.isForwardAnchor(a)) || null);
  p.selectedAnchor=choices[0];
  assert.equal(p.selectAnchor(1), choices[1]);
  assert.equal(p.findAnchor(), choices[1]);
  assert.equal(p.selectAnchor(1), choices[2]);
  assert.equal(p.selectAnchor(1), choices[0]);
  assert.equal(p.selectAnchor(-1), choices[2]);
  p.attach();
  const attached = {...p.anchor};
  p.selectAnchor(-1);
  assert.deepEqual(p.anchor, attached);
  p.release(); p.attach(); assert.deepEqual(p.anchor, choices[1]);
});

test('unreachable explicit selection falls back, with at most five choices within 75m', () => {
  const anchors = [10,20,30,40,50,60,90,120].map(x => ({x,y:45,z:50}));
  const p = new SwingPhysics({anchors, initialVelocity:{x:16,y:0,z:0}});
  const choices = p.selectableAnchors();
  assert.equal(choices.length,5);
  for (let i=0;i<12;i++) assert.ok(choices.includes(p.selectAnchor(1)));
  assert.equal(p.selectAnchor(0),choices[0]);
  assert.ok(choices.every(a=>a.x<=75));
  p.pos.x = -50;
  assert.ok([anchors[0],anchors[1]].includes(p.findAnchor()));
  p.pos.x = -80;
  assert.equal(p.findAnchor(),null);
});

test('up/down rank their own hemisphere, including points outside the top five', () => {
  const ahead = Array.from({length:7},(_,i)=>({x:i,y:75,z:20}));
  const behind = {x:0,y:60,z:60};
  const p = new SwingPhysics({anchors:[...ahead,behind]});
  assert.ok(ahead.includes(p.selectDirectionalAnchor(0,1)));
  assert.equal(p.selectDirectionalAnchor(0,-1),behind);
  assert.equal(p.findAnchor(),behind,'explicit choice remains selected');
  assert.equal(p.selectDirectionalAnchor(Math.PI,1),behind);
  assert.ok(ahead.includes(p.selectDirectionalAnchor(Math.PI,-1)));
  const chosen = p.selectedAnchor;
  assert.equal(p.selectDirectionalAnchor(Math.PI/2,1),null);
  assert.equal(p.selectedAnchor,chosen);
});

test('view direction controls recommendations independently of reversed momentum', () => {
  const front={x:0,y:75,z:-30}, rear={x:0,y:75,z:30};
  const p=new SwingPhysics({spawn:{x:0,y:50,z:0},initialVelocity:{x:0,y:-8,z:-30},anchors:[front,rear]});
  const before=p.snapshot();
  assert.equal(p.findAnchor(),front);
  assert.deepEqual(p.snapshot(),before);
  p.vel.z=30;
  assert.equal(p.findAnchor(),front,'momentum does not override the view');
  p.viewYaw=Math.PI;
  assert.equal(p.findAnchor(),rear,'turning the view invalidates the old lock');
  p.selectDirectionalAnchor(0,1);
  assert.equal(p.findAnchor(),front,'explicit choice is stable despite opposite momentum');
});

test('predicted ground contact and building collisions penalize otherwise reachable catches', () => {
  const p=new SwingPhysics({spawn:{x:0,y:35,z:0},initialVelocity:{x:0,y:-20,z:-25}});
  const low=p.evaluateAnchor({x:0,y:10,z:-30});
  const high=p.evaluateAnchor({x:0,y:70,z:-30});
  assert.equal(low.lost,true);
  assert.equal(high.lost,false);
  assert.ok(high.score>low.score+1000);
  const wall=new SwingPhysics({spawn:{x:0,y:50,z:0},initialVelocity:{x:0,y:-8,z:-30},buildings:[{minX:-10,maxX:10,minZ:-45,maxZ:-40,height:60}]});
  const collision=wall.evaluateAnchor({x:0,y:75,z:-30});
  const clear=p.evaluateAnchor({x:0,y:70,z:25});
  assert.ok(collision.impact>4 || collision.blocked);
  assert.ok(clear.score>collision.score);
});

test('rooftop running and strafing follow the horse heading and retain roof support', () => {
  for (const input of [{forward:1},{forward:-1},{strafe:1},{strafe:-1}]) {
    const p = new SwingPhysics({spawn:{x:0,y:22.2,z:0},initialVelocity:{x:0,y:0,z:0},buildings:[{minX:-50,maxX:50,minZ:-50,maxZ:50,height:20}]});
    stepFor(p,.1);
    assert.equal(p.grounded,true);
    p.yaw = Math.PI / 2;
    stepFor(p,.5,input);
    if(input.forward) assert.ok(p.pos.x * input.forward < -1);
    if(input.strafe) assert.ok(p.pos.z * input.strafe < -1);
    assert.equal(p.grounded,true);
    assert.ok(Math.abs(p.pos.y-22.2)<.003);
    assert.equal(p.anchor,null);
  }
});


test('swing forecasts have bounded work and repeated HUD reads reuse the ranking', () => {
  const p = new SwingPhysics({ anchors: [{x:0,y:75,z:20},{x:0,y:75,z:70}] });
  const integrate = SwingPhysics.prototype.integrate;
  let steps = 0;
  SwingPhysics.prototype.integrate = function(...args) { steps++; return integrate.apply(this,args); };
  try {
    p.findAnchor();
    assert.ok(steps > 0 && steps <= 136,'two candidates stay within their forecast budgets');
    const firstSteps=steps;
    for(let i=0;i<100;i++) p.findAnchor();
    assert.equal(steps,firstSteps,'HUD/camera reads must not repeat the simulation');
    p.vel.z = 30; p.recommendationUntil = 0;
    p.findAnchor();
    assert.ok(steps>firstSteps && steps<=firstSteps+136,'changed momentum refreshes a bounded forecast');
  } finally {
    SwingPhysics.prototype.integrate = integrate;
  }
});


function releaseFixture(angle, speed = 35, stretch = 6) {
  const radians = angle * Math.PI / 180;
  const p = new SwingPhysics({ spawn: { x: 0, y: 100, z: 0 }, anchors: [] });
  p.connect({ x: 0, y: 100 + Math.cos(radians) * 40, z: Math.sin(radians) * 40 });
  p.ropeLength = 40 - stretch; p.time = 1;
  p.vel = { x: 0, y: Math.sin(radians) * speed, z: -Math.cos(radians) * speed };
  return p;
}

test('release timing preserves horizontal, rising and near-apex swing trajectories', () => {
  const results = [];
  for (const angle of [0, 35, 75]) {
    const p = releaseFixture(angle), before = { ...p.vel };
    p.release({ launch: true });
    assert.ok(Math.hypot(p.vel.y, p.vel.z) >= Math.hypot(before.y, before.z));
    assert.ok(Math.abs(Math.atan2(p.vel.y, -p.vel.z) - angle * Math.PI / 180) < 1e-10);
    assert.equal(p.anchor, null);
    results.push(p.vel);
  }
  assert.equal(results[0].y, 0, 'bottom release does not force an upward jump');
  assert.ok(-results[0].z > -results[1].z && -results[1].z > -results[2].z);
  assert.ok(results[2].y > results[1].y && results[1].y > results[0].y);
});

test('release outside the reward window preserves velocity without manufacturing speed', () => {
  const p = releaseFixture(0);
  p.vel.y = 12;
  p.release({ launch: true });
  assert.equal(p.vel.y, 12);
  assert.equal(p.vel.z,-35);
  const outgoing = { ...p.vel }; p.release({ launch: true });
  assert.deepEqual(p.vel, outgoing);
  const falling = releaseFixture(-35); falling.release({ launch: true });
  assert.ok(falling.vel.y < 0, 'early release keeps a descending trajectory');
});

test('slack, stationary, rapid and passive releases do not invent a launch', () => {
  const slack = releaseFixture(35, 35, -5);
  const stationary = releaseFixture(0, 0);
  const fresh = releaseFixture(35); fresh.time = .05;
  for (const p of [slack, stationary, fresh]) {
    const before = { ...p.vel }; p.release({ launch: true });
    assert.deepEqual(p.vel, before);
  }
  const passive = releaseFixture(35), before = { ...passive.vel };
  passive.release(); assert.deepEqual(passive.vel, before);
});

test('release assists follow three-dimensional momentum and respect the speed cap', () => {
  const p = releaseFixture(0, 70);
  p.vel = { x: 42, y: 0, z: -56 };
  p.release({ launch: true });
  assert.ok(Math.abs(p.vel.x / -p.vel.z - .75) < 1e-10);
  assert.ok(Math.hypot(p.vel.x, p.vel.y, p.vel.z) <= 78 + 1e-9);
  const brief = releaseFixture(35), long = releaseFixture(35);
  brief.time = .2; long.time = 10;
  brief.release({ launch: true }); long.release({ launch: true });
  assert.deepEqual(brief.vel, long.vel, 'time held alone does not charge a launch');
});


test('recommendation stays locked briefly and Space attaches to the displayed ledge', () => {
  const a = {x:0,y:75,z:-25}, b = {x:0,y:75,z:-30};
  const p = new SwingPhysics({anchors:[a,b],spawn:{x:0,y:50,z:0}});
  let ranked = [a,b]; p.rankedAnchors = () => ranked;
  const displayed = p.findAnchor();
  ranked = [b,a]; p.time = .3;
  assert.equal(p.findAnchor(), displayed, 'score changes do not flicker the marker');
  p.time = .46;
  assert.equal(p.findAnchor(), b, 'recommendation can update after the lock');
  assert.equal(p.attach(displayed), true, 'keydown honors what was last rendered, even after expiry');
  assert.deepEqual(p.anchor, a);
});

test('stale marker is rejected without attaching a different ledge', () => {
  const a = {x:0,y:75,z:-25}, b = {x:15,y:75,z:-30};
  const p = new SwingPhysics({anchors:[a,b],spawn:{x:0,y:50,z:0}});
  p.rankedAnchors = () => [a,b];
  const shown = p.findAnchor();
  p.ropeObstacles = [{minX:-2,maxX:2,minY:0,maxY:100,minZ:-20,maxZ:-10}];
  assert.equal(p.attach(shown), false);
  assert.equal(p.anchor, null);
  assert.equal(p.findAnchor(), b, 'blocked recommendation invalidates before lock expires');
  p.step(1/60,{swingHeld:true,swingTarget:shown});
  assert.equal(p.anchor,null,'held retry cannot silently substitute another marker');
  p.nextAnchorCheck = 0;
  p.step(1/60,{swingHeld:true,swingTarget:b});
  assert.deepEqual(p.anchor,b);
});

test('release clears the used manual choice and excludes the previous ledge from automatic picks', () => {
  const used = {x:0,y:75,z:-25}, next = {x:10,y:80,z:-45}, rear = {x:0,y:80,z:20};
  const p = new SwingPhysics({anchors:[used,next,rear],spawn:{x:0,y:50,z:0}});
  p.rankedAnchors = () => [used,rear,next];
  p.selectedAnchor = used; p.attach(used); p.release();
  assert.equal(p.selectedAnchor,null);
  assert.equal(p.findAnchor(),next,'previous ledge is excluded even while still ahead');
  p.rankedAnchors = () => [used,rear]; p.recommendationUntil = 0;
  assert.equal(p.findAnchor(),null,'no backward fallback when no new forward ledge exists');
  p.vel.z = 20;
  assert.equal(p.findAnchor(),null,'momentum cannot override the view cone');
  p.viewYaw = Math.PI;
  assert.equal(p.findAnchor(),rear,'recommendation follows the view');
  p.reset();
  assert.equal(p.previousAnchor,null);
});

test('recommendation unlocks immediately on reversal or loss of range', () => {
  const a={x:0,y:75,z:-25}, b={x:0,y:75,z:25};
  const p = new SwingPhysics({anchors:[a,b],spawn:{x:0,y:50,z:0}});
  p.rankedAnchors = () => [a,b];
  assert.equal(p.findAnchor(),a);
  p.viewYaw = Math.PI;
  assert.equal(p.findAnchor(),b);
  p.pos.z = 110;
  assert.equal(p.findAnchor(),null);
});

test('mobile Select cycles forward-view ledges without attaching or transferring a web', () => {
  const a={x:0,y:75,z:-25},b={x:20,y:75,z:-35},rear={x:0,y:75,z:25};
  const p=new SwingPhysics({anchors:[a,b,rear],spawn:{x:0,y:50,z:0}});
  p.rankedAnchors=()=>[a,rear,b];
  assert.equal(p.selectNextForwardAnchor(0,a),b);
  assert.equal(p.anchor,null);
  assert.equal(p.selectNextForwardAnchor(0,b),a);
  p.attach(a); const attached={...p.anchor};
  assert.equal(p.selectNextForwardAnchor(0,a),b);
  assert.deepEqual(p.anchor,attached);
  p.release();
  assert.equal(p.selectNextForwardAnchor(0,b),b,'last used ledge is excluded');
  assert.equal(p.selectNextForwardAnchor(Math.PI,b),rear,'selection uses the view direction');
});


function apexSwing() {
  const p = new SwingPhysics({spawn:{x:0,y:70,z:0},initialVelocity:{x:0,y:-18,z:-25},anchors:[]});
  p.connect({x:0,y:100,z:-30});
  return p;
}
function releaseCopy(p, launch = true, snap = true) {
  const copy = Object.assign(Object.create(SwingPhysics.prototype), p, {pos:{...p.pos},vel:{...p.vel}});
  if (!snap) copy.releaseAssist = () => 0;
  copy.release({launch});
  return copy;
}

test('release reward occurs on the early ascending arc and preserves its pitch', () => {
  const p=apexSwing();let duration=0;
  for(let i=0;i<600;i++) {
    p.step(1/120);
    if(p.releaseAssist()>0) {
      duration+=1/120;
      const released=releaseCopy(p), before=Math.hypot(p.vel.x,p.vel.y,p.vel.z);
      assert.ok(p.vel.y>3);
      assert.ok(p.swingTelemetry().angle>=20 && p.swingTelemetry().angle<=41);
      assert.ok(Math.abs(released.lastSnap.gain-3)<1e-6);
      assert.ok(Math.abs(released.vel.y/(before+3)-p.vel.y/before)<1e-8,'no vertical floor changes release pitch');
      assert.equal(released.swingTelemetry().ready,false);
    } else if(duration)break;
  }
  assert.ok(duration>.25 && duration<1);
});

test('snap requires a real ascent, expires after the apex, and never fires on cleanup', () => {
  const p = apexSwing();
  assert.equal(p.releaseAssist(),0,'initial fall is not an apex');
  let sawWindow = false;
  for (let i=0;i<600;i++) {
    p.step(1/120);
    if (p.releaseAssist()>0) {
      sawWindow=true;
      assert.deepEqual(releaseCopy(p,false).vel,p.vel,'passive detach preserves velocity');
      assert.equal(releaseCopy(p,false).lastSnap,null,'cleanup never emits a burst');
    } else if (sawWindow) break;
  }
  assert.ok(sawWindow);
  assert.equal(p.releaseAssist(),0);
  p.release(); p.connect({x:10,y:p.pos.y+30,z:p.pos.z-20});
  assert.equal(p.releaseAssist(),0,'new attachment cannot reuse the previous peak');
});

test('apex snap timing is consistent across render rates and remains speed limited', () => {
  const starts=[];
  for (const fps of [30,60,120]) {
    const p=apexSwing();
    for(let i=0;i<fps*6;i++) {
      p.step(1/fps);
      if(p.releaseAssist()>0) {
        starts.push(p.time);
        p.vel.x=p.catchForwardX*77; p.vel.z=p.catchForwardZ*77;
        p.release({launch:true});
        assert.ok(Math.hypot(p.vel.x,p.vel.y,p.vel.z)<=78+1e-9);
        break;
      }
    }
  }
  assert.equal(starts.length,3);
  assert.ok(Math.max(...starts)-Math.min(...starts)<.04);
});

test('air steering bends momentum symmetrically without manufacturing horizontal speed', () => {
  const make = () => new SwingPhysics({spawn:{x:0,y:150,z:0},initialVelocity:{x:0,y:5,z:-30}});
  const left=make(), right=make(), straight=make();
  for(let i=0;i<60;i++){left.step(1/120,{turn:1});right.step(1/120,{turn:-1});straight.step(1/120);}
  assert.ok(left.vel.x < -10 && right.vel.x > 10);
  assert.ok(Math.abs(left.vel.x + right.vel.x)<1e-9);
  assert.ok(Math.abs(Math.hypot(left.vel.x,left.vel.z)-Math.hypot(straight.vel.x,straight.vel.z))<1e-9);
});

test('controlled catch preserves entry velocity and bounds stretch after settling while steering', () => {
  const p=new SwingPhysics({spawn:{x:0,y:70,z:0},initialVelocity:{x:0,y:-18,z:-25}});
  const incoming={...p.vel};
  p.connect({x:0,y:100,z:-30});
  assert.deepEqual(p.vel,incoming);
  for(let i=0;i<240;i++) {
    p.step(1/120,{turn:.35});
    assert.ok(p.anchor,'steering retains the same attachment');
    if(p.time>.2) assert.ok(p.stretch<=1e-6);
  }
  assert.ok(p.ropeLength <= p.catchLength);
  assert.equal(p.snapshot().traversalPhase,'swing');
});

test('rising release gives sustained soaring and reattachment or cleanup ends the assist', () => {
  const p=apexSwing();
  for(let i=0;i<720 && !p.releaseAssist();i++) p.step(1/120);
  assert.ok(p.releaseAssist()>0);
  p.release({launch:true});
  assert.equal(p.snapshot().traversalPhase,'soar');
  const height=p.pos.y, horizontal=Math.hypot(p.vel.x,p.vel.z);
  for(let i=0;i<120;i++) p.step(1/120);
  assert.ok(p.pos.y>height,'still above release height after one second');
  assert.ok(Math.hypot(p.vel.x,p.vel.z)>horizontal*.95,'forward speed survives soaring');
  p.connect({x:0,y:p.pos.y+30,z:p.pos.z-25});
  assert.equal(p.soarUntil,-Infinity);
  p.release();
  assert.equal(p.snapshot().traversalPhase,'air');
  const falling=apexSwing();falling.release({launch:true});
  assert.equal(falling.soarUntil,-Infinity,'initial dive is not converted into a soar');
});

test('soar expires and a wall impact cancels it', () => {
  const p=apexSwing();
  for(let i=0;i<720 && !p.releaseAssist();i++) p.step(1/120);
  p.release({launch:true});
  const impacted=Object.assign(Object.create(SwingPhysics.prototype),p,{pos:{...p.pos},vel:{x:20,y:12,z:0}});
  impacted.recordImpact({x:-1,y:0,z:0});
  assert.equal(impacted.soarUntil,-Infinity);
  for(let i=0;i<150;i++) p.step(1/120);
  assert.equal(p.snapshot().traversalPhase,'air');
});

function wallFixture(height=30, xSpeed=0) {
  return new SwingPhysics({buildings:[{x:0,z:0,width:80,depth:20,height}],spawn:{x:0,y:24,z:25},initialVelocity:{x:xSpeed,y:0,z:-30}});
}

test('head-on building impact becomes a wall-run and a swept forward vault', () => {
  const p=wallFixture();let wall=false,vault=false;
  for(let i=0;i<210;i++) {
    p.step(1/120);
    wall ||= !!p.wallRun;
    if(p.snapshot().traversalPhase==='vault') {
      vault=true;
      assert.ok(p.pos.y>32.2,'roof clearance precedes inward vault');
      assert.ok(p.vel.z < -14,'vault restores forward travel');
    }
    assert.ok(!(p.pos.y<32.2 && p.pos.z<11.15 && p.pos.z>-11.15),'never penetrates the building');
  }
  assert.ok(wall && vault);
  assert.ok(p.pos.z<5,'crosses onto the roof instead of stopping at facade');
});

test('wall-run preserves lateral flow, expires on a tall wall, and does not recharge on contact', () => {
  const p=wallFixture(150,10);let wall=false;
  for(let i=0;i<300;i++) {
    p.step(1/120);
    if(p.wallRun){wall=true;assert.ok(p.vel.x>7,'glancing motion survives');}
  }
  assert.ok(wall);
  assert.equal(p.wallRun,null);
  assert.equal(p.snapshot().traversalPhase,'air');
  assert.ok(p.vel.y<0,'gravity resumes after bounded climb');
});

test('new web cancels wall recovery and reset clears recovery state', () => {
  const p=wallFixture(150);
  while(!p.wallRun && p.time<1)p.step(1/120);
  assert.ok(p.wallRun);
  p.connect({x:0,y:80,z:30});
  assert.equal(p.wallRun,null);
  assert.equal(p.vaultUntil,-Infinity);
  assert.ok(p.anchor);
  p.reset();
  assert.equal(p.wallRecoveryUntil,-Infinity);
});

test('slow bumps and ground-level impacts do not create wall launches', () => {
  for(const [height,speed] of [[24,3],[3,30]]) {
    const p=wallFixture(150);p.pos.y=height;p.pos.z=12;p.vel.z=-speed;
    for(let i=0;i<60;i++){p.step(1/120);assert.equal(p.wallRun,null);}
  }
});

test('wall recovery remains consistent at 30, 60 and 120 Hz', () => {
  const positions=[];
  for(const fps of [30,60,120]) {
    const p=wallFixture();
    for(let i=0;i<fps*1.5;i++)p.step(1/fps);
    positions.push(p.pos);
  }
  for(const pos of positions)assert.ok(Math.hypot(pos.y-positions[0].y,pos.z-positions[0].z)<1e-6);
});

test('slack constraint never pushes or adds a spring force', () => {
  const p=new SwingPhysics({spawn:{x:0,y:80,z:0},initialVelocity:{x:0,y:0,z:0}});
  p.connect({x:0,y:100,z:0});p.ropeLength=40;p.launchReelTarget=null;p.time=1;
  const position={...p.pos},velocity={...p.vel};
  p.applyTether(1/120,0);p.constrainRope();
  assert.deepEqual(p.pos,position);assert.deepEqual(p.vel,velocity);
  assert.equal(p.tension,0);
});

test('speed assistance acts only at the taut arc bottom and never slows fast travel', () => {
  for(const [angle,speed,assisted] of [[0,12,true],[50,12,false],[0,48,false]]) {
    const p=releaseFixture(angle,speed,0);p.launchReelTarget=null;
    const before={...p.vel};p.applyTether(.01,0);
    const gain=Math.hypot(p.vel.x,p.vel.y,p.vel.z)-Math.hypot(before.x,before.y,before.z);
    if(assisted) assert.ok(gain>0 && gain<=.180001);
    else assert.ok(Math.abs(gain)<1e-9);
  }
});

test('attached steering bends tangent motion without injecting radial speed', () => {
  const make=()=>{const p=releaseFixture(30,30,0);p.launchReelTarget=null;return p;};
  const straight=make(),steered=make();
  straight.step(1/120);steered.step(1/120,{turn:.5});
  const radial={x:steered.pos.x-steered.anchor.x,y:steered.pos.y-steered.anchor.y,z:steered.pos.z-steered.anchor.z};
  assert.ok(Math.abs(steered.vel.x)>0.01);
  assert.ok(Math.abs(radial.x*steered.vel.x+radial.y*steered.vel.y+radial.z*steered.vel.z)<1e-6);
  assert.ok(Math.abs(Math.hypot(...Object.values(steered.vel))-Math.hypot(...Object.values(straight.vel)))<.01);
});

test('release forecast stops at the first useful launch and checks its immediate flight', () => {
  const anchor={x:0,y:100,z:-30};
  const config={spawn:{x:0,y:70,z:0},initialVelocity:{x:0,y:-18,z:-25}};
  const p=new SwingPhysics(config), clear=p.evaluateAnchor(anchor);
  assert.ok(clear.release && clear.samplesUsed<60);
  const {position,velocity}=clear.release;
  const wall=new SwingPhysics({...config,buildings:[{x:position.x+velocity.x*.15,z:position.z+velocity.z*.15,width:20,depth:1,height:position.y+15}]});
  const obstructed=wall.evaluateAnchor(anchor);
  assert.ok(obstructed.release,'obstacle is beyond the release point');
  assert.ok(obstructed.impact>4);
  assert.ok(obstructed.score<clear.score-100);
  assert.ok(obstructed.samplesUsed<=68);
});

test('safe anchors without a release in the horizon remain fallback options', () => {
  const p=new SwingPhysics();
  const stalled=p.evaluateAnchor({x:15,y:70,z:10});
  const launch=p.evaluateAnchor({x:0,y:40,z:30});
  assert.equal(stalled.release,null);
  assert.equal(stalled.lost,false);
  assert.ok(Number.isFinite(stalled.score));
  assert.ok(launch.release && launch.score>stalled.score);
  assert.ok(stalled.samplesUsed<=68);
});

test('forward view cone excludes sideways, rear and overhead targets and prefers the center', () => {
  const center={x:0,y:75,z:-35}, edge={x:30,y:75,z:-30}, side={x:35,y:75,z:-5},rear={x:0,y:75,z:30}, overhead={x:0,y:75,z:0};
  const p=new SwingPhysics({spawn:{x:0,y:50,z:0},anchors:[edge,side,rear,overhead,center]});
  p.rankedAnchors=()=>[edge,side,rear,overhead,center];
  assert.equal(p.findAnchor(),center);
  assert.deepEqual(p.forwardCandidates(),[center,edge]);
  assert.equal(p.selectNextForwardAnchor(0,center),edge);
  assert.equal(p.selectNextForwardAnchor(0,edge),center);
  p.viewYaw=Math.PI/2;
  assert.equal(p.findAnchor(),null,'mobile choice clears when panning outside its cone');
  assert.equal(p.recommendedAnchor,null);
  assert.equal(p.attach(center),false,'stale displayed target cannot attach outside view');
});

test('empty mobile selection clears stale choices while behind remains an explicit override', () => {
  const front={x:0,y:75,z:-25},rear={x:0,y:75,z:25};
  const p=new SwingPhysics({spawn:{x:0,y:50,z:0},anchors:[front,rear]});
  p.selectNextForwardAnchor(0);
  assert.equal(p.selectNextForwardAnchor(Math.PI/2),null);
  assert.equal(p.selectedAnchor,null);assert.equal(p.recommendedAnchor,null);
  assert.equal(p.selectDirectionalAnchor(0,-1),rear);
  assert.equal(p.findAnchor(),rear);
  assert.equal(p.attach(rear),true,'deliberate behind selection bypasses automatic cone');
});

function pointZipFixture() {
  const anchor={x:10.2,y:31.2,z:-29.8};
  return new SwingPhysics({spawn:{x:8,y:20,z:0},initialVelocity:{x:0,y:0,z:-20},buildings:[{x:0,z:-40,width:20,depth:20,height:30}],anchors:[anchor]});
}

test('ordinary release adds a bounded kick while swing-jump remains a separate action', () => {
  const p=apexSwing();for(let i=0;i<720&&!p.releaseAssist();i++)p.step(1/120);
  assert.ok(p.releaseAssist());
  const plain=Object.assign(Object.create(SwingPhysics.prototype),p,{pos:{...p.pos},vel:{...p.vel}});
  const incoming={...plain.vel};plain.release({intentional:true});
  assert.ok(Math.hypot(...Object.values(plain.vel))>Math.hypot(...Object.values(incoming)));assert.ok(plain.soarUntil>plain.time);
  assert.equal(p.jumpAction(),true);assert.equal(p.anchor,null);
  assert.ok(Math.hypot(...Object.values(p.vel))>Math.hypot(...Object.values(incoming)));
  assert.ok(p.swingRearmAt>p.time+.5);
});

test('zip to point follows a swept path, reaches the roof and can launch near arrival', () => {
  const p=pointZipFixture();const target=p.pointCandidate(0);
  assert.ok(target);assert.ok(p.zipToPoint(target));
  assert.equal(p.jumpAction(),false,'early jump cannot launch before arrival');
  while(p.pointZip?.stage===0 && p.time<2)p.step(1/120);
  assert.equal(p.pointZip?.stage,1);
  assert.ok(p.pos.y>32.2,'approach clears the facade before crossing roof edge');
  assert.equal(p.jumpAction(),true);assert.equal(p.pointZip,null);
  assert.ok(p.vel.y>0 && p.vel.z<-20);
  const landing=pointZipFixture();landing.zipToPoint(landing.pointCandidate(0));
  for(let i=0;i<180;i++)landing.step(1/120);
  assert.ok(landing.grounded);assert.equal(landing.pointZip,null);
});

test('point zip aborts against new obstructions and new swings cancel a zip', () => {
  const p=pointZipFixture();p.zipToPoint(p.pointCandidate(0));
  p.buildings.push({minX:-30,maxX:30,minY:0,maxY:100,minZ:-12,maxZ:-10});
  for(let i=0;i<60 && p.pointZip;i++)p.step(1/120);
  assert.equal(p.pointZip,null);assert.ok(p.pos.z>=-10);
  const q=pointZipFixture();q.zipToPoint(q.pointCandidate(0));q.connect(q.anchors[0]);
  assert.equal(q.pointZip,null);assert.ok(q.anchor);
});

test('air zip requires geometry and cooldown prevents repeated velocity boosts', () => {
  const p=new SwingPhysics({spawn:{x:0,y:50,z:0},anchors:[{x:0,y:80,z:-30}]});
  assert.equal(p.jumpAction(),true);
  const velocity={...p.vel};assert.equal(p.jumpAction(),false);assert.deepEqual(p.vel,velocity);
  const empty=new SwingPhysics({anchors:[]});assert.equal(empty.jumpAction(),false);
});


test('swing-jump trades forward push for lift smoothly across the ascent', () => {
  const jumpAt = degrees => {
    const a=degrees*Math.PI/180;
    const p=new SwingPhysics({spawn:{x:0,y:100-40*Math.cos(a),z:-40*Math.sin(a)},initialVelocity:{x:0,y:20*Math.sin(a),z:-20*Math.cos(a)},anchors:[]});
    p.connect({x:0,y:100,z:0});p.attachedAt=p.time-1;
    const before={...p.vel};p.jumpAction();
    return {forward:before.z-p.vel.z,lift:p.vel.y-before.y};
  };
  const early=jumpAt(15),middle=jumpAt(45),late=jumpAt(75);
  assert.ok(early.forward>middle.forward && middle.forward>late.forward);
  assert.ok(early.lift<middle.lift && middle.lift<late.lift);
  for(const boundary of [20,40]) {
    const a=jumpAt(boundary-.01),b=jumpAt(boundary+.01);
    assert.ok(Math.abs(a.forward-b.forward)<.01 && Math.abs(a.lift-b.lift)<.01);
  }
});

test('ordinary release softens ascent without boosting an instant detach or floating a dive', () => {
  for(const vy of [-10,10]) {
    const p=apexSwing();p.vel.y=vy;const before={...p.vel};
    p.release({intentional:true});assert.deepEqual(p.vel,before);
    assert.equal(p.soarUntil>p.time,vy>0);
    assert.equal(p.lastSnap,null);
  }
  const p=apexSwing();p.vel.y=10;p.release();assert.equal(p.soarUntil,-Infinity);
});


test('contextual action prioritizes swing jump and only zips to a centered perch', () => {
  const p=pointZipFixture();
  assert.equal(p.contextualAction(0).label,'Zip');
  assert.equal(p.contextualAction(Math.PI/2).label,'Jump');
  const target=p.pointCandidate(0);
  assert.equal(p.contextualAction(Math.PI/2,target).kind,'jump','stale off-axis marker cannot zip');
  p.grounded=true;assert.equal(p.contextualAction(0).label,'Jump');p.grounded=false;
  p.connect(p.anchors[0]);assert.equal(p.contextualAction(0).label,'Jump');p.release();
  assert.equal(p.contextualJump(0,target),true);assert.ok(p.pointZip);
  assert.equal(p.contextualAction(0).kind,'wait');
  p.pointZip.stage=1;p.pos={...p.pointZip.landing};
  assert.equal(p.contextualAction(0).label,'Launch');
  assert.equal(p.contextualJump(0),true);assert.equal(p.pointZip,null);
});


test('committed release kick preserves pitch and passive detach never boosts', () => {
  const p=apexSwing();p.time=.5;p.vel={x:0,y:15,z:-30};
  const before={...p.vel};p.release({intentional:true});
  const gain=Math.hypot(...Object.values(p.vel))-Math.hypot(...Object.values(before));
  assert.ok(gain>4 && gain<=6);assert.ok(Math.abs(p.vel.y/p.vel.z-before.y/before.z)<1e-9);
  const q=apexSwing();q.time=.5;q.vel={...before};q.release();assert.deepEqual(q.vel,before);
});

test('air zip has a pronounced forward burst and a timed visual cue', () => {
  const p=new SwingPhysics({spawn:{x:0,y:50,z:0},initialVelocity:{x:0,y:-10,z:-24},anchors:[{x:0,y:80,z:-30}]});
  p.jumpAction();assert.ok(Math.hypot(p.vel.x,p.vel.z)>=42);
  assert.equal(p.zipBurstAt,p.time);assert.ok(p.soarUntil>p.time);
});
