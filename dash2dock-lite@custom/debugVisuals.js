'use strict';

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { logActorPaintDebug } from './paintDebug.js';

/**
 * Visual Smoke Test Component.
 *
 * Renders independent, bright magenta debug markers to verify whether
 * GNOME Shell chrome actor registration, layout, allocation, and painting
 * are functioning on the host Wayland session:
 * 1. 40x120 logical px bright magenta rectangle, 80px left of the primary monitor's
 *    right edge, vertically centered.
 * 2. 6px solid magenta line spanning the full width of the primary monitor's top edge.
 */
export class DebugVisuals {
  constructor({ extension } = {}) {
    this.extension = extension;
    this._enabled = false;
    this._rect = null;
    this._line = null;
  }

  getMonitor() {
    return (
      Main.layoutManager?.primaryMonitor || {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        geometry_scale: 1.0,
      }
    );
  }

  enable() {
    if (this._enabled) return;
    this._enabled = true;

    const monitor = this.getMonitor();
    const scale = monitor.geometry_scale || 1.0;

    // 1. Bright magenta rectangle: 40x120 logical px, 80px left of right edge, vertically centered
    const rectW = Math.round(40 * scale);
    const rectH = Math.round(120 * scale);
    const rectX = monitor.x + monitor.width - Math.round(80 * scale) - rectW;
    const rectY = monitor.y + Math.round((monitor.height - rectH) / 2);

    this._rect = new St.Widget({
      name: 'D2DDebugMagentaBox',
      style_class: 'd2d-debug-magenta-box',
      reactive: false,
      track_hover: false,
      can_focus: false,
      style: 'background-color: #ff00ff; border: 2px solid #ffffff;',
    });

    this._rect.x = rectX;
    this._rect.y = rectY;
    this._rect.width = rectW;
    this._rect.height = rectH;
    if (typeof this._rect.set_position === 'function') {
      this._rect.set_position(rectX, rectY);
    }
    if (typeof this._rect.set_size === 'function') {
      this._rect.set_size(rectW, rectH);
    }
    this._rect.opacity = 255;
    this._rect.visible = true;
    if (typeof this._rect.show === 'function') {
      this._rect.show();
    }

    // 2. 6px solid magenta line at top edge of primary monitor
    const lineH = Math.max(1, Math.round(6 * scale));
    this._line = new St.Widget({
      name: 'D2DDebugMagentaTopLine',
      style_class: 'd2d-debug-magenta-top-line',
      reactive: false,
      track_hover: false,
      can_focus: false,
      style: 'background-color: #ff00ff; border: none;',
    });

    this._line.x = monitor.x;
    this._line.y = monitor.y;
    this._line.width = monitor.width;
    this._line.height = lineH;
    if (typeof this._line.set_position === 'function') {
      this._line.set_position(monitor.x, monitor.y);
    }
    if (typeof this._line.set_size === 'function') {
      this._line.set_size(monitor.width, lineH);
    }
    this._line.opacity = 255;
    this._line.visible = true;
    if (typeof this._line.show === 'function') {
      this._line.show();
    }

    // Add both to Chrome
    if (Main.layoutManager?.addChrome) {
      Main.layoutManager.addChrome(this._rect, {
        affectsStruts: false,
        trackFullscreen: true,
      });
      Main.layoutManager.addChrome(this._line, {
        affectsStruts: false,
        trackFullscreen: true,
      });
    }

    logActorPaintDebug('DebugMagentaBox', this._rect, monitor);
    logActorPaintDebug('DebugMagentaTopLine', this._line, monitor);

    console.log('[D2DL-PAINT-DEBUG] Visual Smoke Test enabled: Magenta Box and Top Line registered');
  }

  destroy() {
    this._enabled = false;

    if (this._rect) {
      if (Main.layoutManager?.removeChrome) {
        try {
          Main.layoutManager.removeChrome(this._rect);
        } catch (e) {}
      }
      try {
        this._rect.destroy();
      } catch (e) {}
      this._rect = null;
    }

    if (this._line) {
      if (Main.layoutManager?.removeChrome) {
        try {
          Main.layoutManager.removeChrome(this._line);
        } catch (e) {}
      }
      try {
        this._line.destroy();
      } catch (e) {}
      this._line = null;
    }

    console.log('[D2DL-PAINT-DEBUG] Visual Smoke Test disabled: markers cleaned up');
  }
}

