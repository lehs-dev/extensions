/**
 * Unified Shell Suite - Main Extension Entry Point
 * Architecture: Modular Suite for GNOME 51+
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { CompositingSubsystem } from './src/subsystems/compositing/compositingSubsystem.js';
import { WindowSubsystem } from './src/subsystems/windowManagement/windowSubsystem.js';
import { DockSubsystem } from './src/subsystems/dock/dockSubsystem.js';
import { OverlaysSubsystem } from './src/subsystems/overlays/overlaysSubsystem.js';
import { logger } from './src/core/logger.js';

export default class UnifiedShellSuiteExtension extends Extension {
    enable() {
        logger.log('Enabling Unified Shell Suite...');

        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', (_, key) => {
            this._onSettingChanged(key);
        });

        // Instantiate modular subsystems
        this._subsystems = [
            new CompositingSubsystem(this._settings),
            new WindowSubsystem(this._settings),
            new DockSubsystem(this._settings),
            new OverlaysSubsystem(this._settings),
        ];

        // Enable all subsystems
        for (const sub of this._subsystems) {
            try {
                sub.enable();
            } catch (err) {
                logger.error(`Error enabling subsystem ${sub.name}:`, err);
            }
        }

        logger.log('Unified Shell Suite enabled successfully.');
    }

    disable() {
        logger.log('Disabling Unified Shell Suite...');

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        // Disable all subsystems in reverse order
        if (this._subsystems) {
            for (let i = this._subsystems.length - 1; i >= 0; i--) {
                const sub = this._subsystems[i];
                try {
                    sub.disable();
                } catch (err) {
                    logger.error(`Error disabling subsystem ${sub.name}:`, err);
                }
            }
            this._subsystems = null;
        }

        this._settings = null;
        logger.log('Unified Shell Suite disabled cleanly.');
    }

    _onSettingChanged(key) {
        if (!this._subsystems) return;

        for (const sub of this._subsystems) {
            try {
                sub.onSettingChanged(key);
            } catch (err) {
                logger.warn(`Error handling setting change '${key}' in ${sub.name}:`, err);
            }
        }
    }
}

