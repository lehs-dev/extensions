'use strict';

export const KAPPA = (4 * (Math.sqrt(2) - 1)) / 3; // ~0.5522847498307936

export function getAttachedEdgeGeometry({
  width,
  height,
  flareWidth = 14,
  footDepth = 4,
  cornerRadius = 10,
  scaleFactor = 1.0,
  position = 'bottom',
  bodyOffset = 0,
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

  // Body length is the length between the flared ends along the screen edge
  const bodyLength = Math.max(0, L - 2 * fw);

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
  const leftBodyBottom = transform(fw, D - fd);
  const leftBodyTop = transform(fw, cr);
  const topLeft = transform(fw + cr, 0);
  const topRight = transform(L - fw - cr, 0);
  const rightBodyTop = transform(L - fw, cr);
  const rightBodyBottom = transform(L - fw, D - fd);
  const rightFootTip = transform(L, D);

  // Control points for cubic Béziers
  const leftFootCP1 = transform(KAPPA * fw, D);
  const leftFootCP2 = transform(fw, D - KAPPA * fd);

  const topLeftCP1 = transform(fw, (1 - KAPPA) * cr);
  const topLeftCP2 = transform(fw + (1 - KAPPA) * cr, 0);

  const topRightCP1 = transform(L - fw - (1 - KAPPA) * cr, 0);
  const topRightCP2 = transform(L - fw, (1 - KAPPA) * cr);

  const rightFootCP1 = transform(L - fw, D - KAPPA * fd);
  const rightFootCP2 = transform(L - KAPPA * fw, D);

  // Overshoot points into the screen edge to prevent subpixel antialiasing gaps
  const rightFootTipOvershoot = transform(L, D + 2);
  const leftFootTipOvershoot = transform(0, D + 2);

  return {
    width: w,
    height: h,
    bodyWidth: bodyLength,
    bodyLength,
    flareWidth: fw,
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
  const {flareWidth: fw, cornerRadius: cr, height: h, width: w} = g;
  const outerX = y => {
    if (y < fw) return curveXAtY([g.leftFootTip, g.leftFootCP1, g.leftFootCP2, g.leftBodyBottom], y);
    if (y < fw + cr) return curveXAtY([g.leftBodyTop, g.topLeftCP1, g.topLeftCP2, g.topLeft], y);
    return w;
  };
  const boxes = [];
  const end = fw + cr;
  for (let y = 0; y < end; y += 1) {
    const y2 = Math.min(end, y + 1);
    // Do not bridge the step from the connector to the crown at y = fw.
    const split = y < fw && y2 > fw ? fw : y2;
    const x2 = outerX(y);
    if (x2 > 0) {
      boxes.push({x1: 0, y1: y, x2, y2: split});
      boxes.push({x1: 0, y1: h - split, x2, y2: h - y});
    }
    if (split < y2) {
      const x = outerX(split);
      boxes.push({x1: 0, y1: split, x2: x, y2});
      boxes.push({x1: 0, y1: h - y2, x2: x, y2: h - split});
    }
  }
  if (h > 2 * end) boxes.push({x1: 0, y1: end, x2: w, y2: h - end});
  return boxes;
}

