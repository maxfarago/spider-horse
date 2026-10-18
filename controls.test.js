import test from 'node:test';
import assert from 'node:assert/strict';
import { bindHold } from './controls.js';
class Surface extends EventTarget {
  attributes = {};
  setPointerCapture(id) { this.captured = id; }
  setAttribute(name, value) { this.attributes[name] = value; }
  pointer(type, id, x = 0, y = 0) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: id, button: 0, clientX: x, clientY: y });
    this.dispatchEvent(event);
  }
}
test('held web ignores unrelated fingers and releases once on cancellation', () => {
  const button = new Surface();
  let presses = 0, releases = 0;
  bindHold(button, { enabled: () => true, press: () => presses++, release: () => releases++ });
  button.pointer('pointerdown', 1); button.pointer('pointerdown', 2);
  button.pointer('pointerup', 2);
  assert.equal(presses, 1); assert.equal(releases, 0);
  button.pointer('pointercancel', 1); button.pointer('lostpointercapture', 1);
  assert.equal(releases, 1);
});
test('pause cleanup releases a held web and rejects inactive input', () => {
  const button = new Surface();
  let enabled = true, releases = 0, presses = 0;
  const clear = bindHold(button, { enabled: () => enabled, press: () => presses++, release: () => releases++ });
  button.pointer('pointerdown', 4); clear(); clear(); enabled = false;
  button.pointer('pointerdown', 5);
  assert.equal(presses, 1); assert.equal(releases, 1);
  assert.equal(button.attributes['aria-pressed'], 'false');
});


test('rooftop movement uses up/down while left/right are reserved for view panning', async () => {
  const { rooftopInput } = await import('./controls.js');
  const held = (...keys) => key => keys.includes(key);
  assert.deepEqual(rooftopInput(false, held('ArrowUp')), {forward:0,strafe:0});
  assert.deepEqual(rooftopInput(true, held('ArrowUp','ArrowLeft')), {forward:1,strafe:0});
  assert.deepEqual(rooftopInput(true, held('ArrowDown','ArrowRight')), {forward:-1,strafe:0});
  assert.deepEqual(rooftopInput(true, held('ArrowLeft')), {forward:0,strafe:0});
});

test('view panning is continuous, frame-rate independent and stops on release', async () => {
  const { panView, attachmentViewYaw } = await import('./controls.js');
  const held = (...keys) => key => keys.includes(key);
  for (const fps of [30,60,120]) {
    let yaw = 0;
    for (let i=0;i<fps;i++) yaw = panView(yaw,held('ArrowLeft'),1/fps);
    assert.ok(Math.abs(yaw-1.6)<1e-10);
    assert.equal(panView(yaw,held(),1/fps),yaw);
    assert.equal(panView(yaw,held('ArrowLeft','ArrowRight'),1/fps),yaw);
  }
  assert.ok(panView(0,held('ArrowRight'),.1)<0);
  assert.equal(attachmentViewYaw(1,{x:20,z:0},false),-Math.PI/2);
  assert.equal(attachmentViewYaw(1,{x:20,z:0},true),1,'rooftop attachment retains the chosen view');
  assert.equal(attachmentViewYaw(1,{x:0,z:0},false),1,'stationary catches retain a meaningful heading');
});

test('only an intentional pointer-up requests a spring launch', () => {
  const button = new Surface(), releases = [];
  const clear = bindHold(button, { enabled: () => true, press: () => {}, release: value => releases.push(value) });
  button.pointer('pointerdown', 1); button.pointer('pointerup', 1);
  button.pointer('lostpointercapture', 1);
  button.pointer('pointerdown', 2); button.pointer('pointercancel', 2);
  button.pointer('pointerdown', 3); clear();
  assert.deepEqual(releases, [true, false, false]);
});

test('joystick tracks one finger, ignores unrelated touches and resets on cancellation', async () => {
  const { bindJoystick, panView } = await import('./controls.js');
  const surface = new Surface(), values = [];
  surface.getBoundingClientRect = () => ({left:0,width:100});
  let enabled = true;
  const clear = bindJoystick(surface,{enabled:()=>enabled,change:value=>values.push(value)});
  surface.pointer('pointerdown',1,85);
  assert.equal(values.at(-1),1);
  surface.pointer('pointermove',2,15);
  assert.equal(values.length,1);
  surface.pointer('pointermove',1,15);
  assert.equal(values.at(-1),-1);
  surface.pointer('pointerup',2);
  assert.equal(values.at(-1),-1);
  surface.pointer('pointercancel',1);
  assert.equal(values.at(-1),0);
  surface.pointer('pointerdown',3,70); clear();
  assert.equal(values.at(-1),0);
  enabled = false; const count = values.length;
  surface.pointer('pointerdown',4,85);
  assert.equal(values.length,count);
  assert.ok(panView(0,()=>false,.1,.5)<0,'right joystick pans right');
});
