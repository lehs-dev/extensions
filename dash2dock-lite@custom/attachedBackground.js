'use strict';

import GObject from 'gi://GObject';
import St from 'gi://St';
import Cairo from 'gi://cairo';

import {getAttachedEdgeGeometry} from './attachedGeometry.js';
export {KAPPA, getAttachedEdgeGeometry} from './attachedGeometry.js';

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
    _init(params = {}) {
      super._init({reactive: false});
      this.reactive = false;
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
        prev.alignEnd !== s.alignEnd ||
        prev.flareWidth !== s.flareWidth ||
        prev.footDepth !== s.footDepth ||
        prev.cornerRadius !== s.cornerRadius ||
        prev.scaleFactor !== s.scaleFactor ||
        prev.bodyOffset !== s.bodyOffset ||
        prev.startFlush !== s.startFlush ||
        prev.endFlush !== s.endFlush ||
        prev.elevationProgress !== s.elevationProgress ||
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
        width: this.state.bodyOffset !== undefined ? this.state.width : surfaceWidth,
        height: this.state.bodyOffset !== undefined ? this.state.height : surfaceHeight,
        flareWidth: this.state.flareWidth,
        footDepth: this.state.footDepth,
        cornerRadius: this.state.cornerRadius,
        scaleFactor: this.state.scaleFactor,
        position: this.state.position || 'bottom',
        bodyOffset: this.state.bodyOffset,
        startFlush: this.state.startFlush,
        endFlush: this.state.endFlush,
      });

      if (this.state.alignEnd) ctx.translate(surfaceWidth - geom.width, surfaceHeight - geom.height);

      // Subtle ambient shadow along the contour
      ctx.save();
      buildAttachedContourPath(ctx, geom);
      ctx.setLineCap(Cairo.LineCap.ROUND);
      ctx.setLineJoin(Cairo.LineJoin.ROUND);

      const elevation = this.state.elevationProgress || 0;
      ctx.setSourceRGBA(0, 0, 0, 0.04 + 0.025 * elevation);
      ctx.setLineWidth(8 * geom.scaleFactor);
      ctx.strokePreserve();

      ctx.setSourceRGBA(0, 0, 0, 0.08 + 0.03 * elevation);
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
