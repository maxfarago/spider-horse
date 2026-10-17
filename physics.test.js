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

test('bungee delivers repeated strong rebounds rather than settling after one catch', () => {
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
  assert.ok(stretch > 6, `only ${stretch}m extension`);
  assert.ok(rebounds >= 2, `only ${rebounds} strong rebounds`);
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

test('attachment favors a flowing elevated swing over a closer low or rear ledge', () => {
  const rear = { x: 0, y: 60, z: 55 };
  const ahead = { x: 15, y: 70, z: 10 };
  const low = { x: 0, y: 40, z: 30 };
  const physics = new SwingPhysics({ anchors: [rear, low, ahead] });
  assert.equal(physics.attach(), true);
  assert.deepEqual(physics.anchor, ahead);
  physics.yaw = Math.PI;
  assert.deepEqual(physics.findAnchor(), ahead);
  assert.equal(physics.attach(), true);
});

test('elastic tether extends under load, recoils, and retains tangential swing', () => {
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
  assert.ok(peakStretch > 3, 'spring visibly stretches, unlike a rigid rope');
  assert.ok(recoiled, 'stored spring energy returns into upwards movement');
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

test('spring damping dissipates unpowered energy instead of amplifying each oscillation', () => {
  const physics = new SwingPhysics({ anchors: [{ x: 0, y: 100, z: 0 }], spawn: { x: 0, y: 60, z: 25 } });
  physics.attach();
  const energy = () => 25 * physics.pos.y + 0.5 * physics.snapshot().speed ** 2 + 0.5 * 17 * physics.stretch ** 2;
  const initialEnergy = energy();
  for (let frame = 0; frame < 3600; frame += 1) {
    physics.step(1 / 120);
    assert.ok(energy() < initialEnergy * 1.02, 'unpowered rope cannot create energy');
  }
  assert.ok(energy() < initialEnergy * 0.92);
  assert.equal(physics.attachmentCount, 1);
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
  assert.equal(p.findAnchor(), choices[0]);
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
  const p = new SwingPhysics({anchors});
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

test('reversing momentum reverses preferred swing without mutating the real simulation', () => {
  const front={x:0,y:75,z:-30}, rear={x:0,y:75,z:30};
  const p=new SwingPhysics({spawn:{x:0,y:50,z:0},initialVelocity:{x:0,y:-8,z:-30},anchors:[front,rear]});
  const before=p.snapshot();
  assert.equal(p.findAnchor(),front);
  assert.deepEqual(p.snapshot(),before);
  p.vel.z=30;
  assert.equal(p.findAnchor(),rear,'velocity change invalidates cached ranking');
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
    assert.equal(steps,120,'two candidates use sixty forecast steps each');
    for(let i=0;i<100;i++) p.findAnchor();
    assert.equal(steps,120,'HUD/camera reads must not repeat the simulation');
    p.vel.z = 30;
    p.findAnchor();
    assert.equal(steps,240,'changed momentum refreshes the forecast');
  } finally {
    SwingPhysics.prototype.integrate = integrate;
  }
});
