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
  return { forward: grounded ? Number(held('ArrowUp')) - Number(held('ArrowDown')) : 0, strafe: 0 };
}

export function panView(yaw, held, dt, steering = 0) {
  const pan = Math.max(-1, Math.min(1, Number(held('ArrowLeft')) - Number(held('ArrowRight')) - steering));
  const next = yaw + pan * dt * 1.6;
  return Math.atan2(Math.sin(next), Math.cos(next));
}

export function attachmentViewYaw(yaw, velocity, wasGrounded) {
  if (wasGrounded || Math.hypot(velocity.x, velocity.z) < 1) return yaw;
  return Math.atan2(-velocity.x, -velocity.z);
}

export function bindJoystick(surface, { enabled, change }) {
  let pointer = null;
  const update = event => {
    const rect = surface.getBoundingClientRect();
    const value = Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width * .35)));
    change(Math.abs(value) < .12 ? 0 : value);
  };
  const clear = () => { if (pointer === null) return; pointer = null; change(0); };
  surface.addEventListener('pointerdown', event => {
    if (pointer !== null || event.button !== 0 || !enabled()) return;
    event.preventDefault(); pointer = event.pointerId; surface.setPointerCapture(pointer); update(event);
  });
  surface.addEventListener('pointermove', event => { if (event.pointerId === pointer) { event.preventDefault(); update(event); } });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    surface.addEventListener(type, event => { if (event.pointerId === pointer) clear(); });
  }
  surface.addEventListener('contextmenu', event => event.preventDefault());
  return clear;
}

// Input intent leads momentum slightly; camera yaw is deliberately absent.
export function travelIntent(velocity, heading, steer = 0) {
  const speed = Math.hypot(velocity.x, velocity.z);
  const direction = speed > 3 ? Math.atan2(-velocity.x, -velocity.z) : heading;
  return direction + Math.max(-1, Math.min(1, steer)) * .4;
}

export function bindLook(surface, { enabled, change }) {
  let pointer = null, x = 0, y = 0;
  const clear = () => { pointer = null; };
  surface.addEventListener('pointerdown', event => {
    if (!enabled() || pointer !== null || (event.pointerType !== 'touch' && event.button !== 2)) return;
    event.preventDefault(); pointer = event.pointerId; x = event.clientX; y = event.clientY;
    surface.setPointerCapture(pointer);
  });
  surface.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    change(event.clientX-x, event.clientY-y); x=event.clientX; y=event.clientY;
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) surface.addEventListener(type,event=>{if(event.pointerId===pointer)clear();});
  surface.addEventListener('contextmenu',event=>event.preventDefault());
  return clear;
}
