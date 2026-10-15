/**
 * Unified Shell Suite - DockSubsystem
 * Integrates DockManager and TweaksComponent.
 */

import { Subsystem } from '../../core/subsystem.js';
import { DockManager } from './dockManager.js';
import { TweaksComponent } from './tweaksComponent.js';

export class DockSubsystem extends Subsystem {
    constructor(settings) {
        super('DockSubsystem', settings);
        this.dockManager = new DockManager(settings, this.patchManager);
        this.tweaksComponent = new TweaksComponent(settings);
    }

    enable() {
        super.enable();

        if (this.settings.get_boolean('dock-enabled')) {
            this.dockManager.enable();
        }

        this.tweaksComponent.enable();
    }

    disable() {
        this.dockManager.disable();
        this.tweaksComponent.disable();
        super.disable();
    }

    onSettingChanged(key) {
        if (key.startsWith('dock-')) {
            if (this.settings.get_boolean('dock-enabled')) {
                this.dockManager.disable();
                this.dockManager.enable();
            } else {
                this.dockManager.disable();
            }
        } else if (key.startsWith('tweak-')) {
            this.tweaksComponent.update();
        }
    }
}

