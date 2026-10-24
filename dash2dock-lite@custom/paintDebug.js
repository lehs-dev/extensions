'use strict';

import GLib from 'gi://GLib';

/**
 * Diagnostic logger for Clutter / St actors.
 * Logs visibility, mapped state, opacity, raw and transformed geometry,
 * parent hierarchy, and monitor information.
 *
 * Runs an immediate log and schedules a one-shot GLib idle callback
 * to log the state after GNOME Shell has completed layout and allocation passes.
 *
 * @param {string} tag Descriptive name of the actor
 * @param {Clutter.Actor} actor Actor to inspect
 * @param {Object} [monitor] Associated monitor rectangle
 */
export function logActorPaintDebug(tag, actor, monitor = null) {
  if (!actor) {
    console.log(`[D2DL-PAINT-DEBUG] ${tag}: <NULL ACTOR>`);
    return;
  }

  const printState = (phase) => {
    try {
      if (typeof actor.is_destroyed === 'function' && actor.is_destroyed()) {
        console.log(`[D2DL-PAINT-DEBUG] ${tag} (${phase}): ACTOR DESTROYED`);
        return;
      }

      const visible = actor.visible;
      const mapped = typeof actor.is_mapped === 'function' ? actor.is_mapped() : actor.mapped;
      const opacity = actor.opacity;
      const [tx, ty] = typeof actor.get_transformed_position === 'function'
        ? actor.get_transformed_position()
        : [actor.x, actor.y];
      const [tw, th] = typeof actor.get_transformed_size === 'function'
        ? actor.get_transformed_size()
        : [actor.width, actor.height];
      const parent = actor.get_parent
        ? actor.get_parent()?.constructor?.name || actor.get_parent()?.name || 'none'
        : 'unknown';
      const mStr = monitor
        ? `mon=[x=${monitor.x}, y=${monitor.y}, ${monitor.width}x${monitor.height}, scale=${monitor.geometry_scale || 1.0}, fs=${!!monitor.inFullscreen}]`
        : 'no-mon';

      console.log(
        `[D2DL-PAINT-DEBUG] ${tag} (${phase}) | visible=${visible} mapped=${mapped} opacity=${opacity} | geom=[x=${actor.x}, y=${actor.y}, w=${actor.width}, h=${actor.height}] | transformed=[x=${tx}, y=${ty}, w=${tw}, h=${th}] | parent=${parent} | ${mStr}`
      );
    } catch (err) {
      console.error(`[D2DL-PAINT-DEBUG] ${tag} (${phase}) error:`, err);
    }
  };

  // Immediate log
  printState('initial');

  // One-shot post-allocation idle log
  try {
    if (GLib && typeof GLib.idle_add === 'function') {
      GLib.idle_add(GLib.PRIORITY_LOW, () => {
        printState('post-allocation');
        return GLib.SOURCE_REMOVE;
      });
    }
  } catch (e) {}
}

