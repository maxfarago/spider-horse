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


test('rooftop arrows move only on the ground and normalize diagonals', async () => {
  const { rooftopInput } = await import('./controls.js');
  const held = (...keys) => key => keys.includes(key);
  assert.deepEqual(rooftopInput(false, held('ArrowUp')), {forward:0,strafe:0});
  assert.deepEqual(rooftopInput(true, held('ArrowUp')), {forward:1,strafe:0});
  const diagonal = rooftopInput(true, held('ArrowDown','ArrowLeft'));
  assert.ok(Math.abs(Math.hypot(diagonal.forward,diagonal.strafe)-1)<1e-10);
  assert.ok(diagonal.forward<0 && diagonal.strafe<0);
  assert.deepEqual(rooftopInput(true, held('ArrowUp','ArrowDown','ArrowRight','ArrowLeft')), {forward:0,strafe:0});
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
