
/*
 * Compiz-alike-magic-lamp-effect for GNOME Shell
 *
 * Copyright (C) 2020
 *     Mauro Pepe <https://github.com/hermes83/compiz-alike-magic-lamp-effect>
 *
 * This file is part of the gnome-shell extension Compiz-alike-magic-lamp-effect.
 *
 * gnome-shell extension Compiz-alike-magic-lamp-effect is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * gnome-shell extension Compiz-alike-magic-lamp-effect is distributed in the hope that it
 * will be useful, but WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE.  See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with gnome-shell extension Compiz-alike-magic-lamp-effect.  If not, see
 * <http://www.gnu.org/licenses/>.
 */
'use strict';

import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SettingsData } from './settings_data.js';

const MINIMIZE_EFFECT_NAME = 'minimize-magic-lamp-effect';
const UNMINIMIZE_EFFECT_NAME = 'unminimize-magic-lamp-effect';
const clamp = value => Math.max(0, Math.min(1, value));
const smoothstep = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const mix = (from, to, progress) => from + (to - from) * progress;

// Icon geometry is optional on Wayland. Missing or stale geometry must never
// send a window to an arbitrary screen corner or an invisible Overview icon.
function iconTarget(icon, monitors = []) {
    if (!icon || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(icon[key])) ||
        icon.width <= 0 || icon.height <= 0)
        return null;
    const intersects = monitor => monitor && icon.x < monitor.x + monitor.width &&
        icon.x + icon.width > monitor.x && icon.y < monitor.y + monitor.height &&
        icon.y + icon.height > monitor.y;
    const monitor = (Number.isInteger(icon.monitorIndex) && intersects(monitors[icon.monitorIndex])
        ? monitors[icon.monitorIndex] : monitors.find(intersects));
    if (!monitor || icon.width > monitor.width || icon.height > monitor.height)
        return null;
    return {x: icon.x, y: icon.y, width: icon.width, height: icon.height,
        monitorIndex: monitors.indexOf(monitor), dockPosition: icon.dockPosition};
}

function funnelTarget(icon, side) {
    // A positive one-pixel aperture keeps the mesh valid while giving the
    // funnel a pointed tip instead of the icon's full-width, flat base.
    const size = Math.min(1, icon.width, icon.height);
    let x = icon.x + (icon.width - size) / 2;
    let y = icon.y + (icon.height - size) / 2;
    if (side === St.Side.BOTTOM)
        y = icon.y;
    else if (side === St.Side.TOP)
        y = icon.y + icon.height - size;
    else if (side === St.Side.RIGHT)
        x = icon.x;
    else if (side === St.Side.LEFT)
        x = icon.x + icon.width - size;
    return {x, y, width: size, height: size};
}

export default class CompizMagicLampEffectExtension extends Extension {

    enable() {
        this.settingsData = new SettingsData(this.getSettings());
        this._activeEffects = new Set();

        // https://github.com/GNOME/gnome-shell/blob/master/js/ui/windowManager.js

        const hooks = this._hooks = {
            enabled: true,
            shouldAnimate: Main.wm._shouldAnimateActor,
            minimize: Main.wm._shellwm.completed_minimize,
            unminimize: Main.wm._shellwm.completed_unminimize,
        };
        if (typeof hooks.shouldAnimate === 'function') {
            Main.wm.original_minimizeMaximizeWindow_shouldAnimateActor = hooks.shouldAnimate;
            hooks.shouldAnimateWrapper = function(actor, types) {
                if (hooks.enabled) {
                    let stack = new Error().stack;
                    if (stack && (stack.indexOf("_minimizeWindow") !== -1 || stack.indexOf("_unminimizeWindow") !== -1))
                        return false;
                }
                return hooks.shouldAnimate.call(this, actor, types);
            };
            Main.wm._shouldAnimateActor = hooks.shouldAnimateWrapper;
        }

        Main.wm._shellwm.original_completed_minimize = hooks.minimize;
        hooks.minimizeWrapper = function(actor) {
            if (!hooks.enabled)
                return hooks.minimize.call(this, actor);
        };
        Main.wm._shellwm.completed_minimize = hooks.minimizeWrapper;

        Main.wm._shellwm.original_completed_unminimize = hooks.unminimize;
        hooks.unminimizeWrapper = function(actor) {
            if (!hooks.enabled)
                return hooks.unminimize.call(this, actor);
        };
        Main.wm._shellwm.completed_unminimize = hooks.unminimizeWrapper;

        this.minimizeId = global.window_manager.connect("minimize", (e, actor) => {
            this.destroyActorEffect(actor);
            if (!this._shouldAnimate()) {
                hooks.minimize.call(Main.wm._shellwm, actor);
                return;
            }

            this.animate(actor, MagicLampMinimizeEffect, MINIMIZE_EFFECT_NAME);
        });

        this.unminimizeId = global.window_manager.connect("unminimize", (e, actor) => {
            this.destroyActorEffect(actor);
            actor.show();

            if (!this._shouldAnimate()) {
                hooks.unminimize.call(Main.wm._shellwm, actor);
                return;
            }

            this.animate(actor, MagicLampUnminimizeEffect, UNMINIMIZE_EFFECT_NAME);
        });
    }

    disable() {
        const hooks = this._hooks;
        if (hooks)
            hooks.enabled = false;
        if (this.settingsData) {
            this.settingsData = null;
        }
        if (this.minimizeId) {
            global.window_manager.disconnect(this.minimizeId);
            this.minimizeId = null;
        }
        if (this.unminimizeId) {
            global.window_manager.disconnect(this.unminimizeId);
            this.unminimizeId = null;
        }
    
        global.get_window_actors().forEach((actor) => {
            this.destroyActorEffect(actor);
        });
        for (const effect of [...this._activeEffects])
            effect.destroy();
        this._activeEffects.clear();
        
        if (hooks) {
            if (hooks.shouldAnimateWrapper && Main.wm._shouldAnimateActor === hooks.shouldAnimateWrapper)
                Main.wm._shouldAnimateActor = hooks.shouldAnimate;
            if (Main.wm._shellwm.completed_minimize === hooks.minimizeWrapper)
                Main.wm._shellwm.completed_minimize = hooks.minimize;
            if (Main.wm._shellwm.completed_unminimize === hooks.unminimizeWrapper)
                Main.wm._shellwm.completed_unminimize = hooks.unminimize;
            if (hooks.shouldAnimateWrapper && Main.wm.original_minimizeMaximizeWindow_shouldAnimateActor === hooks.shouldAnimate)
                Main.wm.original_minimizeMaximizeWindow_shouldAnimateActor = null;
            if (Main.wm._shellwm.original_completed_minimize === hooks.minimize)
                Main.wm._shellwm.original_completed_minimize = null;
            if (Main.wm._shellwm.original_completed_unminimize === hooks.unminimize)
                Main.wm._shellwm.original_completed_unminimize = null;
            this._hooks = null;
        }
    }

    _shouldAnimate() {
        const settings = St.Settings.get();
        return settings.enable_animations &&
            !(St.ReducedMotion && settings.reducedMotion === St.ReducedMotion.REDUCE) &&
            !Main.overview.visible && !Main.wm._workspaceAnimation?.gestureActive;
    }

    getIcon(actor) {
        const monitors = Main.layoutManager.monitors;
        // The live dock includes magnification and autohide; Meta's cached
        // geometry can describe the previous dock position.
        try {
            const d2d = Main.extensionManager?.lookup?.('dash2dock-lite@icedman.github.com');
            const target = iconTarget(d2d?.stateObj?.integrations?.compiz_getIcon?.(actor), monitors);
            if (target)
                return target;
        } catch (error) {
            console.warn(`[Magic Lamp] Dock target unavailable: ${error}`);
        }
        try {
            const metaWindow = actor?.meta_window || actor?.get_meta_window?.();
            const [success, icon] = metaWindow?.get_icon_geometry?.() || [false, null];
            return success ? iconTarget(icon, monitors) : null;
        } catch (error) {
            return null;
        }
    }

    animate(actor, EffectClass, name) {
        const complete = name === MINIMIZE_EFFECT_NAME ?
            this._hooks?.minimize || Main.wm._shellwm.original_completed_minimize :
            this._hooks?.unminimize || Main.wm._shellwm.original_completed_unminimize;
        const monitors = Main.layoutManager.monitors;
        let icon = null;
        try {
            icon = iconTarget(this.getIcon(actor), monitors);
        } catch (error) {
            console.warn(`[Magic Lamp] Icon target unavailable: ${error}`);
        }
        const windowMonitor = monitors[actor.meta_window.get_monitor()];
        const targetMonitor = icon ? monitors[icon.monitorIndex] : null;
        let animationActor = actor;
        let snapshot = null;
        let effect = null;
        const originalOpacity = actor.opacity;
        try {
            if (windowMonitor && targetMonitor && targetMonitor !== windowMonitor) {
                // Wayland surface actors belong to their original stage views.
                // A texture snapshot can deform across outputs without those
                // per-monitor surface visibility constraints.
                // Capture the full actor so clipping does not crop the texture
                // before it is stretched to the animation actor's dimensions.
                const content = actor.paint_to_content(null);
                if (!content)
                    throw new Error('Window snapshot is unavailable');
                snapshot = new St.Widget({
                    content,
                    x: actor.x, y: actor.y, width: actor.width, height: actor.height,
                    reactive: false,
                });
                Main.uiGroup.insert_child_above(snapshot, global.window_group);
                animationActor = snapshot;
            }
            effect = new EffectClass({
                settingsData: this.settingsData, icon,
                animationActor,
                sourceActor: snapshot ? actor : null,
                originalOpacity,
                complete: complete.bind(Main.wm._shellwm),
                onDestroy: completedEffect => this._activeEffects.delete(completedEffect),
            });
            this._activeEffects.add(effect);
            if (snapshot)
                actor.opacity = 0;
            animationActor.add_effect_with_name(name, effect);
        } catch (error) {
            console.warn(`[Magic Lamp] Could not animate window: ${error}`);
            if (effect)
                effect.destroy();
            else {
                snapshot?.destroy();
                actor.opacity = originalOpacity;
                complete.call(Main.wm._shellwm, actor);
            }
        }
    }

    destroyActorEffect(actor) {
        if (!actor) {
            return;
        }
        for (const effect of this._activeEffects || []) {
            if (effect.sourceActor === actor)
                effect.destroy();
        }

        let minimizeEffect = actor.get_effect(MINIMIZE_EFFECT_NAME);
        if (minimizeEffect) {
            minimizeEffect.destroy();
        }

        let unminimizeEffect = actor.get_effect(UNMINIMIZE_EFFECT_NAME);
        if (unminimizeEffect) {
            unminimizeEffect.destroy();
        }
    }
}

export class AbstractCommonMagicLampEffect extends Clutter.DeformEffect {
    static {
        GObject.registerClass(this);
    }    

    _init(params = {}) {
        super._init();

        this.settingsData = params.settingsData;
        this.sourceActor = params.sourceActor || null;
        this._animationActor = params.animationActor || null;
        this._sourceOpacity = params.originalOpacity;
        this._onDestroy = params.onDestroy;

        this.isMinimizeEffect = false;
        this.newFrameEvent = null;
        this.completedEvent = null;
        
        this.timerId = null;
        this.msecs = 0;

        this.monitor = {x: 0, y: 0, width: 0, height: 0};
        this.iconMonitor = {x: 0, y: 0, width: 0, height: 0};
        this.window = {x: 0, y: 0, width: 0, height: 0, scale: 1};
        this.icon = params.icon ? {...params.icon} : null;
        this._funnelTarget = null;
        
        this.progress = 0;
        this.k = 0;
        this.j = 0;
        this.iconPosition = null;

        this.toTheBorder = false;

        this.EFFECT = this.settingsData.EFFECT.get(); //'default' - 'sine'
        const clampSetting = (value, minimum, maximum, fallback) =>
            Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.round(value))) : fallback;
        this.DURATION = clampSetting(this.settingsData.DURATION.get(), 1, 10000, 400);
        this.X_TILES = clampSetting(this.settingsData.X_TILES.get(), 1, 50, 10);
        this.Y_TILES = clampSetting(this.settingsData.Y_TILES.get(), 1, 50, 10);

        this.initialized = false;
        this._destroyed = false;
    }

    destroy_actor(actor) {}

    on_tick_elapsed(timer, msecs) {}

    _shouldStop() {
        const settings = St.Settings.get();
        return !settings.enable_animations ||
            (St.ReducedMotion && settings.reducedMotion === St.ReducedMotion.REDUCE) ||
            Main.overview.visible || Main.wm._workspaceAnimation?.gestureActive;
    }

    _updateProgress(progress) {
        this.progress = clamp(progress);
        // The neck reaches the icon while the tail is already moving. Both
        // phases ease smoothly and overlap instead of stopping at a hard split.
        this.k = smoothstep(this.progress / 0.55);
        this.j = smoothstep((this.progress - 0.18) / 0.82);
        const opacity = this.fallback ? 1 - smoothstep(this.progress)
            : 1 - smoothstep((this.progress - 0.88) / 0.12);
        const actor = this.get_actor() || this._animationActor;
        if (actor && this._animationOpacity !== undefined)
            actor.opacity = Math.round(this._animationOpacity * opacity);
    }

    vfunc_set_actor(actor) {
        if (!actor) {
            // Removing an effect before its timeline completes must stop it.
            this.destroy(true);
            super.vfunc_set_actor(actor);
            return;
        }
        super.vfunc_set_actor(actor);
        if (this.initialized || this._destroyed) {
            return;
        }

        this.initialized = true;
        
        const sourceActor = this.sourceActor || actor;
        this.monitor = Main.layoutManager.monitors[sourceActor.meta_window.get_monitor()];
        [this.window.width, this.window.height] = actor.get_size();
        if (!this.monitor || !Number.isFinite(this.window.width) || !Number.isFinite(this.window.height) ||
            this.window.width <= 0 || this.window.height <= 0) {
            this.destroy();
            return;
        }
        this._actorDestroyId = actor.connect('destroy', () => {
            this._animationDestroyed = true;
            this.destroy();
        });
        if (this.sourceActor)
            this._sourceDestroyId = this.sourceActor.connect('destroy', () => this.destroy());

        [this.window.x, this.window.y] = [actor.get_x() - this.monitor.x, actor.get_y() - this.monitor.y];
        this._animationOpacity = actor.opacity;
        const monitors = Main.layoutManager.monitors;
        const target = iconTarget(this.icon, monitors);
        this.fallback = !target;
        this.iconMonitor = target ? monitors[target.monitorIndex] : this.monitor;
        // Without a real destination, use a short, restrained shrink/fade at
        // the window itself. The fallback does not pretend a dock icon exists.
        this.icon = target ? {...target, x: target.x - this.monitor.x, y: target.y - this.monitor.y} : {
            x: this.window.x + this.window.width * 0.03,
            y: this.window.y + this.window.height * 0.03,
            width: this.window.width * 0.94,
            height: this.window.height * 0.94,
        };
        const dockSides = {
            bottom: St.Side.BOTTOM,
            left: St.Side.LEFT,
            right: St.Side.RIGHT,
            top: St.Side.TOP,
        };
        this.iconPosition = dockSides[target?.dockPosition];
        if (this.iconPosition === undefined) {
            const distances = target ? [
                [St.Side.TOP, Math.abs(target.y - this.iconMonitor.y)],
                [St.Side.BOTTOM, Math.abs(this.iconMonitor.y + this.iconMonitor.height - target.y - target.height)],
                [St.Side.LEFT, Math.abs(target.x - this.iconMonitor.x)],
                [St.Side.RIGHT, Math.abs(this.iconMonitor.x + this.iconMonitor.width - target.x - target.width)],
            ] : [[St.Side.BOTTOM, 0]];
            this.iconPosition = distances.sort((a, b) => a[1] - b[1])[0][0];
        }
        // A cross-output target may be behind the dock's nominal direction.
        // Follow its actual position so the leading edge never crosses the tail.
        if (this.iconMonitor !== this.monitor) {
            const dx = (this.icon.x + this.icon.width / 2 - this.window.x - this.window.width / 2) / this.window.width;
            const dy = (this.icon.y + this.icon.height / 2 - this.window.y - this.window.height / 2) / this.window.height;
            this.iconPosition = Math.abs(dx) > Math.abs(dy)
                ? (dx < 0 ? St.Side.LEFT : St.Side.RIGHT)
                : (dy < 0 ? St.Side.TOP : St.Side.BOTTOM);
        }
        if (!this.fallback) {
            const tip = funnelTarget(this.icon, this.iconPosition);
            // Compare the aperture rather than the whole icon: an overlapping
            // icon can have its incoming edge behind the window's trailing edge.
            if ((this.iconPosition === St.Side.BOTTOM && tip.y + tip.height <= this.window.y) ||
                (this.iconPosition === St.Side.TOP && tip.y >= this.window.y + this.window.height))
                this.iconPosition = this.iconPosition === St.Side.BOTTOM ? St.Side.TOP : St.Side.BOTTOM;
            if ((this.iconPosition === St.Side.RIGHT && tip.x + tip.width <= this.window.x) ||
                (this.iconPosition === St.Side.LEFT && tip.x >= this.window.x + this.window.width))
                this.iconPosition = this.iconPosition === St.Side.RIGHT ? St.Side.LEFT : St.Side.RIGHT;
            this._funnelTarget = funnelTarget(this.icon, this.iconPosition);
        }

        this.set_n_tiles(this.X_TILES, this.Y_TILES);
        this._updateProgress(this.isMinimizeEffect ? 0 : 1);
        this.timerId = new Clutter.Timeline({ actor, duration: this.fallback ? Math.min(160, this.DURATION) : this.DURATION });
        this.newFrameEvent = this.timerId.connect('new-frame', this.on_tick_elapsed.bind(this));
        this.completedEvent = this.timerId.connect('completed', () => this.destroy());
        this.timerId.start();
    }

    destroy(detaching = false) {
        if (this._destroyed) {
            // Disable or actor destruction drains an already queued detach
            // cleanup before releasing extension ownership.
            if (!detaching && this._cleanupId) {
                GLib.source_remove(this._cleanupId);
                this._cleanupId = null;
                this._finishDestroy();
            }
            return;
        }
        this._destroyed = true;
        if (this.timerId) {
            this.timerId.stop();
            if (this.newFrameEvent) {
                this.timerId.disconnect(this.newFrameEvent);
                this.newFrameEvent = null;
            }
            if (this.completedEvent) {
                this.timerId.disconnect(this.completedEvent);
                this.completedEvent = null;
            }
            this.timerId = null;
        }

        let actor = this.get_actor() || this._animationActor;
        if (actor && !detaching && this.get_actor() === actor)
            actor.remove_effect(this);

        this._finishDestroy = () => {
            if (actor) {
                if (this._actorDestroyId) {
                    actor.disconnect(this._actorDestroyId);
                    this._actorDestroyId = null;
                }
                if (this.paintEvent) {
                    actor.disconnect(this.paintEvent);
                    this.paintEvent = null;
                }
                if (this._animationOpacity !== undefined && !this._animationDestroyed)
                    actor.opacity = this._animationOpacity;

                const sourceActor = this.sourceActor || actor;
                if (this.sourceActor) {
                    if (this._sourceDestroyId)
                        this.sourceActor.disconnect(this._sourceDestroyId);
                    this._sourceDestroyId = null;
                    this.sourceActor.opacity = this._sourceOpacity;
                    this.sourceActor = null;
                    if (!this._animationDestroyed)
                        actor.destroy();
                }
                this.destroy_actor(sourceActor);
            }
            this._onDestroy?.(this);
            this._onDestroy = null;
            this._animationActor = null;
            this._finishDestroy = null;
        };
        if (detaching) {
            // Clutter calls set_actor(NULL) while the meta is still in its
            // native effects list. Dispose only after native removal returns.
            if (this.sourceActor)
                actor.hide();
            this._cleanupId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._cleanupId = null;
                this._finishDestroy();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._finishDestroy();
        }
    }

    vfunc_deform_vertex(w, h, v) {
        if (!this.initialized || this._destroyed)
            return;
        const window = this.window;
        const icon = this._funnelTarget || this.icon;
        const sourceX = window.x + v.tx * window.width;
        const sourceY = window.y + v.ty * window.height;
        const targetX = icon.x + v.tx * icon.width;
        const targetY = icon.y + v.ty * icon.height;
        let x, y;

        if (this.fallback) {
            const shrink = smoothstep(this.progress);
            x = mix(sourceX, targetX, shrink);
            y = mix(sourceY, targetY, shrink);
        } else {
            const horizontal = this.iconPosition === St.Side.LEFT || this.iconPosition === St.Side.RIGHT;
            const reverse = this.iconPosition === St.Side.LEFT || this.iconPosition === St.Side.TOP;
            const slice = horizontal ? v.tx : v.ty;
            const towardIcon = reverse ? 1 - slice : slice;
            // Every slice remains a positive-width section of the same funnel.
            // Smooth curvature replaces the old oscillations that bent edges
            // outside the source/target envelope and visibly folded the mesh.
            const curve = this.EFFECT === 'sine'
                ? (1 - Math.cos(Math.PI * towardIcon)) / 2
                : smoothstep(towardIcon);
            const neck = this.j + (1 - this.j) * this.k * curve;
            const start = reverse ? this.k : this.j;
            const end = reverse ? this.j : this.k;
            if (horizontal) {
                x = mix(mix(window.x, icon.x, start),
                    mix(window.x + window.width, icon.x + icon.width, end), v.tx);
                y = mix(sourceY, targetY, neck);
            } else {
                x = mix(sourceX, targetX, neck);
                y = mix(mix(window.y, icon.y, start),
                    mix(window.y + window.height, icon.y + icon.height, end), v.ty);
            }
        }
        v.x = (x - window.x) * w / window.width;
        v.y = (y - window.y) * h / window.height;
    }

}

export class MagicLampMinimizeEffect extends AbstractCommonMagicLampEffect {
    static {
        GObject.registerClass(this);
    }
       
    _init(params = {}) {
        super._init(params);

        this.k = 0;
        this.j = 0;
        this.isMinimizeEffect = true;
        this._complete = params.complete || Main.wm._shellwm.original_completed_minimize.bind(Main.wm._shellwm);
    
    }

    destroy_actor(actor) {
        this._complete(actor);
    }

    on_tick_elapsed(timer, msecs) {
        if (this._shouldStop()) {
            this.destroy();
            return;
        }
        if (!this.actor?.get_parent()) {
            this.destroy();
            return;
        }

        this._updateProgress(timer.get_progress());

        this.actor.get_parent().queue_redraw();
        this.invalidate();
    }

    vfunc_modify_paint_volume(pv) {
        return false;
    }
}
    
export class MagicLampUnminimizeEffect extends AbstractCommonMagicLampEffect {
    static {
        GObject.registerClass(this);
    }

    _init(params = {}) {
        super._init(params);

        this.k = 1;
        this.j = 1;
        this.isMinimizeEffect = false;
        this._complete = params.complete || Main.wm._shellwm.original_completed_unminimize.bind(Main.wm._shellwm);
    }
    
    destroy_actor(actor) {
        this._complete(actor);
    }

    on_tick_elapsed(timer, msecs) {
        if (this._shouldStop()) {
            this.destroy();
            return;
        }   
        if (!this.actor?.get_parent()) {
            this.destroy();
            return;
        }

        this._updateProgress(1 - timer.get_progress());

        this.actor.get_parent().queue_redraw();
        this.invalidate();
    }

    vfunc_modify_paint_volume(pv) {
        return false;
    }
}
