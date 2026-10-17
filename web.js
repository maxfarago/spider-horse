import * as THREE from './vendor/three.module.js';

// Seeded, persistent silk detail: stretching never re-scatters the fibers.
export function createWeb() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: '#ddd9ce', roughness: .64, metalness: 0 });
  const segments = 128, fibers = 5, wraps = 384;
  const strands = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 5), material, segments * fibers);
  const knots = new THREE.InstancedMesh(new THREE.TorusGeometry(1, .25, 4, 9, Math.PI * 1.8), material, wraps);
  for (const mesh of [strands, knots]) {
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(mesh);
  }
  const dummy = new THREE.Object3D();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), center = new THREE.Vector3();
  const tangent = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(1, 0, 0), z = new THREE.Vector3(0, 0, 1);
  const random = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function sample(points, t, target, angle = 0, radius = 0) {
    const p = Math.min(31.999999, Math.max(0, t) * 32), i = Math.floor(p), f = p - i;
    center.fromArray(points, i * 3); b.fromArray(points, (i + 1) * 3);
    tangent.subVectors(b, center).normalize();
    u.crossVectors(tangent, Math.abs(tangent.y) > .95 ? right : up).normalize();
    v.crossVectors(tangent, u);
    target.copy(center).lerp(b, f).addScaledVector(u, Math.cos(angle) * radius).addScaledVector(v, Math.sin(angle) * radius);
  }
  function cylinder(mesh, index, from, to, radius) {
    dummy.position.copy(from).add(to).multiplyScalar(.5);
    tangent.subVectors(to, from);
    dummy.scale.set(radius, tangent.length(), radius);
    dummy.quaternion.setFromUnitVectors(up, tangent.normalize());
    dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  }
  const next = new THREE.Vector3();
  function update(points, tension) {
    const thin = 1 - Math.min(1, tension) * .18;
    for (let fiber = 0; fiber < fibers; fiber++) {
      for (let i = 0; i < segments; i++) {
        const t = i / segments, t1 = (i + 1) / segments;
        const phase = fiber * Math.PI * 2 / fibers;
        const radius = t => .022 * thin * Math.sin(Math.PI * t) ** .3 * (1 + .18 * Math.sin(t * 91 + phase));
        sample(points, t, a, phase + t * 37, radius(t));
        sample(points, t1, next, phase + t1 * 37, radius(t1));
        cylinder(strands, fiber * segments + i, a, next, (.006 + fiber * .0007) * thin);
      }
    }
    for (let i = 0; i < wraps; i++) {
      const t = (i + .2 + random(i) * .6) / wraps;
      sample(points, t, a);
      dummy.position.copy(a);
      dummy.quaternion.setFromUnitVectors(z, tangent);
      dummy.rotateX((random(i + 4) - .5) * .9);
      dummy.rotateZ(random(i + 9) * Math.PI * 2);
      const radius = (.018 + random(i + 1) * .013) * thin;
      dummy.scale.set(radius, radius * (.75 + random(i + 2) * .5), radius);
      dummy.updateMatrix(); knots.setMatrixAt(i, dummy.matrix);
    }
    strands.instanceMatrix.needsUpdate = true; knots.instanceMatrix.needsUpdate = true;
  }
  return { group, update };
}
