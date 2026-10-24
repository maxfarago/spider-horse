import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelivery, deliveryTarget, advanceDelivery } from './pony-express.js';
import { SwingPhysics } from './physics.js';

const buildings = [
  { minX: 10, maxX: 50, minZ: 10, maxZ: 50, height: 55 },
  { minX: 40, maxX: 80, minZ: -330, maxZ: -290, height: 65 },
  { minX: 100, maxX: 140, minZ: 300, maxZ: 340, height: 40 },
];
const mission = () => createDelivery(buildings, { x: 0, z: 50 });
const landed = target => ({ pos: { ...target }, grounded: true, lost: false });

test('selects distinct reachable roof pads with room inside their building footprints', () => {
  const delivery = mission();
  assert.notDeepEqual(delivery.pickup, delivery.dropoff);
  assert.notDeepEqual(delivery.start, delivery.pickup);
  assert.notDeepEqual(delivery.start, delivery.dropoff);
  assert.ok(delivery.dropoff.z < delivery.pickup.z);
  for (const target of [delivery.pickup, delivery.dropoff]) {
    assert.ok(buildings.some(b => target.x - target.radius > b.minX && target.x + target.radius < b.maxX && target.z - target.radius > b.minZ && target.z + target.radius < b.maxZ && Math.abs(target.y - b.height - 2.2) < .001));
  }
});

test('requires pickup before delivery and a landing, not an airborne pass or another roof', () => {
  const delivery = mission();
  assert.equal(advanceDelivery(delivery, landed(delivery.dropoff)), null);
  assert.equal(advanceDelivery(delivery, { ...landed(delivery.pickup), grounded: false }), null);
  assert.equal(advanceDelivery(delivery, landed({ ...delivery.pickup, y: delivery.pickup.y + 20 })), null);
  assert.equal(advanceDelivery(delivery, landed({ ...delivery.pickup, x: delivery.pickup.x + 20 })), null);
  assert.equal(advanceDelivery(delivery, landed(delivery.pickup)), 'carrying');
  assert.equal(deliveryTarget(delivery), delivery.dropoff);
  assert.equal(advanceDelivery(delivery, { ...landed(delivery.dropoff), lost: true }), null);
  assert.equal(advanceDelivery(delivery, landed(delivery.dropoff)), 'delivered');
  assert.equal(advanceDelivery(delivery, landed(delivery.dropoff)), null);
});

test('real physics supports pickup, rooftop departure, and a delivery landing', () => {
  const delivery = mission();
  const physics = new SwingPhysics({ buildings, spawn: delivery.pickup, initialVelocity: { x: 0, y: 0, z: 0 }, fatalGround: true });
  physics.step(1 / 120);
  assert.equal(advanceDelivery(delivery, physics), 'carrying');
  physics.contextualJump(0);
  physics.step(1 / 120);
  assert.equal(physics.grounded, false);
  physics.pos = { ...delivery.dropoff, y: delivery.dropoff.y + 10 };
  physics.vel = { x: 0, y: -5, z: 0 };
  for (let i = 0; i < 120 && delivery.phase !== 'delivered'; i++) {
    physics.step(1 / 120);
    advanceDelivery(delivery, physics);
  }
  assert.equal(delivery.phase, 'delivered');
});
