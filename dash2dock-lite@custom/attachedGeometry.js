'use strict';

export const KAPPA = (4 * (Math.sqrt(2) - 1)) / 3; // ~0.5522847498307936
export const LEFT_MODULAR_WIDTH = 34;

export function getAttachedEdgeGeometry({
  width,
  height,
  flareWidth = 14,
  footDepth = 4,
  cornerRadius = 10,
  scaleFactor = 1.0,
  position = 'bottom',
  bodyOffset = 0,
  startFlush = false,
  endFlush = false,
}) {
  const requestedFlare = Math.max(0, flareWidth * scaleFactor);
  let fd = Math.max(0, footDepth * scaleFactor);
  let cr = Math.max(0, cornerRadius * scaleFactor);

  let w = Math.max(1, width);
  let h = Math.max(1, height);

  const isVertical = position === 'left' || position === 'right';
  const L = isVertical ? h : w;
  let D = isVertical ? w : h;

  const fw = Math.min(requestedFlare, L / 2);
  const startFlare = startFlush ? 0 : fw;
  const endFlare = endFlush ? 0 : fw;

  // Body length is the length between the flared ends along the screen edge
  const bodyLength = Math.max(0, L - startFlare - endFlare);

  // Clamp corner radius so it does not exceed half body length
  if (cr * 2 > bodyLength) {
    cr = bodyLength / 2;
  }

  // Clamp foot depth and corner radius so their sum does not exceed total depth
  if (cr + fd > D) {
    const total = cr + fd;
    if (total > 0) {
      cr = (cr / total) * D;
      fd = (fd / total) * D;
    }
  }
  const startCorner = startFlush ? 0 : cr;
  const endCorner = endFlush ? 0 : cr;

  // Stretch only the screen-normal connector. The crown, corners and straight
  // body move together; both edge tips and their edge tangents remain anchored.
  const offset = Number.isFinite(bodyOffset) ? Math.max(0, bodyOffset) : 0;
  D += offset;
  fd += offset;
  if (isVertical) w += offset;
  else h += offset;

  // Canonical coordinate mapping:
  // u in [0, L] along the screen edge
  // v in [0, D] perpendicular to screen edge (v = D at screen edge, v = 0 at inner crown)
  let transform;
  switch (position) {
    case 'top':
      // Base at y = 0, crown at y = h
      transform = (u, v) => ({ x: u, y: D - v });
      break;
    case 'left':
      // Base at x = 0, crown at x = w
      transform = (u, v) => ({ x: D - v, y: u });
      break;
    case 'right':
      // Base at x = w, crown at x = 0
      transform = (u, v) => ({ x: v, y: u });
      break;
    case 'bottom':
    default:
      // Base at y = h, crown at y = 0
      transform = (u, v) => ({ x: u, y: v });
      break;
  }

  // Key boundary points in canonical coordinates
  const leftFootTip = transform(0, D);
  const leftBodyBottom = transform(startFlare, D - fd);
  const leftBodyTop = transform(startFlare, startCorner);
  const topLeft = transform(startFlare + startCorner, 0);
  const topRight = transform(L - endFlare - endCorner, 0);
  const rightBodyTop = transform(L - endFlare, endCorner);
  const rightBodyBottom = transform(L - endFlare, D - fd);
  const rightFootTip = transform(L, D);

  // Control points for cubic Béziers
  const leftFootCP1 = transform(KAPPA * startFlare, D);
  const leftFootCP2 = transform(startFlare, D - KAPPA * fd);

  const topLeftCP1 = transform(startFlare, (1 - KAPPA) * startCorner);
  const topLeftCP2 = transform(startFlare + (1 - KAPPA) * startCorner, 0);

  const topRightCP1 = transform(L - endFlare - (1 - KAPPA) * endCorner, 0);
  const topRightCP2 = transform(L - endFlare, (1 - KAPPA) * endCorner);

  const rightFootCP1 = transform(L - endFlare, D - KAPPA * fd);
  const rightFootCP2 = transform(L - KAPPA * endFlare, D);

  // Overshoot points into the screen edge to prevent subpixel antialiasing gaps
  const rightFootTipOvershoot = transform(L, D + 2);
  const leftFootTipOvershoot = transform(0, D + 2);

  return {
    width: w,
    height: h,
    bodyWidth: bodyLength,
    bodyLength,
    flareWidth: fw,
    startFlareWidth: startFlare,
    endFlareWidth: endFlare,
    startCornerRadius: startCorner,
    endCornerRadius: endCorner,
    footDepth: fd,
    cornerRadius: cr,
    scaleFactor,
    position,
    bodyOffset: offset,
    leftFootTip,
    leftBodyBottom,
    leftBodyTop,
    topLeft,
    topRight,
    rightBodyTop,
    rightBodyBottom,
    rightFootTip,
    leftFootCP1,
    leftFootCP2,
    topLeftCP1,
    topLeftCP2,
    topRightCP1,
    topRightCP2,
    rightFootCP1,
    rightFootCP2,
    rightFootTipOvershoot,
    leftFootTipOvershoot,
  };
}

const cubic = (a, b, c, d, t) =>
  (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;

function curveXAtY(points, y) {
  const ys = points.map(p => p.y);
  const xs = points.map(p => p.x);
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    if (cubic(...ys, mid) < y) low = mid;
    else high = mid;
  }
  return cubic(...xs, (low + high) / 2);
}

/** Conservative, one-pixel bands INSIDE the actual left capsule Bézier path.
 * Used by Clutter picking, so transparent flares and unused animation reserve
 * do not become an input region. No extra actors or global pointer polling.
 */
export function getAttachedPodPickBoxes(params) {
  const g = getAttachedEdgeGeometry({...params, position: 'left'});
  const {height: h, width: w} = g;
  const boxes = [];
  const addEnd = (fw, cr, foot, corner, reverse) => {
    const reflect = points => reverse ? points.map(p => ({x: p.x, y: h - p.y})) : points;
    foot = reflect(foot);
    corner = reflect(corner);
    const end = fw + cr;
    for (let y = 0; y < end;) {
      // Keep bands on one side of the connector/crown step.
      const y2 = Math.min(end, y + 1, y < fw ? fw : end);
      const x2 = curveXAtY(y < fw ? foot : corner, y);
      if (x2 > 0) boxes.push({x1: 0, y1: reverse ? h - y2 : y, x2,
        y2: reverse ? h - y : y2});
      y = y2;
    }
    return end;
  };
  const start = addEnd(g.startFlareWidth, g.startCornerRadius,
    [g.leftFootTip, g.leftFootCP1, g.leftFootCP2, g.leftBodyBottom],
    [g.leftBodyTop, g.topLeftCP1, g.topLeftCP2, g.topLeft], false);
  const end = addEnd(g.endFlareWidth, g.endCornerRadius,
    [g.rightFootTip, g.rightFootCP2, g.rightFootCP1, g.rightBodyBottom],
    [g.rightBodyTop, g.topRightCP2, g.topRightCP1, g.topRight], true);
  if (h > start + end) boxes.push({x1: 0, y1: start, x2: w, y2: h - end});
  return boxes;
}

