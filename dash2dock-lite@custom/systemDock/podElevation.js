'use strict';

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {unifiedAppearance} from '../unifiedDock.js';

/** One normalized progress value for content, contour, connector and shadow.
 * Timelines exist only while entering/leaving; state providers never poll.
 */
export class PodElevation {
  constructor(actor, onProgress) {
    this.actor = actor;
    this.onProgress = onProgress;
    this.progress = 0;
    this.target = 0;
    this.distance = 3;
    this.duration = 210;
    this.enabled = true;
  }

  get reducedMotion() {
    const settings = St.Settings?.get();
    return (St.ReducedMotion && (settings?.reduced_motion ?? settings?.reducedMotion) === St.ReducedMotion.REDUCE) ||
      settings?.enable_animations === false;
  }

  configure(extension) {
    this.enabled = extension?.modular_group_elevation !== false;
    this.distance = Math.max(0, Math.min(16, extension?.modular_elevation_distance ?? 3)) * unifiedAppearance(extension).scale;
    this.duration = Math.max(0, Math.min(600, extension?.modular_animation_duration ?? 210));
  }

  setActive(active, immediate = false) {
    const target = active && this.enabled ? 1 : 0;
    if (target === this.target && !immediate && !this.reducedMotion) return;
    this._stop();
    this.target = target;
    if (immediate || this.reducedMotion || this.duration === 0 || this.progress === target) {
      this._setProgress(target);
      return;
    }
    const from = this.progress;
    // Reversals start at the current value. A partial return takes only the
    // remaining fraction of the duration, without a jump or oscillation.
    const duration = Math.max(1, Math.round((this.duration + (target ? 0 : 30)) * Math.abs(target - from)));
    const timeline = new Clutter.Timeline({actor: this.actor, duration});
    this._timeline = timeline;
    timeline.set_progress_mode(Clutter.AnimationMode.EASE_OUT_CUBIC);
    this._frameSignal = timeline.connect('new-frame', () =>
      this._setProgress(from + (target - from) * timeline.get_progress()));
    this._completeSignal = timeline.connect('completed', () => {
      this._stop();
      this._setProgress(target);
    });
    timeline.start();
  }

  _setProgress(value) {
    this.progress = Math.max(0, Math.min(1, value));
    this.onProgress(this.progress, this.distance * this.progress);
  }

  _stop() {
    const timeline = this._timeline;
    if (!timeline) return;
    this._timeline = null;
    timeline.disconnect(this._frameSignal);
    timeline.disconnect(this._completeSignal);
    timeline.stop();
  }

  destroy() {
    this._stop();
    this.actor = this.onProgress = null;
  }
}
