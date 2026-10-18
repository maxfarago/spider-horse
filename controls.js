export function bindHold(button, { enabled, press, release }) {
  let pointer = null;
  const clear = (released = false) => {
    if (pointer === null) return;
    pointer = null; button.setAttribute('aria-pressed', 'false'); release(released);
  };
  button.addEventListener('pointerdown', event => {
    if (pointer !== null || event.button !== 0 || !enabled()) return;
    event.preventDefault(); pointer = event.pointerId;
    button.setPointerCapture(pointer); button.setAttribute('aria-pressed', 'true'); press();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, event => { if (event.pointerId === pointer) clear(type === 'pointerup'); });
  }
  button.addEventListener('contextmenu', event => event.preventDefault());
  return clear;
}

export function rooftopInput(grounded, held) {
  if (!grounded) return { forward: 0, strafe: 0 };
  const forward = Number(held('ArrowUp')) - Number(held('ArrowDown'));
  const strafe = Number(held('ArrowRight')) - Number(held('ArrowLeft'));
  const scale = Math.max(1, Math.hypot(forward, strafe));
  return { forward: forward / scale, strafe: strafe / scale };
}
