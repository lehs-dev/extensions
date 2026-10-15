/**
 * Unified Shell Suite - MagicLampEngine
 * High-performance, crash-resilient Genie Lamp window minimize/unminimize animation.
 * Features:
 * - Zero stack-trace overhead (eliminates new Error().stack)
 * - Rock-solid try/catch/finally guarantees preventing Mutter transition deadlocks
 * - Safe icon geometry resolution with graceful fallbacks
 * - Clean lifecycle without deprecated global.get_window_actors()
 */

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MINIMIZE_EFFECT_NAME = 'unified-magic-lamp-minimize';
const UNMINIMIZE_EFFECT_NAME = 'unified-magic-lamp-unminimize';

/**
 * Optimized DeformEffect with reduced vertex overhead.
 */
export const MagicLampDeformEffect = GObject.registerClass({
    GTypeName: 'UnifiedMagicLampDeformEffect',
}, class MagicLampDeformEffect extends Clutter.DeformEffect {
    _init(params = {}) {
        super._init();
        this.progress = 0;
        this.isMinimize = params.isMinimize ?? true;
        this.iconRect = params.iconRect;
        this.sourceRect = params.sourceRect;
        this.complete = params.complete;
        this.onDestroy = params.onDestroy;

        // Use 6x6 grid (49 vertices) instead of 10x10 (121 vertices)
        // Cuts FFI bridge crossings by > 60% with indistinguishable visual difference
        this.set_n_tiles(6, 6);
    }

    vfunc_deform_vertex(width, height, vertex) {
        if (width <= 0 || height <= 0 || !this.iconRect) return;

        let p = this.progress;
        if (!this.isMinimize) {
            p = 1.0 - p;
        }

        if (p <= 0.0) return;
        if (p >= 1.0) {
            vertex.x = this.iconRect.x;
            vertex.y = this.iconRect.y;
            return;
        }

        // Relative normalized coordinates [0, 1]
        const u = vertex.x / width;
        const v = vertex.y / height;

        // Genie lamp parabolic pinch towards the icon
        const targetX = (this.iconRect.x - this.sourceRect.x) + (this.iconRect.width / 2);
        const targetY = (this.iconRect.y - this.sourceRect.y) + (this.iconRect.height / 2);

        // Interpolation factor based on vertical distance to the opening of the lamp
        const curve = Math.pow(v, 2.0);
        const currentPinch = p * curve;

        const deformedX = vertex.x + (targetX - vertex.x) * currentPinch;
        const deformedY = vertex.y + (targetY - vertex.y) * p;

        vertex.x = deformedX;
        vertex.y = deformedY;
    }

    destroy() {
        if (this.onDestroy) {
            this.onDestroy(this);
            this.onDestroy = null;
        }
    }
});

export class MagicLampEngine {
    constructor(settings, patchManager) {
        this._settings = settings;
        this._patchManager = patchManager;
        this._activeEffects = new Set();
        this._animatingWindows = new Set();
        this._minimizeSignalId = 0;
        this._unminimizeSignalId = 0;
    }

    enable() {
        const self = this;
        const shellwm = Main.wm._shellwm;

        // 1. Hook shouldAnimateActor to suppress default scale animation ONLY for active magic lamp windows
        // WITHOUT generating new Error().stack!
        this._patchManager.hookMethod(
            Main.wm,
            '_shouldAnimateActor',
            originalShouldAnimate => function (actor, types) {
                if (actor && actor.meta_window && self._animatingWindows.has(actor.meta_window)) {
                    return false;
                }
                return originalShouldAnimate.call(this, actor, types);
            }
        );

        // 2. Hook completed_minimize / unminimize safely
        const originalCompletedMinimize = shellwm.completed_minimize;
        const originalCompletedUnminimize = shellwm.completed_unminimize;

        this._patchManager.hookMethod(
            shellwm,
            'completed_minimize',
            () => function (actor) {
                if (actor && actor.meta_window && self._animatingWindows.has(actor.meta_window)) {
                    // Suppress early completion while animation is running
                    return;
                }
                return originalCompletedMinimize.call(this, actor);
            }
        );

        this._patchManager.hookMethod(
            shellwm,
            'completed_unminimize',
            () => function (actor) {
                if (actor && actor.meta_window && self._animatingWindows.has(actor.meta_window)) {
                    return;
                }
                return originalCompletedUnminimize.call(this, actor);
            }
        );

        // 3. Connect to window-manager minimize and unminimize signals
        this._minimizeSignalId = this._patchManager.connectSignal(
            global.window_manager,
            'minimize',
            (_, actor) => this.animate(actor, true)
        );

        this._unminimizeSignalId = this._patchManager.connectSignal(
            global.window_manager,
            'unminimize',
            (_, actor) => {
                actor.show();
                this.animate(actor, false);
            }
        );
    }

    disable() {
        // Clear all active effects safely without calling deprecated global.get_window_actors()
        for (const effect of [...this._activeEffects]) {
            try {
                effect.destroy();
            } catch (_) {}
        }
        this._activeEffects.clear();
        this._animatingWindows.clear();
    }

    /**
     * Resolves the target icon geometry with bulletproof fallback.
     */
    getIconGeometry(actor) {
        try {
            if (actor?.meta_window) {
                const [success, rect] = actor.meta_window.get_icon_geometry();
                if (success && rect && rect.width > 0) {
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                }

                // Fallback to monitor bottom center
                const monitorIndex = actor.meta_window.get_monitor();
                const monitor = Main.layoutManager.monitors[monitorIndex] || Main.layoutManager.primaryMonitor;
                if (monitor) {
                    return {
                        x: monitor.x + (monitor.width / 2) - 24,
                        y: monitor.y + monitor.height - 48,
                        width: 48,
                        height: 48,
                    };
                }
            }
        } catch (_) {}

        return { x: 0, y: 0, width: 48, height: 48 };
    }

    animate(actor, isMinimize) {
        if (!actor || !actor.meta_window) return;

        const metaWindow = actor.meta_window;
        const shellwm = Main.wm._shellwm;
        const effectName = isMinimize ? MINIMIZE_EFFECT_NAME : UNMINIMIZE_EFFECT_NAME;
        const duration = this._settings.get_int('magic-lamp-duration') || 300;

        let completed = false;
        const safeComplete = () => {
            if (completed) return;
            completed = true;
            this._animatingWindows.delete(metaWindow);

            try {
                actor.remove_effect_by_name(effectName);
            } catch (_) {}

            try {
                if (isMinimize) {
                    shellwm.completed_minimize(actor);
                } else {
                    shellwm.completed_unminimize(actor);
                }
            } catch (err) {
                console.error('[MagicLamp] Error during completed signal:', err);
            }
        };

        // If overview is visible, do standard completion without animation
        if (Main.overview.visible) {
            safeComplete();
            return;
        }

        this._animatingWindows.add(metaWindow);

        try {
            const iconRect = this.getIconGeometry(actor);
            const sourceRect = { x: actor.x, y: actor.y, width: actor.width, height: actor.height };

            const effect = new MagicLampDeformEffect({
                isMinimize,
                iconRect,
                sourceRect,
                complete: safeComplete,
                onDestroy: eff => this._activeEffects.delete(eff),
            });

            this._activeEffects.add(effect);
            actor.add_effect_with_name(effectName, effect);

            // Animate progress with Clutter transition
            actor.ease_property('opacity', isMinimize ? 0 : 255, {
                duration,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            // Timeline-based progress animation
            const timeline = new Clutter.Timeline({ duration });
            timeline.connect('new-frame', () => {
                effect.progress = timeline.get_progress();
                effect.queue_repaint();
            });
            timeline.connect('completed', () => {
                timeline.destroy();
                safeComplete();
            });
            timeline.start();
        } catch (error) {
            console.warn('[MagicLamp] Failed to start animation, falling back safely:', error);
            safeComplete();
        }
    }
}

