import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { createHorse } from './horse.js';

const bytes = await readFile(new URL('./assets/warhorse.glb', import.meta.url));
const jsonLength = bytes.readUInt32LE(12);
const source = JSON.parse(bytes.subarray(20, 20 + jsonLength));
const binary = bytes.subarray(28 + jsonLength);
// Exercise the real embedded geometry, bind matrices and animations in Node.
// Image decoding alone is omitted because these tests do not render WebGL.
async function loadRig() {
  const json = structuredClone(source);
  json.materials = []; json.textures = []; json.images = [];
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  json.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`;
  const manager = new THREE.LoadingManager();
  manager.addHandler(/^data:application\/octet-stream/, {
    load(_url, onLoad) { onLoad(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength)); },
  });
  // FileLoader emits this DOM event even for an embedded data URI.
  const previousProgressEvent = globalThis.ProgressEvent;
  globalThis.ProgressEvent ??= class ProgressEvent {
    constructor(type, data) { this.type = type; Object.assign(this, data); }
  };
  try {
    return await new GLTFLoader(manager).parseAsync(JSON.stringify(json), '');
  } finally {
    if (!previousProgressEvent) delete globalThis.ProgressEvent;
  }
}
async function horseFixture(t) {
  t.mock.method(GLTFLoader.prototype, 'loadAsync', () => loadRig());
  return createHorse();
}
const positionOf = (horse, name) => horse.group.getObjectByName(name).getWorldPosition(new THREE.Vector3());
const advance = (horse, seconds, state) => {
  for (let frame = 0; frame < Math.round(seconds * 60); frame++) horse.update(1 / 60, state);
};
const feet = ['finger_L', 'finger_R', 'toe_L', 'toe_R'];
const positionAtSaddle = (horse, name) => horse.group.getObjectByName('saddle_socket').worldToLocal(positionOf(horse, name));
const rotationOf = (horse, name) => horse.group.getObjectByName(name).getWorldQuaternion(new THREE.Quaternion());
const snapshot = horse => {
  const transforms = [];
  horse.group.traverse(object => transforms.push(...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()));
  return transforms;
};

test('horse asset contains real skinned geometry, embedded PBR maps and continuous authored loops', async () => {
  assert.equal(source.skins.length, 1);
  assert.ok(source.skins[0].joints.length >= 35);
  const primitive = source.meshes[0].primitives[0];
  assert.ok(source.accessors[primitive.attributes.POSITION].count > 9000);
  assert.ok(primitive.attributes.JOINTS_0 !== undefined && primitive.attributes.WEIGHTS_0 !== undefined);
  const material = source.materials[0];
  assert.ok(material.normalTexture && material.pbrMetallicRoughness.baseColorTexture && material.pbrMetallicRoughness.metallicRoughnessTexture);
  assert.ok(source.images.every(image => image.bufferView !== undefined));
  const { animations } = await loadRig();
  for (const name of ['idle_loop', 'walk_loop', 'canter_loop', 'rear']) assert.ok(THREE.AnimationClip.findByName(animations, name));
  for (const clip of animations.filter(item => item.name.endsWith('_loop'))) {
    for (const track of clip.tracks) {
      const interpolant = track.createInterpolant();
      const start = Array.from(interpolant.evaluate(0));
      const end = Array.from(interpolant.evaluate(clip.duration));
      if (track.ValueTypeName === 'quaternion') {
        const angle = new THREE.Quaternion().fromArray(start).angleTo(new THREE.Quaternion().fromArray(end));
        assert.ok(angle < 0.002, `${clip.name}: ${track.name} has a discontinuous rotation`);
      } else assert.ok(Math.max(...start.map((value, i) => Math.abs(value - end[i]))) < 0.002, `${clip.name}: ${track.name} jumps at its seam`);
    }
  }
});

test('model faces forward, stands on its soles and tether follows the actual saddle', async t => {
  const horse = await horseFixture(t);
  horse.group.updateMatrixWorld(true);
  assert.ok(positionOf(horse, 'head').z < positionOf(horse, 'tail_01').z);
  const box = new THREE.Box3().setFromObject(horse.group, true);
  assert.ok(Math.abs(box.min.y) < 0.01, `soles at ${box.min.y}`);
  assert.ok(box.max.y > 2 && box.max.y < 2.25);
  assert.equal(horse.attachment.parent.name, 'saddle_socket');
  const before = horse.attachment.getWorldPosition(new THREE.Vector3());
  advance(horse, 0.6, { grounded: true, speed: 8 });
  const after = horse.attachment.getWorldPosition(new THREE.Vector3());
  assert.ok(after.distanceTo(before) > 0.005, 'attachment should follow authored spine motion');
  assert.ok(after.distanceTo(positionOf(horse, 'saddle_socket')) < 0.15);
});

test('all four hooves keep galloping in the air, even at the apex or extreme airspeed', async t => {
  for (const speed of [0, 100]) {
    const horse = await horseFixture(t);
    const state = { grounded: false, swinging: true, speed, tension: 0.8, stretch: 3 };
    advance(horse, 2, state);
    const paths = feet.map(() => []);
    for (let frame = 0; frame < 180; frame++) {
      horse.update(1 / 60, state);
      feet.forEach((name, i) => paths[i].push(positionAtSaddle(horse, name)));
    }
    paths.forEach((path, i) => {
      // Saddle-relative coordinates exclude translation, body bob and pitching:
      // each leg must articulate, rather than riding along with the whole horse.
      const range = new THREE.Box3().setFromPoints(path.slice(0, 90)).getSize(new THREE.Vector3());
      assert.ok(range.length() > 0.08, `${feet[i]} needs a visible stride at speed ${speed}`);
      const fullBox = new THREE.Box3().setFromPoints(path);
      const span = fullBox.getSize(new THREE.Vector3());
      const axis = ['x', 'y', 'z'].reduce((a, b) => span[a] > span[b] ? a : b);
      const low = fullBox.min[axis] + span[axis] * 0.3;
      const high = fullBox.min[axis] + span[axis] * 0.7;
      let armed = false, strides = 0;
      for (const point of path) {
        if (point[axis] < low) armed = true;
        if (armed && point[axis] > high) { strides++; armed = false; }
      }
      // Count full excursions with hysteresis so tiny secondary motions cannot
      // masquerade as strides. Airspeed must not turn the legs into a blur.
      assert.ok(strides >= 2 && strides <= 9, `${feet[i]} made ${strides} strides in 3 seconds at speed ${speed}`);
    });
  }
});

test('pause freezes the active airborne gait and every secondary joint', async t => {
  const horse = await horseFixture(t);
  advance(horse, 2.3, { grounded: false, swinging: true, speed: 100, tension: 1, stretch: 5, verticalSpeed: -20 });
  const paused = snapshot(horse);
  for (let i = 0; i < 10; i++) horse.update(0, { grounded: true, speed: 0, tension: 0, time: 1000 });
  assert.deepEqual(snapshot(horse), paused);
});

test('bungee loading displaces and pitches the body and release leaves a damped recoil', async t => {
  const horse = await horseFixture(t);
  const reference = await horseFixture(t);
  const unloaded = { grounded: false, swinging: true, speed: 20, tension: 0, stretch: 0, verticalSpeed: 0 };
  const loaded = { ...unloaded, tension: 1, stretch: 5, verticalSpeed: -20 };
  advance(horse, 2, unloaded);
  advance(reference, 2, unloaded);
  advance(horse, 2, loaded);
  advance(reference, 2, unloaded);
  // Observe the visible suspension pivot independently of authored stride phase,
  // which can change cadence while the cord is loaded.
  const torsoOffset = () => positionOf(horse, 'suspension-response').sub(positionOf(reference, 'suspension-response'));
  const initialOffset = torsoOffset();
  assert.ok(initialOffset.length() > 0.025, 'a loaded cord should visibly displace the torso');
  assert.ok(rotationOf(horse, 'suspension-response').angleTo(rotationOf(reference, 'suspension-response')) > 0.025, 'the suspended horse should pitch under load');
  const axis = initialOffset.clone().normalize();
  const recoil = [];
  let previous = positionOf(horse, 'head');
  for (let frame = 0; frame < 180; frame++) {
    horse.update(1 / 60, unloaded);
    reference.update(1 / 60, unloaded);
    recoil.push(torsoOffset().dot(axis));
    const next = positionOf(horse, 'head');
    assert.ok(next.distanceTo(previous) < 0.08, 'releasing the cord must not snap the head pose');
    previous = next;
  }
  assert.ok(recoil[0] > initialOffset.length() * 0.5, 'the pose should retain inertia at release');
  assert.ok(Math.min(...recoil) < -0.005, 'the torso should rebound past its unloaded position');
  const residual = Math.max(...recoil.slice(-30).map(Math.abs));
  assert.ok(residual < initialOffset.length() * 0.2, 'recoil should settle rather than oscillating indefinitely');
});

test('gait and flight transitions keep all skinned vertices finite without pose snaps', async t => {
  const horse = await horseFixture(t);
  const stages = [
    { grounded: true, speed: 2 },
    { grounded: true, speed: 100 },
    { grounded: false, speed: 100, swinging: true, tension: 1 },
    { grounded: false, speed: 60, verticalSpeed: -30, tension: 0 },
    { grounded: true, speed: 5 },
  ];
  for (const state of stages) {
    let previous = positionOf(horse, 'head');
    for (let i = 0; i < 90; i++) {
      horse.update(1 / 60, state);
      const next = positionOf(horse, 'head');
      assert.ok(next.distanceTo(previous) < 0.08, 'head position should blend without a sudden snap');
      previous = next;
    }
    horse.group.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        mesh.getVertexPosition(i, vertex);
        assert.ok(vertex.toArray().every(Number.isFinite), `invalid skinned vertex ${i}`);
        assert.ok(vertex.length() < 5, `unstable skinned vertex ${i}`);
      }
    });
  }
});

test('intro hang has a connected ankle sling and returns to the animated flight rig', async t => {
  const horse = await horseFixture(t);
  horse.group.rotation.set(-Math.PI / 2, 1.05, .06, 'YXZ');
  advance(horse, 1, { hanging: true, grounded: false, speed: 0 });
  const sling = horse.group.getObjectByName('intro-ankle-sling');
  assert.equal(sling.visible, true);
  const knot = horse.hangingAttachment.getWorldPosition(new THREE.Vector3());
  assert.ok(knot.y > positionOf(horse, 'head').y + 1, 'head hangs below the knot');
  const points = sling.geometry.attributes.position;
  for (const [index, name] of [[0, 'toe_L'], [2, 'toe_R']]) {
    const endpoint = new THREE.Vector3().fromBufferAttribute(points, index);
    horse.group.localToWorld(endpoint);
    assert.ok(endpoint.distanceTo(positionOf(horse, name)) < 1e-5, 'sling touches the animated ankle');
  }
  assert.ok([...points.array].every(Number.isFinite));
  // Silk turns stay close to each animated pastern, not on a floating cone.
  for (const [firstVertex, name] of [[4, 'toe_L'], [420, 'toe_R']]) {
    const ankle = positionOf(horse, name);
    for (let i = firstVertex; i < firstVertex + 320; i++) {
      const wrap = new THREE.Vector3().fromBufferAttribute(points, i);
      horse.group.localToWorld(wrap);
      assert.ok(wrap.distanceTo(ankle) < .13, 'wrap hugs the ankle');
    }
  }
  const paused = snapshot(horse);
  advance(horse, 3, { hanging: true, grounded: false, speed: 0 });
  assert.deepEqual(snapshot(horse), paused, 'title pose must not drift or circle');
  horse.update(0, { hanging: true });
  assert.deepEqual(snapshot(horse), paused);
  horse.group.rotation.set(0, 0, 0, 'XYZ');
  advance(horse, .5, { grounded: false, speed: 15 });
  assert.equal(sling.visible, false);
  assert.ok(snapshot(horse).every(Number.isFinite));
});

test('catch and soar poses differ on the real rig and remain stable through pause and landing', async t => {
  const catchHorse=await horseFixture(t), soarHorse=await horseFixture(t);
  const common={grounded:false,speed:30,verticalSpeed:5};
  advance(catchHorse,.5,{...common,feel:{catch:1}});
  advance(soarHorse,.5,{...common,feel:{soar:1}});
  assert.ok(rotationOf(catchHorse,'upperarm_L').angleTo(rotationOf(soarHorse,'upperarm_L'))>.1);
  const paused=snapshot(soarHorse);
  soarHorse.update(0,{...common,feel:{release:1}});
  assert.deepEqual(snapshot(soarHorse),paused);
  advance(soarHorse,2,{grounded:true,speed:0});
  assert.ok(snapshot(soarHorse).every(Number.isFinite));
});


test('zip arrival immediately stops the legs, while rooftop running still animates', async t => {
  const horse=await horseFixture(t);
  advance(horse,.6,{grounded:false,speed:60,feel:{soar:1}});
  const standing={grounded:true,perched:true,speed:0};
  horse.update(1/60,standing);
  const landed=feet.map(name=>positionOf(horse,name));
  advance(horse,.4,standing);
  feet.forEach((name,i)=>assert.ok(positionOf(horse,name).distanceTo(landed[i])<1e-6, 'hooves must stay still immediately after arrival'));
  advance(horse,.3,{...standing,speed:5});
  assert.ok(feet.some((name,i)=>positionOf(horse,name).distanceTo(landed[i])>.01), 'rooftop movement animates the gait');
  horse.update(1/60,standing);
  const stopped=feet.map(name=>positionOf(horse,name));
  advance(horse,.3,standing);
  feet.forEach((name,i)=>assert.ok(positionOf(horse,name).distanceTo(stopped[i])<1e-6));
});
