'use strict';

// Stable viewport geometry depends on content/settings, never pointer movement.
export function computeDockViewport({availableHeight, contentHeight, iconSize, flareWidth = 14, magnify = 0, spread = 0.5}) {
  const safeAvailable = Number.isFinite(availableHeight) && availableHeight > 0 ? availableHeight : 100;
  const safeContent = Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : 50;
  const safeIcon = Number.isFinite(iconSize) && iconSize > 0 ? iconSize : 48;
  const safeFlare = Number.isFinite(flareWidth) && flareWidth >= 0 ? flareWidth : 14;
  const safeMagnify = Number.isFinite(magnify) && magnify >= 0 ? magnify : 0;
  let effectiveSpread = Number.isFinite(spread) ? Math.max(0, spread) : 0.5;
  let magnification = safeMagnify * 1.8;
  if (effectiveSpread < 0.2) magnification *= 0.8;
  if (magnification > 0.15 && effectiveSpread < 0.55)
    effectiveSpread = 0.55 + effectiveSpread * 0.2;
  // Reserve room for both renderer growth and the centered spread of nearby
  // icons. This is allocation headroom; the painted background follows icons.
  const desiredReserve = safeFlare + Math.max(6,
    safeIcon * Math.min(1, magnification) * (0.5 + 2 * effectiveSpread));
  // On a short monitor, retain at least one full source icon for wheel/focus
  // navigation instead of allocating all the space to animation headroom.
  const reserve = Math.min(desiredReserve,
    Math.max(safeFlare, (safeAvailable - Math.min(safeContent, safeIcon)) / 2));
  const bodyHeight = Math.max(1, safeAvailable - 2 * reserve);
  const overflow = safeContent > bodyHeight;
  const height = Math.min(safeAvailable, safeContent + 2 * reserve);
  return {
    height: Math.round(height),
    contentTop: Math.round(reserve),
    bodyHeight: Math.max(1, Math.round(Math.min(safeContent, bodyHeight))),
    overflow,
  };
}
