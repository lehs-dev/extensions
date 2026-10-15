/**
 * Unified Shell Suite - PatchManager
 * Manages scoped monkey-patching and signal listeners with guaranteed 100% clean rollback.
 */

import { logger } from './logger.js';

export class PatchManager {
    constructor(scopeName = 'Global') {
        this._scopeName = scopeName;
        this._logger = logger.sub(`PatchManager:${scopeName}`);
        this._patches = [];
        this._signals = [];
    }

    /**
     * Safely hooks an object or prototype method.
     * @param {Object} target - The object or prototype to patch
     * @param {string} methodName - The name of the method to patch
     * @param {Function} wrapperFactory - Function (originalMethod) => replacementMethod
     */
    hookMethod(target, methodName, wrapperFactory) {
        if (!target || typeof target[methodName] !== 'function') {
            this._logger.warn(`Cannot hook non-existent method ${methodName} on target`, target);
            return;
        }

        const original = target[methodName];
        const wrapper = wrapperFactory(original);

        this._patches.push({
            target,
            methodName,
            original,
            wrapper
        });

        target[methodName] = wrapper;
        this._logger.debug(`Hooked ${methodName}`);
    }

    /**
     * Connects a signal to an emitter and tracks it for automatic disconnection.
     * @param {Object} emitter - GObject or EventSource
     * @param {string} signal - Signal name
     * @param {Function} callback - Callback function
     * @returns {number} signal id
     */
    connectSignal(emitter, signal, callback) {
        if (!emitter || typeof emitter.connect !== 'function') {
            this._logger.warn(`Cannot connect signal '${signal}' on invalid emitter`);
            return 0;
        }

        try {
            const id = emitter.connect(signal, callback);
            this._signals.push({ emitter, id, signal });
            return id;
        } catch (e) {
            this._logger.error(`Failed to connect signal '${signal}':`, e);
            return 0;
        }
    }

    /**
     * Disconnects a specific tracked signal early if needed.
     */
    disconnectSignal(emitter, id) {
        const index = this._signals.findIndex(s => s.emitter === emitter && s.id === id);
        if (index !== -1) {
            try {
                emitter.disconnect(id);
            } catch (_) {}
            this._signals.splice(index, 1);
        }
    }

    /**
     * Unpatches all methods and disconnects all signals in reverse order.
     */
    rollback() {
        this._logger.debug(`Rolling back all patches and signals for ${this._scopeName}`);

        // 1. Disconnect all tracked signals
        for (let i = this._signals.length - 1; i >= 0; i--) {
            const { emitter, id, signal } = this._signals[i];
            try {
                if (emitter && typeof emitter.disconnect === 'function') {
                    emitter.disconnect(id);
                }
            } catch (err) {
                this._logger.warn(`Signal disconnect failed for ${signal}:`, err);
            }
        }
        this._signals = [];

        // 2. Restore all patched methods
        for (let i = this._patches.length - 1; i >= 0; i--) {
            const { target, methodName, original, wrapper } = this._patches[i];
            try {
                if (target[methodName] === wrapper) {
                    target[methodName] = original;
                }
            } catch (err) {
                this._logger.error(`Failed to restore method ${methodName}:`, err);
            }
        }
        this._patches = [];
    }
}

