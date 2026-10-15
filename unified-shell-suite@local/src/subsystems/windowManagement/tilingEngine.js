/**
 * Unified Shell Suite - TilingEngine
 * Clean, lightweight, native adaptive snap tiling for GNOME 51.
 * Uses WeakMap for state tracking and eliminates copy-pasted altTab code.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { getWindowData, updateWindowData } from '../../core/windowTracker.js';

export class TilingEngine {
    constructor(settings, patchManager, gapEngine) {
        this._settings = settings;
        this._patchManager = patchManager;
        this._gapEngine = gapEngine;

        this._preview = null;
        this._draggedWindow = null;
        this._currentSnapZone = null;
        this._motionId = 0;
    }

    enable() {
        const display = global.display;

        // Monitor grab operation begin/end
        this._patchManager.connectSignal(
            display,
            'grab-op-begin',
            (disp, window, op) => this._onGrabOpBegin(window, op)
        );

        this._patchManager.connectSignal(
            display,
            'grab-op-end',
            (disp, window, op) => this._onGrabOpEnd(window, op)
        );
    }

    disable() {
        this._hidePreview();
        this._draggedWindow = null;
        this._currentSnapZone = null;
    }

    _ensurePreview() {
        if (!this._preview) {
            this._preview = new St.Widget({
                style_class: 'unified-tiling-preview',
                style: 'background-color: rgba(53, 132, 228, 0.25); border: 2px solid rgba(53, 132, 228, 0.8); border-radius: 8px;',
                reactive: false,
                visible: false,
            });
            Main.uiGroup.insert_child_above(this._preview, global.window_group);
        }
    }

    _showPreview(rect) {
        this._ensurePreview();
        this._preview.set_position(rect.x, rect.y);
        this._preview.set_size(rect.width, rect.height);
        this._preview.show();
    }

    _hidePreview() {
        if (this._preview) {
            this._preview.hide();
        }
    }

    _isMovingWindow(op) {
        // Meta.GrabOp.MOVING or related window move operations
        return (op & Meta.GrabOp.WINDOW_BASE) !== 0 && (op & Meta.GrabOp.KEYBOARD_OP) === 0;
    }

    _onGrabOpBegin(window, op) {
        if (!window || !this._isMovingWindow(op)) return;

        this._draggedWindow = window;
        this._currentSnapZone = null;

        // Track cursor motion during drag
        if (!this._motionId) {
            this._motionId = global.stage.connect('captured-event', (_, event) => {
                if (event.type() === Clutter.EventType.MOTION && this._draggedWindow) {
                    const [stageX, stageY] = event.get_coords();
                    this._onPointerMotion(stageX, stageY);
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }
    }

    _onGrabOpEnd(window, op) {
        if (this._motionId) {
            global.stage.disconnect(this._motionId);
            this._motionId = 0;
        }

        const targetZone = this._currentSnapZone;
        const targetWindow = this._draggedWindow;
        this._hidePreview();
        this._draggedWindow = null;
        this._currentSnapZone = null;

        if (targetWindow && targetZone && targetZone.rect) {
            const rect = targetZone.rect;
            try {
                // If window was maximized, unmaximize first
                if (targetWindow.get_maximized()) {
                    targetWindow.unmaximize(Meta.MaximizeFlags.BOTH);
                }

                targetWindow.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
                updateWindowData(targetWindow, {
                    isTiled: true,
                    tiledRect: rect,
                });
            } catch (e) {
                console.warn('[TilingEngine] Failed to tile window:', e);
            }
        }
    }

    _onPointerMotion(pointerX, pointerY) {
        if (!this._draggedWindow) return;

        const monitorIndex = global.display.get_monitor_index_for_rect(
            new Meta.Rectangle({ x: pointerX, y: pointerY, width: 1, height: 1 })
        );
        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor) return;

        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIndex);
        const threshold = 24;

        let zone = null;
        const isLeft = pointerX <= workArea.x + threshold;
        const isRight = pointerX >= workArea.x + workArea.width - threshold;
        const isTop = pointerY <= workArea.y + threshold;
        const isBottom = pointerY >= workArea.y + workArea.height - threshold;

        const halfWidth = Math.floor(workArea.width / 2);
        const halfHeight = Math.floor(workArea.height / 2);

        if (isLeft && isTop) {
            // Top-left quarter
            const raw = { x: workArea.x, y: workArea.y, width: halfWidth, height: halfHeight };
            zone = { type: 'top-left', rect: this._gapEngine.applyGaps(raw, { isLeft: true, isTop: true }) };
        } else if (isLeft && isBottom) {
            // Bottom-left quarter
            const raw = { x: workArea.x, y: workArea.y + halfHeight, width: halfWidth, height: halfHeight };
            zone = { type: 'bottom-left', rect: this._gapEngine.applyGaps(raw, { isLeft: true, isBottom: true }) };
        } else if (isRight && isTop) {
            // Top-right quarter
            const raw = { x: workArea.x + halfWidth, y: workArea.y, width: halfWidth, height: halfHeight };
            zone = { type: 'top-right', rect: this._gapEngine.applyGaps(raw, { isRight: true, isTop: true }) };
        } else if (isRight && isBottom) {
            // Bottom-right quarter
            const raw = { x: workArea.x + halfWidth, y: workArea.y + halfHeight, width: halfWidth, height: halfHeight };
            zone = { type: 'bottom-right', rect: this._gapEngine.applyGaps(raw, { isRight: true, isBottom: true }) };
        } else if (isLeft) {
            // Left half
            const raw = { x: workArea.x, y: workArea.y, width: halfWidth, height: workArea.height };
            zone = { type: 'left', rect: this._gapEngine.applyGaps(raw, { isLeft: true, isTop: true, isBottom: true }) };
        } else if (isRight) {
            // Right half
            const raw = { x: workArea.x + halfWidth, y: workArea.y, width: halfWidth, height: workArea.height };
            zone = { type: 'right', rect: this._gapEngine.applyGaps(raw, { isRight: true, isTop: true, isBottom: true }) };
        } else if (isTop) {
            // Maximize / full tile
            const raw = { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height };
            zone = { type: 'maximize', rect: this._gapEngine.applyGaps(raw, { isLeft: true, isRight: true, isTop: true, isBottom: true }) };
        }

        this._currentSnapZone = zone;

        if (zone && this._settings.get_boolean('tiling-preview')) {
            this._showPreview(zone.rect);
        } else {
            this._hidePreview();
        }
    }
}

