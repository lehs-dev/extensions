'use strict';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Convert a desired physical-monitor inset to an additional work-area margin.
 * Existing panel/dock struts already consume space and must not be added twice.
 */
export function computeWindowOuterGaps({monitor, workArea = monitor, frameThickness = 0, outerGap = 8}) {
  const inset = Math.max(0, frameThickness) + Math.max(0, outerGap);
  const consumed = {
    top: workArea.y - monitor.y,
    left: workArea.x - monitor.x,
    right: monitor.x + monitor.width - workArea.x - workArea.width,
    bottom: monitor.y + monitor.height - workArea.y - workArea.height,
  };
  return Object.fromEntries(Object.entries(consumed).map(([edge, amount]) =>
    [edge, Math.max(0, inset - Math.max(0, amount))]));
}

/** Live, optional contract consumed by Tiling Assistant. This object never
 * writes another extension's settings and never moves a window. Tile, preview,
 * and resize consult the same provider; removing it restores TA's saved gaps.
 */
export class WindowGapCoordinator {
  constructor({extension} = {}) {
    this.extension = extension;
    this._enabled = false;
  }

  enable() {
    this._enabled = true;
  }

  getScreenGaps(monitorIndex, workArea) {
    if (!this._enabled || !this.extension?.enable_window_outer_gap ||
        this.extension.desktopLayoutManager?.mode !== 1) return null;
    const layout = Main.layoutManager;
    const monitor = layout.monitors[monitorIndex];
    if (!monitor) return null;
    if (!(this.extension.screen_frame_all_monitors ?? true) && monitorIndex !== layout.primaryIndex)
      return null;
    const frameThickness = this.extension.enable_screen_frame
      ? (this.extension.screen_frame_thickness ?? 6) : 0;
    return computeWindowOuterGaps({monitor, workArea: workArea ?? monitor,
      frameThickness, outerGap: this.extension.window_outer_gap_size ?? 8});
  }

  // Settings are read on each geometry request, so updates require no persistent
  // override, GSource, subscription, or polling loop.
  updateGaps() {}

  destroy() {
    this._enabled = false;
    this.extension = null;
  }
}
