/**
 * Unified Shell Suite - OverlaysSubsystem
 * Integrates Spotlight Search, Clipboard History, and Kimpanel Input Method Helper.
 */

import { Subsystem } from '../../core/subsystem.js';
import { SpotlightService } from './spotlightService.js';
import { ClipboardService } from './clipboardService.js';
import { KimpanelService } from './kimpanelService.js';

export class OverlaysSubsystem extends Subsystem {
    constructor(settings) {
        super('OverlaysSubsystem', settings);
        this.spotlightService = new SpotlightService(settings, this.patchManager);
        this.clipboardService = new ClipboardService(settings, this.patchManager);
        this.kimpanelService = new KimpanelService(settings, this.patchManager);
    }

    enable() {
        super.enable();

        if (this.settings.get_boolean('spotlight-enabled')) {
            this.spotlightService.enable();
        }

        if (this.settings.get_boolean('clipboard-enabled')) {
            this.clipboardService.enable();
        }

        if (this.settings.get_boolean('kimpanel-enabled')) {
            this.kimpanelService.enable();
        }
    }

    disable() {
        this.spotlightService.disable();
        this.clipboardService.disable();
        this.kimpanelService.disable();
        super.disable();
    }

    onSettingChanged(key) {
        if (key === 'spotlight-enabled') {
            if (this.settings.get_boolean('spotlight-enabled')) {
                this.spotlightService.enable();
            } else {
                this.spotlightService.disable();
            }
        } else if (key === 'clipboard-enabled') {
            if (this.settings.get_boolean('clipboard-enabled')) {
                this.clipboardService.enable();
            } else {
                this.clipboardService.disable();
            }
        } else if (key === 'kimpanel-enabled') {
            if (this.settings.get_boolean('kimpanel-enabled')) {
                this.kimpanelService.enable();
            } else {
                this.kimpanelService.disable();
            }
        }
    }
}

