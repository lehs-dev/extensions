
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
const nonZero = value => Math.abs(value) < 1e-6 ? 1e-6 : value;

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
            if (Main.overview.visible) {
                hooks.minimize.call(Main.wm._shellwm, actor);
                return;
            }

            this.animate(actor, MagicLampMinimizeEffect, MINIMIZE_EFFECT_NAME);
        });

        this.unminimizeId = global.window_manager.connect("unminimize", (e, actor) => {
            this.destroyActorEffect(actor);
            actor.show();

            if (Main.overview.visible) {
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
            if (Main.wm._shouldAnimateActor === hooks.shouldAnimateWrapper)
                Main.wm._shouldAnimateActor = hooks.shouldAnimate;
            if (Main.wm._shellwm.completed_minimize === hooks.minimizeWrapper)
                Main.wm._shellwm.completed_minimize = hooks.minimize;
            if (Main.wm._shellwm.completed_unminimize === hooks.unminimizeWrapper)
                Main.wm._shellwm.completed_unminimize = hooks.unminimize;
            if (Main.wm.original_minimizeMaximizeWindow_shouldAnimateActor === hooks.shouldAnimate)
                Main.wm.original_minimizeMaximizeWindow_shouldAnimateActor = null;
            if (Main.wm._shellwm.original_completed_minimize === hooks.minimize)
                Main.wm._shellwm.original_completed_minimize = null;
            if (Main.wm._shellwm.original_completed_unminimize === hooks.unminimize)
                Main.wm._shellwm.original_completed_unminimize = null;
            this._hooks = null;
        }
    }

    getIcon(actor) {
        let [success, icon] = actor.meta_window.get_icon_geometry();
        if (success) {
            return icon;
        } 
    
        let monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        if (monitor && Main.overview.dash) {
            let dashIcon = null;
            let transformed_position = null;
            let pids = null;
            let pid = actor.get_meta_window() ? actor.get_meta_window().get_pid() : null;
            if (pid) {
                Main.overview.dash._box.get_children()
                    .filter(dashElement => dashElement.child && dashElement.child._delegate && dashElement.child._delegate.app)
                    .forEach(dashElement => {
                        pids = dashElement.child._delegate.app.get_pids();
                        if (pids && pids.indexOf(pid) >= 0) {
                            transformed_position = dashElement.get_transformed_position();
                            if (transformed_position && Number.isFinite(transformed_position[0])) {
                                dashIcon = {x: transformed_position[0], y: monitor.y + monitor.height, width: 0, height: 0};
                                return;
                            }
                        }
                    });
            }
            if (dashIcon) {
                return dashIcon;
            }

            return {x: monitor.x + monitor.width / 2, y: monitor.y + monitor.height, width: 0, height: 0};
        }

        return {x: 0, y: 0, width: 0, height: 0};    
    }

    animate(actor, EffectClass, name) {
        const complete = name === MINIMIZE_EFFECT_NAME ?
            this._hooks?.minimize || Main.wm._shellwm.original_completed_minimize :
            this._hooks?.unminimize || Main.wm._shellwm.original_completed_unminimize;
        const icon = this.getIcon(actor);
        const monitors = Main.layoutManager.monitors;
        const windowMonitor = monitors[actor.meta_window.get_monitor()];
        const targetMonitor = Number.isInteger(icon.monitorIndex) ? monitors[icon.monitorIndex] :
            monitors.find(monitor => icon.x >= monitor.x && icon.x < monitor.x + monitor.width &&
                icon.y >= monitor.y && icon.y <= monitor.y + monitor.height);
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

class AbstractCommonMagicLampEffect extends Clutter.DeformEffect {
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

        this.EPSILON = 40;

        this.isMinimizeEffect = false;
        this.newFrameEvent = null;
        this.completedEvent = null;
        
        this.timerId = null;
        this.msecs = 0;

        this.monitor = {x: 0, y: 0, width: 0, height: 0};
        this.iconMonitor = {x: 0, y: 0, width: 0, height: 0};
        this.window = {x: 0, y: 0, width: 0, height: 0, scale: 1};
        this.icon = {...(params.icon || {x: 0, y: 0, width: 0, height: 0})};
        
        this.progress = 0;
        this.split = 0.3;
        this.k = 0;
        this.j = 0;
        this.expandWidth = 0;
        this.fullWidth = 0;
        this.expandHeight = 0;
        this.fullHeight = 0;
        this.width = 0;
        this.height = 0;
        this.x = 0;
        this.y = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.effectX = 0;
        this.effectY = 0;
        this.iconPosition = null;

        this.toTheBorder = true;   // true
        this.maxIconSize = null;    // 48
        this.alignIcon = 'center';  // 'left-top'

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

        [this.window.x, this.window.y] = [this.actor.get_x() - this.monitor.x, this.actor.get_y() - this.monitor.y];
        
        if (!this.icon || (this.icon.x == 0 && this.icon.y == 0 && this.icon.width == 0 && this.icon.height == 0)) {
            this.icon.x = this.monitor.x + this.monitor.width / 2;
            this.icon.y = this.monitor.height + this.monitor.y;
        }

        // Dash2Dock may place the target icon on a different monitor.
        const monitors = Main.layoutManager.monitors;
        if (Number.isInteger(this.icon.monitorIndex)) {
            this.iconMonitor = monitors[this.icon.monitorIndex] || this.monitor;
        } else {
            monitors.forEach((monitor, monitorIndex) => {
                // Both geometries already use stage coordinates; applying the
                // monitor scale again makes adjacent monitors overlap.
                if (this.icon.x >= monitor.x && this.icon.x <= monitor.x + monitor.width &&
                    this.icon.y >= monitor.y && this.icon.y <= monitor.y + monitor.height)
                    this.iconMonitor = monitor;
            });
            if (this.iconMonitor.width === 0 || this.iconMonitor.height === 0)
                this.iconMonitor = this.monitor;
        }

        const crossMonitor = this.iconMonitor !== this.monitor;
        const dockSides = {
            bottom: St.Side.BOTTOM,
            left: St.Side.LEFT,
            right: St.Side.RIGHT,
            top: St.Side.TOP,
        };
        const dockSide = dockSides[this.icon.dockPosition];
        const iconXOnTarget = this.icon.x - this.iconMonitor.x;
        const iconYOnTarget = this.icon.y - this.iconMonitor.y;

        [this.icon.x, this.icon.y, this.icon.width, this.icon.height] =
            [this.icon.x - this.monitor.x, this.icon.y - this.monitor.y,
             this.icon.width, this.icon.height];

        if (dockSide !== undefined) {
            this.iconPosition = dockSide;
        } else if (iconYOnTarget + this.icon.height >= this.iconMonitor.height - this.EPSILON) {
            this.iconPosition = St.Side.BOTTOM;
        } else if (iconXOnTarget <= this.EPSILON) {
            this.iconPosition = St.Side.LEFT;
        } else if (iconXOnTarget + this.icon.width >= this.iconMonitor.width - this.EPSILON) {
            this.iconPosition = St.Side.RIGHT;
        } else {
            this.iconPosition = St.Side.TOP;
        }

        // For a target across screens, travel toward it even when its dock
        // occupies the opposite edge of its own monitor.
        if (crossMonitor) {
            if (this.iconPosition === St.Side.LEFT || this.iconPosition === St.Side.RIGHT)
                this.iconPosition = this.icon.x <= this.window.x ? St.Side.LEFT : St.Side.RIGHT;
            else
                this.iconPosition = this.icon.y <= this.window.y ? St.Side.TOP : St.Side.BOTTOM;
        } else if (this.toTheBorder) {
            switch (this.iconPosition) {
                case St.Side.BOTTOM:
                    this.icon.y = this.iconMonitor.y + this.iconMonitor.height - this.monitor.y;
                    this.icon.height = 0;
                    break;
                case St.Side.LEFT:
                    this.icon.x = this.iconMonitor.x - this.monitor.x;
                    this.icon.width = 0;
                    break;
                case St.Side.RIGHT:
                    this.icon.x = this.iconMonitor.x + this.iconMonitor.width - this.monitor.x;
                    this.icon.width = 0;
                    break;
                case St.Side.TOP:
                    this.icon.y = this.iconMonitor.y - this.monitor.y;
                    this.icon.height = 0;
                    break;
            }
        }

        this.set_n_tiles(this.X_TILES, this.Y_TILES);
        
        const areaDelay = Math.min(1000, (this.monitor.width * this.monitor.height) / (this.window.width * this.window.height));
        this.timerId = new Clutter.Timeline({ actor: this.actor, duration: Math.round(this.DURATION + areaDelay) });
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
        if (this.initialized && !this._destroyed) {
            let propX = w / this.window.width;
            let propY = h / this.window.height;

            if (this.iconPosition == St.Side.LEFT) {
                this.width = nonZero(this.window.width - this.icon.width + (this.window.x - this.icon.x) * this.k);

                this.x = (this.width - this.j * this.width) * v.tx;  
                this.y = v.ty * this.window.height * (this.x + (this.width - this.x) * (1 - this.k)) / this.width + 
                        v.ty * this.icon.height * (this.width - this.x) / this.width;

                this.offsetX = this.icon.width - (this.window.x - this.icon.x) * this.k;
                this.offsetY = (this.icon.y - this.window.y) * ((this.width - this.x) / this.width) * this.k;

                if (this.EFFECT === 'sine') {
                    this.effectY = Math.sin(this.x / this.width * Math.PI * 4) * this.window.height / 14 * this.k;
                } else {
                    this.effectY = Math.sin((0.5 - (this.width - this.x) / this.width) * 2 * Math.PI) * (this.window.y + this.window.height * v.ty - (this.icon.y + this.icon.height * v.ty)) / 7 * this.k;
                }
            } else if (this.iconPosition == St.Side.TOP) {
                this.height = nonZero(this.window.height - this.icon.height + (this.window.y - this.icon.y) * this.k);

                this.y = (this.height - this.j * this.height) * v.ty;
                this.x = v.tx * this.window.width * (this.y + (this.height - this.y) * (1 - this.k)) / this.height + 
                        v.tx * this.icon.width * (this.height - this.y) / this.height;

                this.offsetX = (this.icon.x - this.window.x) * ((this.height - this.y) / this.height) * this.k;
                this.offsetY = this.icon.height - (this.window.y - this.icon.y) * this.k;

                if (this.EFFECT === 'sine') {
                    this.effectX = Math.sin(this.y / this.height * Math.PI * 4) * this.window.width / 14 * this.k;
                } else {
                    this.effectX = Math.sin((0.5 - (this.height - this.y) / this.height) * 2 * Math.PI) * (this.window.x + this.window.width * v.tx - (this.icon.x + this.icon.width * v.tx)) / 7 * this.k;
                }
            } else if (this.iconPosition == St.Side.RIGHT) {
                this.expandWidth = (this.icon.x - this.icon.width - this.window.x - this.window.width);
                this.fullWidth = nonZero((this.icon.x - this.icon.width - this.window.x) - this.expandWidth * (1 - this.k));
                this.width = this.fullWidth - this.j * this.fullWidth;

                this.x = v.tx * this.width;
                this.y = v.ty * (this.icon.height) +
                        v.ty * (this.window.height - this.icon.height) * (1 - this.j) * (1 - v.tx) +
                        v.ty * (this.window.height - this.icon.height) * (1 - this.k) * (v.tx);
                
                this.offsetY = (this.icon.y - this.window.y) * (this.x / this.fullWidth) * this.k + (this.icon.y - this.window.y) * this.j;
                this.offsetX = this.icon.x - this.icon.width - this.window.x - this.width - this.expandWidth * (1 - this.k);
                
                if (this.EFFECT === 'sine') {
                    this.effectY = Math.sin((this.width - this.x) / this.fullWidth * Math.PI * 4) * this.window.height / 14 * this.k;
                } else {
                    this.effectY = Math.sin(((this.width - this.x) / this.fullWidth) * 2 * Math.PI + Math.PI) * (this.window.y + this.window.height * v.ty - (this.icon.y + this.icon.height * v.ty)) / 7 * this.k;
                }
            } else if (this.iconPosition == St.Side.BOTTOM) {
                this.expandHeight = (this.icon.y - this.icon.height - this.window.y - this.window.height);
                this.fullHeight = nonZero((this.icon.y - this.icon.height - this.window.y) - this.expandHeight * (1 - this.k));
                this.height = this.fullHeight - this.j * this.fullHeight;
                
                this.y = v.ty * this.height;
                this.x = v.tx * (this.icon.width) +
                        v.tx * (this.window.width - this.icon.width) * (1 - this.j) * (1 - v.ty) +
                        v.tx * (this.window.width - this.icon.width) * (1 - this.k) * (v.ty);

                this.offsetX = (this.icon.x - this.window.x) * (this.y / this.fullHeight) * this.k + (this.icon.x - this.window.x) * this.j;
                this.offsetY = this.icon.y - this.icon.height - this.window.y - this.height - this.expandHeight * (1 - this.k);

                if (this.EFFECT === 'sine') {
                    this.effectX = Math.sin((this.height - this.y) / this.fullHeight * Math.PI * 4) * this.window.width / 14 * this.k;
                } else {
                    this.effectX = Math.sin(((this.height - this.y) / this.fullHeight) * 2 * Math.PI + Math.PI) * (this.window.x + this.window.width * v.tx - (this.icon.x + this.icon.width * v.tx)) / 7 * this.k;
                }
            }
            
            v.x = (this.x + this.offsetX + this.effectX) * propX;
            v.y = (this.y + this.offsetY + this.effectY) * propY;
        }    
    }
}

class MagicLampMinimizeEffect extends AbstractCommonMagicLampEffect {
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
        if (Main.overview.visible) {
            this.destroy();
            return;
        }
        if (!this.actor?.get_parent()) {
            this.destroy();
            return;
        }

        this.progress = timer.get_progress();
        this.k = this.progress <= this.split ? this.progress * (1 / 1 / this.split) : 1;
        this.j = this.progress > this.split ? (this.progress - this.split) * (1 / 1 / (1 - this.split)) : 0;

        this.actor.get_parent().queue_redraw();
        this.invalidate();
    }

    vfunc_modify_paint_volume(pv) {
        return false;
    }
}
    
class MagicLampUnminimizeEffect extends AbstractCommonMagicLampEffect {
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
        if (Main.overview.visible) {
            this.destroy();
            return;
        }   
        if (!this.actor?.get_parent()) {
            this.destroy();
            return;
        }

        this.progress = timer.get_progress();
        this.k = 1 - (this.progress > (1 - this.split) ? (this.progress - (1 - this.split)) * (1 / 1 / (1 - (1 - this.split))) : 0);
        this.j = 1 - (this.progress <= (1 - this.split) ? this.progress * (1 / 1 / (1 - this.split)) : 1);

        this.actor.get_parent().queue_redraw();
        this.invalidate();
    }

    vfunc_modify_paint_volume(pv) {
        return false;
    }
}
