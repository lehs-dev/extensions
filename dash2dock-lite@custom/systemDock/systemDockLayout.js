'use strict';

import {LEFT_MODULAR_WIDTH} from '../attachedGeometry.js';
import {computeDockViewport} from '../dockOverflow.js';

// Screen corners own the system pods. The application viewport is centered in
// the remaining interval along the selected edge, with one shared coordinate system.
export function computeUnifiedDockGeometry(params) {
  const {monitor, width = 34, flareWidth = 14, footDepth = 4, cornerRadius = 10,
    padding = 3, horizontalPadding = 2, spacing = 16, appIconSize = 30} = params;
  const edge = params.edge ?? 'left';
  const vertical = edge === 'left' || edge === 'right';
  const start = vertical ? monitor.y : monitor.x;
  const end = start + (vertical ? monitor.height : monitor.width);
  const normal = vertical ? edge === 'right' ? monitor.x + monitor.width - width : monitor.x
    : edge === 'bottom' ? monitor.y + monitor.height - width : monitor.y;
  const pod = (name, fallback, visible, startFlush = false, endFlush = false) => {
    const along = Math.max(0, params[`${name}Content${vertical ? 'Height' : 'Width'}`] ?? fallback);
    const across = Math.min(width - 2 * horizontalPadding,
      params[`${name}Content${vertical ? 'Width' : 'Height'}`] || width - 2 * horizontalPadding);
    const contentStart = (startFlush ? 0 : flareWidth) + padding;
    const length = Math.max(width, along + contentStart + (endFlush ? 0 : flareWidth) + padding);
    return {x: vertical ? normal : start, y: vertical ? start : normal,
      width: vertical ? width : length, height: vertical ? length : width,
      contentWidth: vertical ? across : along, contentHeight: vertical ? along : across,
      contentLeft: vertical ? (width - across) / 2 : contentStart,
      contentTop: vertical ? contentStart : (width - across) / 2,
      position: edge, scaleFactor: 1, flareWidth, footDepth, cornerRadius,
      startFlush, endFlush, visible, length};
  };
  const quickSettings = pod('quickSettings', 60, params.showQuickSettings ?? true, true);
  const inputMethod = pod('inputMethod', 20, params.showInputMethod ?? false, !quickSettings.visible);
  const clock = pod('clock', 50, params.showClock ?? true, false, true);
  const setAlong = (item, value) => { item[vertical ? 'y' : 'x'] = value; };
  const nearSpacing = 3 * (params.scale ?? 1);
  setAlong(inputMethod, start + (quickSettings.visible ? quickSettings.length + nearSpacing : 0));
  setAlong(clock, end - clock.length);
  const upperEnd = inputMethod.visible ? inputMethod[vertical ? 'y' : 'x'] + inputMethod.length
    : quickSettings.visible ? start + quickSettings.length : start;
  const topBoundary = upperEnd + (quickSettings.visible || inputMethod.visible ? spacing : 0);
  const bottomBoundary = clock.visible ? end - clock.length - spacing : end;
  const availableHeight = Math.max(0, bottomBoundary - topBoundary);
  const viewport = computeDockViewport({availableHeight: Math.max(1, availableHeight),
    contentHeight: params.appDockContentHeight, iconSize: appIconSize, flareWidth,
    magnify: params.magnify, spread: params.spread, scale: params.scale});
  const center = (topBoundary + Math.max(topBoundary, bottomBoundary)) / 2;
  const along = center - viewport.height / 2;
  const appDock = {x: vertical ? normal : along, y: vertical ? along : normal,
    width: vertical ? width : viewport.height, height: vertical ? viewport.height : width,
    availableHeight, topBoundary, bottomBoundary, position: edge, vertical,
    centerX: vertical ? normal + width / 2 : center,
    centerY: vertical ? center : normal + width / 2,
    visible: params.showAppDock ?? true, isUnified: true};
  const fits = upperEnd <= bottomBoundary && (!appDock.visible || availableHeight >= appIconSize + 2 * flareWidth) &&
    (!clock.visible || end - clock.length >= start);
  for (const item of [quickSettings, inputMethod, appDock, clock]) item.visible &&= fits;
  return {monitor, edge, vertical, scaleFactor: 1, flareWidth, footDepth, cornerRadius,
    minSpacing: spacing, nearSpacing, quickSettings, inputMethod, clock, appDock, fits};
}

/**
 * Calculates layout geometry for the vertical System Dock attached to the right screen edge.
 *
 * Guarantees that all content (including stacked clock, separators, and power button)
 * is fully enclosed within the straight body of the Attached Edge silhouette, with
 * balanced vertical padding before the top and bottom flare curves begin.
 *
 * @param {Object} params
 * @param {Object} params.monitor Monitor rectangle {x, y, width, height, geometry_scale}
 * @param {number} [params.dockWidth=48] Logical width of the dock (default 48px)
 * @param {number} [params.flareWidth=14] Logical flare width for attached edge
 * @param {number} [params.footDepth=4] Logical foot depth for attached edge
 * @param {number} [params.cornerRadius=10] Logical corner radius for attached edge
 * @param {number} [params.iconSize=18] Logical icon size (default 18px)
 * @param {number} [params.iconSpacing=6] Logical spacing between items
 * @param {number} [params.clockHeight=36] Logical height of the stacked two-line clock
 * @param {boolean} [params.showClock=true] Whether clock is visible
 * @param {number} [params.itemsCount=6] Number of visible non-clock indicator items
 * @param {number} [params.separatorsCount=0] Number of visible separator items
 * @param {number} [params.measuredContentHeight=0] True measured height of the content container
 * @param {number} [params.scaleFactor=1.0] Scaling factor from monitor
 * @returns {Object} Geometry parameters for actor positioning and AttachedDockCanvas
 */
export function computeSystemDockGeometry(params) {
  const monitor = params.monitor || { x: 0, y: 0, width: 1920, height: 1080, geometry_scale: 1.0 };
  const scale = params.scaleFactor || monitor.geometry_scale || 1.0;

  const dockWidth = (typeof params.dockWidth === 'number' && params.dockWidth > 0) ? params.dockWidth : 48;
  const flareWidth = (typeof params.flareWidth === 'number' && params.flareWidth > 0) ? params.flareWidth : 14;
  const footDepth = (typeof params.footDepth === 'number' && params.footDepth > 0) ? params.footDepth : 4;
  const cornerRadius = (typeof params.cornerRadius === 'number' && params.cornerRadius > 0) ? params.cornerRadius : 10;
  const iconSize = (typeof params.iconSize === 'number' && params.iconSize > 0) ? params.iconSize : 18;
  const iconSpacing = (typeof params.iconSpacing === 'number' && params.iconSpacing >= 0) ? params.iconSpacing : 6;
  const clockHeight = (typeof params.clockHeight === 'number' && params.clockHeight > 0) ? params.clockHeight : 36;
  const showClock = params.showClock ?? true;
  const itemsCount = params.itemsCount ?? 0;
  const separatorsCount = params.separatorsCount ?? 0;

  const fw = Math.round(flareWidth * scale);
  const fd = Math.round(footDepth * scale);
  const cr = Math.round(cornerRadius * scale);
  const w = Math.round(dockWidth * scale);
  const spacing = Math.round(iconSpacing * scale);
  const scaledIconSize = Math.round(iconSize * scale);
  const scaledClockHeight = Math.round(clockHeight * scale);

  // Compute inner content height: use measured content height if available, or precise fallback
  let contentHeight = 0;
  if (typeof params.measuredContentHeight === 'number' && params.measuredContentHeight > 0) {
    contentHeight = Math.round(params.measuredContentHeight);
  } else {
    // Precise fallback calculation accounting for button padding and separators
    const buttonPadY = Math.round(8 * scale); // 4px top + 4px bottom padding on St.Button
    const separatorHeight = Math.round(7 * scale); // 1px line + 3px margin top/bottom
    if (showClock) {
      contentHeight += scaledClockHeight + buttonPadY;
    }
    if (separatorsCount > 0) {
      contentHeight += separatorsCount * separatorHeight;
    }
    if (itemsCount > 0) {
      const perButtonHeight = scaledIconSize + buttonPadY;
      contentHeight += itemsCount * perButtonHeight;
    }
    const totalVisibleActors = (showClock ? 1 : 0) + separatorsCount + itemsCount;
    if (totalVisibleActors > 1) {
      contentHeight += (totalVisibleActors - 1) * spacing;
    }
  }

  // Vertical breathing room inside the straight body:
  // Math.max(6 * scale, spacing) guarantees comfortable padding between content and the flares
  const padding = Math.max(Math.round(6 * scale), spacing);
  const totalHeight = Math.max(w, contentHeight + 2 * fw + 2 * padding);

  // Content starts after upper flare plus internal padding
  const contentTop = fw + padding;

  // Position on screen: attached flush to the right edge of primary monitor, vertically centered
  const x = monitor.x + monitor.width - w;
  const y = monitor.y + Math.round((monitor.height - totalHeight) / 2);

  return {
    x,
    y,
    width: w,
    height: totalHeight,
    dockWidth: w,
    dockHeight: totalHeight,
    flareWidth: fw,
    footDepth: fd,
    cornerRadius: cr,
    scaleFactor: scale,
    position: 'right',
    contentTop,
    contentHeight,
    contentWidth: Math.max(1, w - fd),
    iconSize: scaledIconSize,
    iconSpacing: spacing,
    clockHeight: scaledClockHeight,
  };
}

/**
 * Calculates layout geometry for the Left Modular layout (Desktop 3).
 *
 * Coordinates four independent left-attached modules:
 * 1. Quick Settings Pod (top-left)
 * 2. Input Method Pod (below Quick Settings)
 * 3. Application Dock (center-left, constrained in remaining space)
 * 4. Clock Pod (bottom-left)
 *
 * Guarantees:
 * - Deterministic collision avoidance: Application Dock never overlaps top or bottom pod.
 * - Minimum configurable spacing preserved between modules.
 * - Dynamic height auto-adjustment for pods based on visible content.
 *
 * @param {Object} params
 * @returns {Object} Geometries for quickSettings, clock, and appDock constraints
 */
export function computeLeftModularGeometry(params) {
  // Shell monitor rectangles, measured St actors and Cairo paths share stage
  // coordinates. geometry_scale is a texture scale, not another layout multiplier.
  const monitor = params.monitor ?? {x: 0, y: 0, width: 1920, height: 1080};
  const nonnegative = (value, fallback) => Number.isFinite(value) ? Math.max(0, value) : fallback;
  const flareWidth = nonnegative(params.flareWidth, 14);
  const footDepth = nonnegative(params.footDepth, 4);
  const cornerRadius = nonnegative(params.cornerRadius, 10);
  const podPadding = nonnegative(params.podPadding, 3);
  const padding = podPadding;
  const spacing = nonnegative(params.minSpacing, 16);
  const horizontalPadding = nonnegative(params.horizontalPadding, 2);
  // Sacrifice the screen-facing end of each pod to meet the actual corner.
  // The frame and connector no longer add empty space around its content.
  const top = monitor.y + nonnegative(params.upperPodOffset, 0);
  const bottom = monitor.y + monitor.height - nonnegative(params.lowerPodOffset, 0);
  const makePod = (contentHeight, contentWidth, visible, startFlush, endFlush) => {
    // All four resting bodies share one width, independent of labels, saved
    // rail widths and running applications. Center the compact content in it.
    const width = LEFT_MODULAR_WIDTH;
    contentWidth = Math.max(1, Math.min(contentWidth || width - 2 * horizontalPadding,
      width - 2 * horizontalPadding));
    const contentLeft = (width - contentWidth) / 2;
    const contentTop = (startFlush ? 0 : flareWidth) + padding;
    const contentBottom = (endFlush ? 0 : flareWidth) + padding;
    const height = Math.max(width, contentHeight + contentTop + contentBottom);
    return {x: monitor.x, y: top, width, height, flareWidth, footDepth,
      cornerRadius, startFlush, endFlush, scaleFactor: 1, position: 'left', contentTop,
      contentLeft, contentHeight, contentWidth: Math.max(1, contentWidth || width - contentLeft - horizontalPadding), visible};
  };
  const quickSettings = makePod(nonnegative(params.quickSettingsContentHeight, 60),
    nonnegative(params.quickSettingsContentWidth, 0), params.showQuickSettings ?? true, true, false);
  const inputMethod = makePod(nonnegative(params.inputMethodContentHeight, 20),
    nonnegative(params.inputMethodContentWidth, 0), params.showInputMethod ?? false, false, false);
  // The two top capsules have a small gap; the application dock retains the
  // configured inter-module spacing and is centered in the remaining region.
  inputMethod.y = quickSettings.visible ? quickSettings.y + quickSettings.height + 3 : top;
  const clock = makePod(nonnegative(params.clockContentHeight, 50),
    nonnegative(params.clockContentWidth, 0), params.showClock ?? true, false, true);
  clock.y = bottom - clock.height;
  const topEnd = inputMethod.visible ? inputMethod.y + inputMethod.height :
    quickSettings.visible ? quickSettings.y + quickSettings.height : top;
  const topBoundary = topEnd + (quickSettings.visible || inputMethod.visible ? spacing : 0);
  const rawBottom = clock.visible ? clock.y - spacing : bottom;
  const availableHeight = Math.max(0, rawBottom - topBoundary);
  const height = Math.min(nonnegative(params.appDockContentHeight, availableHeight), availableHeight);
  const appDock = {x: monitor.x, topBoundary, bottomBoundary: Math.max(topBoundary, rawBottom),
    availableHeight, minSpacing: spacing, height, y: topBoundary + (availableHeight - height) / 2,
    centerY: topBoundary + availableHeight / 2,
    visible: (params.showAppDock ?? true) && availableHeight > 0, isLeftModular: true};
  // An impossible monitor/settings combination must fail initialization safely,
  // keeping the panel accessible instead of silently painting overlapping pods.
  const fits = (!(params.showAppDock ?? true) || availableHeight >= (params.minimumAppDockHeight ?? 60)) &&
    (!quickSettings.visible || top + quickSettings.height <= bottom) &&
    (!inputMethod.visible || inputMethod.y + inputMethod.height <= rawBottom) &&
    (!clock.visible || clock.y >= top) &&
    (!(quickSettings.visible && clock.visible) || quickSettings.y + quickSettings.height + spacing <= clock.y);
  return {monitor, scaleFactor: 1, flareWidth, footDepth, cornerRadius,
    minSpacing: spacing, quickSettings, inputMethod, clock, appDock, fits};
}

/**
 * Strict silhouette hit testing for an edge-attached dock (supports right or left edge).
 * Returns true if the pointer is inside the solid body or flared feet of the dock,
 * and false in the transparent outer corners away from the screen edge.
 *
 * @param {Array<number>} pointer [px, py] screen coordinates
 * @param {Object} dockRect {x, y, width, height}
 * @param {number} flareWidth Scaled flare width
 * @param {number} footDepth Scaled foot depth
 * @param {string} [position='right'] Attached position ('left' or 'right')
 * @returns {boolean}
 */
export function isWithinSystemDockHoverArea(
  pointer,
  dockRect,
  flareWidth = 14,
  footDepth = 4,
  position = 'right'
) {
  if (!pointer || !dockRect) return false;
  const [px, py] = pointer;
  const { x, y, width: w, height: h } = dockRect;

  if (px < x || px >= x + w) return false;
  if (py < y || py >= y + h) return false;

  if (position === 'left') {
    // Base is at x (screen edge). Solid foot extends from x to x + footDepth.
    // Space to the right of footDepth in top or bottom flare zones is transparent.
    if (py < y + flareWidth && px > x + footDepth) return false;
    if (py > y + h - flareWidth && px > x + footDepth) return false;
    return true;
  }

  // Right-attached: base is at x + w (screen edge). Solid foot extends from x + w - footDepth to x + w.
  if (py < y + flareWidth && px < x + w - footDepth) return false;
  if (py > y + h - flareWidth && px < x + w - footDepth) return false;

  return true;
}
