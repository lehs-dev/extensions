/**
 * Unified Shell Suite - WindowSubsystem
 * Integrates TilingEngine and GapEngine into a cohesive, rock-solid window management system.
 */

import { Subsystem } from '../../core/subsystem.js';
import { GapEngine } from './gapEngine.js';
import { TilingEngine } from './tilingEngine.js';

export class WindowSubsystem extends Subsystem {
    constructor(settings) {
        super('WindowSubsystem', settings);
        this.gapEngine = new GapEngine(settings);
        this.tilingEngine = new TilingEngine(settings, this.patchManager, this.gapEngine);
    }

    enable() {
        super.enable();
        if (this.settings.get_boolean('tiling-enabled')) {
            this.tilingEngine.enable();
        }
    }

    disable() {
        this.tilingEngine.disable();
        super.disable();
    }

    onSettingChanged(key) {
        if (key === 'tiling-enabled') {
            if (this.settings.get_boolean('tiling-enabled')) {
                this.tilingEngine.enable();
            } else {
                this.tilingEngine.disable();
            }
        }
    }
}

