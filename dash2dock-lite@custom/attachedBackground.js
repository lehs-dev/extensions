'use strict';

import GObject from 'gi://GObject';
import St from 'gi://St';
import Cairo from 'gi://cairo';

export const KAPPA = (4 * (Math.sqrt(2) - 1)) / 3; // ~0.5522847498307936

export function getAttachedEdgeGeometry({
  width,
  height,
  flareWidth = 14,
  footDepth = 4,
  cornerRadius = 10,
  scaleFactor = 1.0,
  position = 'bottom',
}) {
  const fw = Math.max(0, flareWidth * scaleFactor);
  let fd = Math.max(0, footDepth * scaleFactor);
  let cr = Math.max(0, cornerRadius * scaleFactor);

  const w = Math.max(1, width);
  const h = Math.max(1, height);

  const isVertical = position === 'left' || position === 'right';
  const L = isVertical ? h : w;
  const D = isVertical ? w : h;

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

export function buildAttachedFillPath(ctx, geom) {
  ctx.newPath();
  // Start at top-left straight edge start
  ctx.moveTo(geom.topLeft.x, geom.topLeft.y);
  // Top straight edge
  ctx.lineTo(geom.topRight.x, geom.topRight.y);
  // Top-right corner
  ctx.curveTo(
    geom.topRightCP1.x, geom.topRightCP1.y,
    geom.topRightCP2.x, geom.topRightCP2.y,
    geom.rightBodyTop.x, geom.rightBodyTop.y
  );
  // Right vertical body edge
  ctx.lineTo(geom.rightBodyBottom.x, geom.rightBodyBottom.y);
  // Right foot flare
  ctx.curveTo(
    geom.rightFootCP1.x, geom.rightFootCP1.y,
    geom.rightFootCP2.x, geom.rightFootCP2.y,
    geom.rightFootTip.x, geom.rightFootTip.y
  );
  // Base extension to prevent subpixel antialiasing gaps
  if (geom.rightFootTipOvershoot && geom.leftFootTipOvershoot) {
    ctx.lineTo(geom.rightFootTipOvershoot.x, geom.rightFootTipOvershoot.y);
    ctx.lineTo(geom.leftFootTipOvershoot.x, geom.leftFootTipOvershoot.y);
  } else {
    const bottomOvershoot = geom.height + 2;
    ctx.lineTo(geom.rightFootTip.x, bottomOvershoot);
    ctx.lineTo(geom.leftFootTip.x, bottomOvershoot);
  }
  ctx.lineTo(geom.leftFootTip.x, geom.leftFootTip.y);
  // Left foot flare
  ctx.curveTo(
    geom.leftFootCP1.x, geom.leftFootCP1.y,
    geom.leftFootCP2.x, geom.leftFootCP2.y,
    geom.leftBodyBottom.x, geom.leftBodyBottom.y
  );
  // Left vertical body edge
  ctx.lineTo(geom.leftBodyTop.x, geom.leftBodyTop.y);
  // Top-left corner
  ctx.curveTo(
    geom.topLeftCP1.x, geom.topLeftCP1.y,
    geom.topLeftCP2.x, geom.topLeftCP2.y,
    geom.topLeft.x, geom.topLeft.y
  );
  ctx.closePath();
}

export function buildAttachedContourPath(ctx, geom) {
  ctx.newPath();
  // Start at left flare tip at screen edge
  ctx.moveTo(geom.leftFootTip.x, geom.leftFootTip.y);
  // Left foot flare
  ctx.curveTo(
    geom.leftFootCP1.x, geom.leftFootCP1.y,
    geom.leftFootCP2.x, geom.leftFootCP2.y,
    geom.leftBodyBottom.x, geom.leftBodyBottom.y
  );
  // Left vertical body edge
  ctx.lineTo(geom.leftBodyTop.x, geom.leftBodyTop.y);
  // Top-left corner
  ctx.curveTo(
    geom.topLeftCP1.x, geom.topLeftCP1.y,
    geom.topLeftCP2.x, geom.topLeftCP2.y,
    geom.topLeft.x, geom.topLeft.y
  );
  // Top edge
  ctx.lineTo(geom.topRight.x, geom.topRight.y);
  // Top-right corner
  ctx.curveTo(
    geom.topRightCP1.x, geom.topRightCP1.y,
    geom.topRightCP2.x, geom.topRightCP2.y,
    geom.rightBodyTop.x, geom.rightBodyTop.y
  );
  // Right vertical body edge
  ctx.lineTo(geom.rightBodyBottom.x, geom.rightBodyBottom.y);
  // Right foot flare
  ctx.curveTo(
    geom.rightFootCP1.x, geom.rightFootCP1.y,
    geom.rightFootCP2.x, geom.rightFootCP2.y,
    geom.rightFootTip.x, geom.rightFootTip.y
  );
}

const DrawingAreaBase = St?.DrawingArea || St?.Widget || class {};

export const AttachedDockCanvas = GObject.registerClass(
  {},
  class AttachedDockCanvas extends DrawingAreaBase {
    constructor(...args) {
      super(...args);
      if (!this._initialized && typeof this._init === 'function') {
        this._init(...args);
      }
    }

    _init(params) {
      this._initialized = true;
      if (typeof super._init === 'function') {
        super._init({
          reactive: false,
          ...(params || {}),
        });
      } else {
        this.reactive = false;
        if (params) Object.assign(this, params);
      }
      this.state = null;
    }

    set_position(x, y) {
      if (typeof super.set_position === 'function') {
        super.set_position(x, y);
      } else {
        this.x = x;
        this.y = y;
      }
    }

    set_size(w, h) {
      if (typeof super.set_size === 'function') {
        super.set_size(w, h);
      } else {
        this.width = w;
        this.height = h;
      }
    }

    queue_repaint() {
      if (typeof super.queue_repaint === 'function') {
        super.queue_repaint();
      } else {
        this.repaints = (this.repaints || 0) + 1;
      }
    }

    set_state(s) {
      const prev = this.state;
      if (
        !prev ||
        prev.width !== s.width ||
        prev.height !== s.height ||
        prev.position !== s.position ||
        prev.flareWidth !== s.flareWidth ||
        prev.footDepth !== s.footDepth ||
        prev.cornerRadius !== s.cornerRadius ||
        prev.scaleFactor !== s.scaleFactor ||
        prev.borderThickness !== s.borderThickness ||
        !this._colorEqual(prev.backgroundColor, s.backgroundColor) ||
        !this._colorEqual(prev.borderColor, s.borderColor)
      ) {
        this.state = s;
        this.queue_repaint();
      }
    }

    _colorEqual(c1, c2) {
      if (c1 === c2) return true;
      if (!c1 || !c2) return false;
      return (
        c1[0] === c2[0] &&
        c1[1] === c2[1] &&
        c1[2] === c2[2] &&
        c1[3] === c2[3]
      );
    }

    vfunc_repaint() {
      let ctx = this.get_context();
      let [surfaceWidth, surfaceHeight] = this.get_surface_size();

      if (!this.state || surfaceWidth <= 0 || surfaceHeight <= 0) {
        ctx.$dispose();
        return;
      }

      ctx.setOperator(Cairo.Operator.CLEAR);
      ctx.paint();

      ctx.setOperator(Cairo.Operator.OVER);

      const geom = getAttachedEdgeGeometry({
        width: surfaceWidth,
        height: surfaceHeight,
        flareWidth: this.state.flareWidth,
        footDepth: this.state.footDepth,
        cornerRadius: this.state.cornerRadius,
        scaleFactor: this.state.scaleFactor,
        position: this.state.position || 'bottom',
      });

      // Subtle ambient shadow along the contour
      ctx.save();
      buildAttachedContourPath(ctx, geom);
      ctx.setLineCap(Cairo.LineCap.ROUND);
      ctx.setLineJoin(Cairo.LineJoin.ROUND);

      ctx.setSourceRGBA(0, 0, 0, 0.04);
      ctx.setLineWidth(8 * geom.scaleFactor);
      ctx.strokePreserve();

      ctx.setSourceRGBA(0, 0, 0, 0.08);
      ctx.setLineWidth(4 * geom.scaleFactor);
      ctx.strokePreserve();

      ctx.setSourceRGBA(0, 0, 0, 0.12);
      ctx.setLineWidth(2 * geom.scaleFactor);
      ctx.stroke();
      ctx.restore();

      // Main background fill
      const bg = this.state.backgroundColor || [0.08, 0.08, 0.09, 0.72];
      ctx.save();
      buildAttachedFillPath(ctx, geom);
      ctx.setSourceRGBA(bg[0], bg[1], bg[2], bg[3] ?? 1.0);
      ctx.fill();
      ctx.restore();

      // Border outline if configured
      const bt = this.state.borderThickness || 0;
      if (bt > 0) {
        const bc = this.state.borderColor || [1, 1, 1, 0.25];
        ctx.save();
        buildAttachedContourPath(ctx, geom);
        ctx.setLineCap(Cairo.LineCap.ROUND);
        ctx.setLineJoin(Cairo.LineJoin.ROUND);
        ctx.setSourceRGBA(bc[0], bc[1], bc[2], bc[3] ?? 1.0);
        ctx.setLineWidth(bt * geom.scaleFactor);
        ctx.stroke();
        ctx.restore();
      }

      ctx.$dispose();
    }
  }
);
