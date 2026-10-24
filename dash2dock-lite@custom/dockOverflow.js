'use strict';

// Stable viewport geometry depends on content/settings, never pointer movement.
export function computeDockViewport({availableHeight, contentHeight, iconSize, flareWidth = 14, magnify = 0}) {
  const safeAvailable = Number.isFinite(availableHeight) && availableHeight > 0 ? availableHeight : 100;
  const safeContent = Number.isFinite(contentHeight) && contentHeight > 0 ? contentHeight : 50;
  const safeIcon = Number.isFinite(iconSize) && iconSize > 0 ? iconSize : 48;
  const safeFlare = Number.isFinite(flareWidth) && flareWidth >= 0 ? flareWidth : 14;
  const safeMagnify = Number.isFinite(magnify) && magnify >= 0 ? magnify : 0;
  const reserve = safeFlare + Math.max(6, safeIcon * safeMagnify * 0.9);
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
