import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { Pipeline } from '../conveniences/pipeline.js';

export const ScreenshotBlur = class ScreenshotBlur {
    constructor(connections, settings, effects_manager) {
        this.connections = connections;
        this.settings = settings;
        this.screenshot_background_managers = [];
        this._selectorSignals = [];
        this.effects_manager = effects_manager;
    }

    enable() {
        if (this.enabled)
            return;
        this.enabled = true;
        this._log("blurring screenshot's window selector");

        // connect to monitors change
        this.connections.connect(Main.layoutManager, 'monitors-changed',
            _ => this.update_backgrounds()
        );

        // update backgrounds when the component is enabled
        this.update_backgrounds();
    }

    update_backgrounds() {
        // remove every old background
        this.remove_background_actors();
        // create new backgrounds for the screenshot window selector
        for (let i = 0; i < Main.screenshotUI._windowSelectors.length; i++) {
            const window_selector = Main.screenshotUI._windowSelectors[i];
            if (!Main.layoutManager.monitors[window_selector._monitorIndex])
                continue;
            const pipeline = new Pipeline(
                this.effects_manager,
                global.blur_my_shell._pipelines_manager,
                this.settings.screenshot.PIPELINE
            );
            pipeline.create_background_with_effects(
                window_selector._monitorIndex, this.screenshot_background_managers,
                window_selector, 'bms-screenshot-blurred-widget', false
            );

            // prevent old `BackgroundActor` from being accessed, which creates a whole bug of logs
            const background_manager = this.screenshot_background_managers.at(-1);
            const parent = window_selector.get_parent();
            if (!parent)
                continue;
            const id = this.connections.connect(parent, 'destroy', () => {
                const index = this.screenshot_background_managers.indexOf(background_manager);
                if (index >= 0) {
                    const widget = background_manager.backgroundActor?.get_parent();
                    background_manager._bms_pipeline.destroy();
                    widget?.get_parent()?.remove_child(widget);
                    background_manager.destroy();
                    widget?.destroy();
                    this.screenshot_background_managers.splice(index, 1);
                }
                this._selectorSignals = this._selectorSignals.filter(signal => signal.id !== id);
                this.connections.disconnect(parent, id);
            });
            this._selectorSignals.push({parent, id});
        }
    }

    update_pipeline() {
        this.screenshot_background_managers.forEach(background_manager =>
            background_manager._bms_pipeline.change_pipeline_to(
                this.settings.screenshot.PIPELINE
            )
        );
    }

    remove_background_actors() {
        for (const {parent, id} of this._selectorSignals)
            this.connections.disconnect(parent, id);
        this._selectorSignals = [];
        this.screenshot_background_managers.forEach(background_manager => {
            background_manager._bms_pipeline.destroy();
            const widget = background_manager.backgroundActor?.get_parent();
            if (background_manager.backgroundActor) {
                widget?.get_parent()?.remove_child(widget);
            }
            background_manager.destroy();
            widget?.destroy();
        });

        Main.screenshotUI._windowSelectors.forEach(window_selector =>
            window_selector.get_children().forEach(child => {
                if (child.get_name() == 'bms-screenshot-blurred-widget')
                    window_selector.remove_child(child);
            })
        );

        this.screenshot_background_managers = [];
    }

    disable() {
        this.enabled = false;
        this._log("removing blur from screenshot's window selector");

        this.remove_background_actors();
        this.connections.disconnect_all();
    }

    _log(str) {
        if (this.settings.DEBUG)
            console.log(`[Blur my Shell > screenshot]   ${str}`);
    }

    _warn(str) {
        console.warn(`[Blur my Shell > screenshot]   ${str}`);
    }
};
