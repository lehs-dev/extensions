/**
 * Unified Shell Suite - CompositingSubsystem
 * Manages Blur, Magic Lamp, Color Styling, and Static Background components.
 */

import { Subsystem } from '../../core/subsystem.js';
import { BlurEngine } from './blurEngine.js';
import { MagicLampEngine } from './magicLampEngine.js';
import { ColorStyling } from './colorStyling.js';
import { StaticBackground } from './staticBackground.js';

export class CompositingSubsystem extends Subsystem {
    constructor(settings) {
        super('CompositingSubsystem', settings);
        this.blurEngine = new BlurEngine(settings);
        this.magicLampEngine = new MagicLampEngine(settings, this.patchManager);
        this.colorStyling = new ColorStyling(settings);
        this.staticBackground = new StaticBackground(this.patchManager);
    }

    enable() {
        super.enable();

        if (this.settings.get_boolean('blur-enabled')) {
            this.blurEngine.enable();
        }

        if (this.settings.get_boolean('magic-lamp-enabled')) {
            this.magicLampEngine.enable();
        }

        if (this.settings.get_boolean('static-background-enabled')) {
            this.staticBackground.enable();
        }

        this.colorStyling.enable();
    }

    disable() {
        this.blurEngine.disable();
        this.magicLampEngine.disable();
        this.staticBackground.disable();
        this.colorStyling.disable();
        super.disable();
    }

    onSettingChanged(key) {
        if (key.startsWith('blur-')) {
            this.blurEngine.update();
        } else if (key === 'color-scheme') {
            this.colorStyling.update();
        } else if (key === 'magic-lamp-enabled') {
            if (this.settings.get_boolean('magic-lamp-enabled')) {
                this.magicLampEngine.enable();
            } else {
                this.magicLampEngine.disable();
            }
        } else if (key === 'static-background-enabled') {
            if (this.settings.get_boolean('static-background-enabled')) {
                this.staticBackground.enable();
            } else {
                this.staticBackground.disable();
            }
        }
    }
}

