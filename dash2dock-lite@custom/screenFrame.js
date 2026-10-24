'use strict';

import St from 'gi://St';
import Cairo from 'gi://cairo';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const shellGlobal = typeof global !== 'undefined' ? global : null;
const nonnegative = value => Number.isFinite(value) ? Math.max(0, value) : 0;

/** Monitor rectangles, Cairo paths and settings all use stage coordinates.
 * St.DrawingArea scales its backing surface itself; geometry_scale is never
 * multiplied into a stage rectangle for a second time.
 * cornerRadius is the OUTER radius. The opening has radius max(0, r - t).
 * The edge/corner partition is also useful to consumers that need the insets.
 */
export function computeScreenFrameGeometries({monitor = {}, thickness = 6, cornerRadius = 0} = {}) {
  const x = Number.isFinite(monitor.x) ? monitor.x : 0;
  const y = Number.isFinite(monitor.y) ? monitor.y : 0;
  const width = nonnegative(monitor.width);
  const height = nonnegative(monitor.height);
  const t = Math.min(nonnegative(thickness), width / 2, height / 2);
  const r = Math.min(nonnegative(cornerRadius), width / 2, height / 2);
  const c = Math.max(t, r);
  const rect = (rx, ry, rw, rh) => ({x: rx, y: ry, width: rw, height: rh});
  const rounded = t > 0 && r > 0;
  return {
    thickness: t, cornerRadius: r, innerRadius: Math.max(0, r - t), cornerSize: c,
    outer: rect(x, y, width, height),
    inner: rect(x + t, y + t, Math.max(0, width - 2 * t), Math.max(0, height - 2 * t)),
    top: rect(x + (rounded ? c : 0), y, t > 0 ? Math.max(0, width - (rounded ? 2 * c : 0)) : 0, t),
    bottom: rect(x + (rounded ? c : 0), y + height - t, t > 0 ? Math.max(0, width - (rounded ? 2 * c : 0)) : 0, t),
    left: rect(x, y + c, t, Math.max(0, height - 2 * c)),
    right: rect(x + width - t, y + c, t, Math.max(0, height - 2 * c)),
    topLeft: rounded ? rect(x, y, c, c) : null,
    topRight: rounded ? rect(x + width - c, y, c, c) : null,
    bottomLeft: rounded ? rect(x, y + height - c, c, c) : null,
    bottomRight: rounded ? rect(x + width - c, y + height - c, c, c) : null,
  };
}

export const computeScreenFrameEdgeGeometries = computeScreenFrameGeometries;

/** A closed cubic rounded rectangle, shared by both ring contours. */
export function appendRoundedRectangle(cr, x, y, width, height, radius) {
  const r = Math.min(nonnegative(radius), width / 2, height / 2);
  const k = 0.5522847498307936;
  cr.moveTo(x + r, y);
  cr.lineTo(x + width - r, y);
  cr.curveTo(x + width - r + k * r, y, x + width, y + r - k * r, x + width, y + r);
  cr.lineTo(x + width, y + height - r);
  cr.curveTo(x + width, y + height - r + k * r, x + width - r + k * r, y + height, x + width - r, y + height);
  cr.lineTo(x + r, y + height);
  cr.curveTo(x + r - k * r, y + height, x, y + height - r + k * r, x, y + height - r);
  cr.lineTo(x, y + r);
  cr.curveTo(x, y + r - k * r, x + r - k * r, y, x + r, y);
  cr.closePath();
}

/** One non-reactive, unstretched Cairo ring per monitor. A single fill avoids
 * alpha accumulation and antialiased seams where independently painted edges
 * used to meet. The transparent opening never participates in input picking.
 */
export class ScreenFrame {
  constructor({extension} = {}) {
    this.extension = extension;
    this._enabled = false;
    this._actors = [];
    this._signals = [];
  }

  _getMonitors() {
    const layout = Main.layoutManager;
    return this.extension?.screen_frame_all_monitors ?? true
      ? layout.monitors
      : layout.primaryMonitor ? [layout.primaryMonitor] : [];
  }

  enable() {
    if (this._enabled) return;
    this._enabled = true;
    const connect = (object, signal, callback) => {
      if (object?.connect) this._signals.push({object, id: object.connect(signal, callback)});
    };
    try {
      connect(Main.layoutManager, 'monitors-changed', () => this.updateLayout());
      connect(shellGlobal?.display, 'in-fullscreen-changed', () => this._checkFullscreen());
      connect(Main.overview, 'showing', () => this._checkFullscreen(true));
      connect(Main.overview, 'hidden', () => this._checkFullscreen(false));
      this.updateLayout();
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  _getFrameColorRGBA() {
    const color = this.extension?.screen_frame_color ?? [0.025, 0.025, 0.03, 1];
    const opacity = this.extension?.screen_frame_opacity ?? 0.95;
    return [0, 1, 2].map(i => Math.max(0, Math.min(1, color[i] ?? 0)))
      .concat(Math.max(0, Math.min(1, (color[3] ?? 1) * opacity)));
  }

  _geometry(monitor) {
    return computeScreenFrameGeometries({monitor,
      thickness: this.extension?.screen_frame_thickness ?? 6,
      cornerRadius: this.extension?.screen_frame_corner_radius ?? 12});
  }

  _paint(actor) {
    const cr = actor.get_context();
    try {
      const [width, height] = actor.get_surface_size();
      const {thickness: t, cornerRadius: r, innerRadius} = actor.frameGeometry;
      cr.setOperator(Cairo.Operator.CLEAR);
      cr.paint();
      cr.setOperator(Cairo.Operator.OVER);
      cr.newPath();
      appendRoundedRectangle(cr, 0, 0, width, height, r);
      if (width > 2 * t && height > 2 * t)
        appendRoundedRectangle(cr, t, t, width - 2 * t, height - 2 * t, innerRadius);
      cr.setFillRule(Cairo.FillRule.EVEN_ODD);
      cr.setSourceRGBA(...this._getFrameColorRGBA());
      cr.fill();
    } finally {
      cr.$dispose();
    }
  }

  updateLayout() {
    if (!this._enabled) return;
    this._clearActors();
    try {
      for (const monitor of this._getMonitors()) {
        const geometry = this._geometry(monitor);
        if (!geometry.thickness) continue;
        const actor = new St.DrawingArea({name: 'DesktopScreenFrame',
          reactive: false, track_hover: false, can_focus: false});
        actor.monitorIndex = monitor.index ?? Main.layoutManager.monitors.indexOf(monitor);
        actor.frameGeometry = geometry;
        actor.set_position(monitor.x, monitor.y);
        actor.set_size(monitor.width, monitor.height);
        actor.connect('repaint', () => this._paint(actor));
        this._actors.push(actor);
        Main.layoutManager.addChrome(actor, {affectsStruts: false, trackFullscreen: false});
        // Above application windows, below docks, overview, and native menus.
        const parent = actor.get_parent();
        if (shellGlobal?.window_group?.get_parent?.() === parent)
          parent.set_child_above_sibling(actor, shellGlobal.window_group);
        actor.queue_repaint();
      }
      this._checkFullscreen();
    } catch (error) {
      this._clearActors();
      throw error;
    }
  }

  updateStyle() {
    for (const actor of this._actors) actor.queue_repaint();
  }

  _checkFullscreen(overviewVisible = Main.overview?.visible ?? false) {
    for (const actor of this._actors) {
      const monitor = Main.layoutManager.monitors[actor.monitorIndex];
      actor.visible = !overviewVisible && !(monitor?.inFullscreen ?? false);
    }
  }

  onSettingsChanged(key) {
    if (key === 'screen-frame-color' || key === 'screen-frame-opacity') this.updateStyle();
    else this.updateLayout();
  }

  _clearActors() {
    for (const actor of this._actors) {
      if (actor.get_parent()) Main.layoutManager.removeChrome(actor);
      actor.destroy();
    }
    this._actors = [];
  }

  destroy() {
    this._enabled = false;
    for (const {object, id} of this._signals) object.disconnect(id);
    this._signals = [];
    this._clearActors();
  }
}
