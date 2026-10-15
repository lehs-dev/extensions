/**
 * Unified Shell Suite - Subsystem Base Class
 */

import { Logger } from './logger.js';
import { PatchManager } from './patchManager.js';

export class Subsystem {
    /**
     * @param {string} name 
     * @param {Gio.Settings} settings 
     */
    constructor(name, settings) {
        this.name = name;
        this.settings = settings;
        this.logger = new Logger(name);
        this.patchManager = new PatchManager(name);
        this.isEnabled = false;
    }

    /**
     * Subsystem activation logic.
     */
    enable() {
        if (this.isEnabled) return;
        this.isEnabled = true;
        this.logger.log(`Enabled`);
    }

    /**
     * Subsystem deactivation logic. Guaranteed rollback.
     */
    disable() {
        if (!this.isEnabled) return;
        this.isEnabled = false;
        this.patchManager.rollback();
        this.logger.log(`Disabled`);
    }

    /**
     * Called whenever a relevant GSetting key changes.
     * @param {string} key 
     */
    onSettingChanged(key) {
        // To be implemented by subclasses
    }
}

