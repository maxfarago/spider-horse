import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from './vendor/three.module.js';
import { cameraClearance, chooseAnchorView, frameAnchor, turnTowardAnchor, revealAnchor } from './anchor-camera.js';

test('selected anchors and horse fit the camera, including behind and portrait views', () => {
  for (const aspect of [390 / 844, 1, 16 / 9]) {
    for (const anchor of [new Vector3(0, 145, 140), new Vector3(-100, 70, -40), new Vector3(90, 125, 0)]) {
      const horse = new Vector3(0, 100, 0), eye = new Vector3(), target = new Vector3();
      const camera = new PerspectiveCamera(54, aspect, .15, 3000);
      frameAnchor(horse, anchor, .3, camera.fov, aspect, eye, target);
      camera.position.copy(eye); camera.lookAt(target); camera.updateMatrixWorld(true);
      const center = horse.clone().project(camera);
      assert.ok(Math.abs(center.x) < 1e-10 && Math.abs(center.y) < 1e-10);
      for (const point of [horse, anchor]) {
        const projected = point.clone().project(camera);
        assert.ok(Math.abs(projected.x) < .86 && Math.abs(projected.y) < .86);
        assert.ok(projected.z > -1 && projected.z < 1);
      }

    }
  }
});


test('nearby target preview uses a tight fit instead of a padded sphere', () => {
  const horse = new Vector3(0, 100, 0), anchor = new Vector3(20, 105, 10);
  const eye = new Vector3(), target = new Vector3();
  frameAnchor(horse, anchor, 0, 54, 16 / 9, eye, target);
  assert.ok(eye.distanceTo(target) < 45, 'nearby targets should not force a distant overview');
});


test('target-facing turn is gradual, takes shortest arc and is frame-rate independent', () => {
  const horse = new Vector3(), anchor = new Vector3(.1, 10, 20);
  const initial = Math.PI - .02;
  const first = turnTowardAnchor(initial, horse, anchor, 1/60);
  assert.ok(Math.abs(first-initial) < .01);
  const results = [30,60,120].map(fps => {
    let yaw = 0;
    for(let i=0;i<fps;i++) yaw = turnTowardAnchor(yaw, horse, anchor, 1/fps);
    return yaw;
  });
  assert.ok(Math.abs(results[0]-results[2]) < 1e-10);
  assert.ok(Math.abs(results[0]) > 2.7 && Math.abs(results[0]) < Math.PI);
});


test('pivot reveal finishes within 280ms with the horse centered and pivot visible', () => {
  for (const aspect of [390/844, 16/9]) {
    for (const anchor of [new Vector3(30,120,0), new Vector3(0,130,55), new Vector3(-40,80,-20)]) {
      const horse = new Vector3(0,100,0), start = new Vector3(0,4,9), startAim = new Vector3(0,.8,-7);
      const camera = new PerspectiveCamera(54,aspect,.15,3000), aim = new Vector3();
      revealAnchor(camera,aim,horse,anchor,start,startAim,0);
      assert.ok(camera.position.distanceTo(horse.clone().add(start)) < 1e-10);
      revealAnchor(camera,aim,horse,anchor,start,startAim,.28);
      camera.lookAt(aim); camera.updateMatrixWorld(true);
      const pivot = anchor.clone().project(camera), center = horse.clone().project(camera);
      assert.ok(Math.abs(pivot.x)<.86 && Math.abs(pivot.y)<.86 && pivot.z<1 && pivot.z>-1);
      assert.ok(Math.abs(center.x)<1e-10 && Math.abs(center.y)<1e-10);
    }
  }
});


test('camera clearance detects thin walls and leaves unobstructed segments alone', () => {
  const from = new Vector3(0, 10, 0), to = new Vector3(0, 10, 40);
  const wall = { minX: -5, maxX: 5, minZ: 10, maxZ: 10.05, height: 30 };
  assert.ok(cameraClearance(from, to, [wall], .8) < .25);
  assert.equal(cameraClearance(from, new Vector3(20, 10, 0), [wall]), 1);
});

test('selected framing finds a clear alternative and keeps both endpoints visible', () => {
  for (const aspect of [390 / 844, 16 / 9]) {
    const horse = new Vector3(0, 40, 0), anchor = new Vector3(0, 60, -40);
    const buildings = [{ minX: -4, maxX: 4, minZ: 12, maxZ: 20, height: 90 }];
    const eye = new Vector3(), aim = new Vector3(), state = {};
    chooseAnchorView(horse, anchor, 0, 54, aspect, buildings, state, eye, aim);
    assert.equal(cameraClearance(horse, eye, buildings, .8), 1);
    assert.equal(cameraClearance(eye, anchor, buildings), 1);
    const camera = new PerspectiveCamera(54, aspect, .15, 3000);
    camera.position.copy(eye); camera.lookAt(aim); camera.updateMatrixWorld(true);
    for (const point of [horse, anchor]) {
      const p = point.clone().project(camera);
      assert.ok(Math.abs(p.x) < .86 && Math.abs(p.y) < .86);
    }
    const previous = { ...state };
    chooseAnchorView(horse, anchor, .001, 54, aspect, buildings, state, eye, aim);
    assert.deepEqual(state, previous, 'tiny motion should retain the chosen side');
  }
});

test('reveal transition stays in front of a facade even when no view clears it', () => {
  const horse = new Vector3(0, 40, 0), anchor = new Vector3(0, 60, -40);
  const buildings = [{ minX: -200, maxX: 200, minZ: 4, maxZ: 6, height: 300 }];
  const camera = new PerspectiveCamera(54, 1, .15, 3000), aim = new Vector3(), state = {};
  for (let i = 0; i <= 60; i++) {
    revealAnchor(camera, aim, horse, anchor, new Vector3(0, 3, 2), new Vector3(), i / 60, buildings, state);
    assert.equal(cameraClearance(horse, camera.position, buildings, .8), 1);
    assert.ok(Number.isFinite(camera.position.length()));
  }
});
