import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three.module.js';
import { SwingPhysics } from './physics.js';
import { updateWebTarget } from './web-target.js';

function elements() {
  const classes = new Set(['hidden']);
  return { panel: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } }, label: {}, distance: {}, classes };
}
test('top HUD retains selected distance while its anchor is behind the camera', () => {
  const rear = { x: 0, y: 60, z: 55 };
  const physics = new SwingPhysics({ anchors: [rear, { x: 15, y: 70, z: 10 }] });
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 1000);
  camera.position.set(0, 45, 50); camera.lookAt(0, 45, 0); camera.updateMatrixWorld();
  const anchor = physics.selectDirectionalAnchor(0, -1);
  assert.deepEqual(anchor, rear);
  const cameraSpace = new THREE.Vector3(anchor.x, anchor.y, anchor.z).applyMatrix4(camera.matrixWorldInverse);
  assert.ok(cameraSpace.z > 0, 'selected anchor is behind the camera');
  const { panel, label, distance, classes } = elements();
  updateWebTarget(panel, label, distance, { started: true, anchor, position: physics.pos, attached: false });
  assert.equal(classes.has('hidden'), false);
  assert.equal(label.textContent, 'Ledge selected');
  assert.equal(distance.textContent, '16 m');
  physics.attach();
  camera.lookAt(100, 45, 50); camera.updateMatrixWorld();
  updateWebTarget(panel, label, distance, { started: true, anchor: physics.anchor, position: physics.pos, attached: true });
  assert.equal(label.textContent, 'Web attached');
  assert.equal(distance.textContent, '16 m');
  assert.equal(classes.has('hidden'), false);
});
test('top indicator clears stale distance when no connection is reachable', () => {
  const { panel, label, distance, classes } = elements();
  distance.textContent = '16 m';
  updateWebTarget(panel, label, distance, { started: true, anchor: null, position: {x:0,y:0,z:0}, attached: false });
  assert.equal(label.textContent, 'No ledge in reach');
  assert.equal(distance.textContent, '—');
  assert.equal(classes.has('hidden'), false);
});

test('top indicator identifies the selected ledge by number even out of frame', () => {
  const { panel, label, distance, classes } = elements();
  updateWebTarget(panel, label, distance, {started:true, anchor:{x:0,y:30,z:40},position:{x:0,y:0,z:0},attached:false,anchorNumber:7});
  assert.equal(label.textContent, 'Selected ledge 7 · ← →');
  assert.equal(distance.textContent, '50 m');
  assert.equal(classes.has('hidden'), false);
});
