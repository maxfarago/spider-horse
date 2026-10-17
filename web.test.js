import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three.module.js';
import { createWeb } from './web.js';

test('silk stays finite, anchored and deterministic through stretch and orientation changes', () => {
  const web = createWeb(), points = new Float32Array(99);
  const matrix = new THREE.Matrix4(), endpoint = new THREE.Vector3();
  for (const end of [[0, 60, 0], [35, 20, -12], [0, 0, 0]]) {
    for (let i = 0; i <= 32; i++) points.set(end.map(n => n * i / 32), i * 3);
    for (const tension of [0, .5, 1]) {
      web.update(points, tension, true);
      for (const mesh of web.group.children) assert.ok(mesh.instanceMatrix.array.every(Number.isFinite));
      const strand = web.group.children[0];
      strand.getMatrixAt(0, matrix);
      endpoint.set(0, -.5, 0).applyMatrix4(matrix);
      assert.ok(endpoint.length() < 1e-5, 'horse endpoint remains fixed');
      strand.getMatrixAt(127, matrix);
      endpoint.set(0, .5, 0).applyMatrix4(matrix);
      assert.ok(endpoint.distanceTo(new THREE.Vector3(...end)) < 1e-4, 'roof endpoint remains fixed');
      const before = [...web.group.children[1].instanceMatrix.array];
      web.update(points, tension, true);
      assert.deepEqual([...web.group.children[1].instanceMatrix.array], before);
    }
  }
  web.update(points, 0, false);
  assert.equal(web.group.children.length, 2, 'no floating radial funnel');
});
