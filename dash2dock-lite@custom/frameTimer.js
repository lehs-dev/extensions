import Clutter from 'gi://Clutter';
import { Timer } from './timer.js';

// Share Mutter's frame clock for magnification, autohide and bounce instead
// of scheduling a competing 15 ms GLib timeout.
export class FrameTimer extends Timer {
  constructor(name, actor) {
    super(name);
    this._actor = actor;
    this._frameDriven = true;
  }

  start(resolution) {
    if (this.is_running()) return;
    this._resolution = resolution || this._resolution || 15;
    this._time = 0;
    const timeline = new Clutter.Timeline({
      actor: this._actor,
      duration: 1000,
      repeat_count: -1,
    });
    this._timeoutId = timeline;
    this._frameId = timeline.connect('new-frame', () => {
      // Avoid a large position jump after a suspended compositor resumes.
      const delta = timeline.get_delta();
      if (Number.isFinite(delta) && delta > 0)
        this.onUpdate(Math.min(delta, 64));
    });
    this._hibernating = false;
    timeline.start();
    this.onStart();
  }

  stop() {
    const timeline = this._timeoutId;
    if (!timeline) return;
    this._timeoutId = null;
    timeline.disconnect(this._frameId);
    this._frameId = null;
    timeline.stop();
    this.onStop();
  }
}
