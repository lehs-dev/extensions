'use strict';

// Keep the saved quality as a minimum, cover the full magnification envelope,
// and use a whole-number reduction at rest. One texture size per layout avoids
// asynchronous icon reloads during hover frames.
export function iconTextureSize(iconSize, quality = 1, magnification = 1) {
  const size = Math.max(1, Math.round(iconSize));
  const budget = Math.max(32 * Math.max(1, quality), size * Math.max(1, magnification));
  return Math.ceil(budget / size) * size;
}

export function resourceScale(actor) {
  const scale = actor?.get_resource_scale?.();
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

// Apply to settled content, never to an animation's progress or contour.
export const alignPixel = (coordinate, scale = 1) => Math.round(coordinate * scale) / scale;
