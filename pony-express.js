// Delivery rules are separate from traversal: only a landing inside the roof pad counts.
export function createDelivery(buildings, spawn) {
  const roofs = buildings.filter(b => b.maxX - b.minX >= 18 && b.maxZ - b.minZ >= 18 && b.height >= 28 && b.height <= 105)
    .map(b => ({ x: (b.minX + b.maxX) / 2 + (b.maxX - b.minX) * .28, y: (b.roofHeight ?? b.height) + 2.2,
      z: (b.minZ + b.maxZ) / 2 + (b.maxZ - b.minZ) * .28, obstacles: b.rooftopObstacles || [], radius: Math.min(6, (b.maxX - b.minX) * .18, (b.maxZ - b.minZ) * .18) }))
    .filter(p => !p.obstacles.some(o => p.x > o.minX-2 && p.x < o.maxX+2 && p.z > o.minZ-2 && p.z < o.maxZ+2));
  if (roofs.length < 3) throw new Error('Pony Express needs three accessible rooftops.');
  const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const pickup = roofs.reduce((best, roof) => distance(roof, spawn) < distance(best, spawn) ? roof : best);
  const destinations = roofs.filter(roof => roof !== pickup);
  const score = roof => Math.abs(distance(roof, pickup) - 360) + Math.max(0, roof.z - pickup.z) * 2 + Math.max(0, roof.y - pickup.y - 15) * 3;
  const dropoff = destinations.reduce((best, roof) => score(roof) < score(best) ? roof : best);
  const starts = roofs.filter(roof => roof !== pickup && roof !== dropoff);
  const startScore = roof => Math.abs(distance(roof, pickup) - 140) + Math.abs(roof.y - pickup.y) * 2;
  const start = starts.reduce((best, roof) => startScore(roof) < startScore(best) ? roof : best);
  return { start, pickup, dropoff, phase: 'pickup' };
}

export function deliveryTarget(delivery) {
  return delivery.phase === 'pickup' ? delivery.pickup : delivery.dropoff;
}

export function advanceDelivery(delivery, physics) {
  if (delivery.phase === 'delivered' || physics.lost || !physics.grounded) return null;
  const target = deliveryTarget(delivery);
  if (Math.abs(physics.pos.y - target.y) > 1 || Math.hypot(physics.pos.x - target.x, physics.pos.z - target.z) > target.radius) return null;
  delivery.phase = delivery.phase === 'pickup' ? 'carrying' : 'delivered';
  return delivery.phase;
}
