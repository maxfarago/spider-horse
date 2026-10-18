// World-space distance deliberately has no dependency on camera projection.
// Only the separate in-world marker may disappear outside the camera view.
export function updateWebTarget(panel, label, distance, { started, anchor, position, attached, anchorNumber = 0 }) {
  panel.classList.toggle('hidden', !started);
  label.textContent = attached ? 'Web attached' : anchor ? 'Ledge selected' : 'No ledge in reach';
  if (anchor && anchorNumber) label.textContent = `${attached ? 'Attached to' : 'Selected'} ledge ${anchorNumber} · ↑ ↓`;
  distance.textContent = anchor
    ? `${Math.round(Math.hypot(anchor.x - position.x, anchor.y - position.y, anchor.z - position.z))} m`
    : '—';
}
