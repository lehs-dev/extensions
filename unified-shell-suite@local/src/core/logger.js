/**
 * Unified Shell Suite - Standardized Logger
 */

export class Logger {
    constructor(prefix = 'UnifiedSuite') {
        this._prefix = prefix;
    }

    sub(name) {
        return new Logger(`${this._prefix}::${name}`);
    }

    log(...args) {
        console.log(`[${this._prefix}]`, ...args);
    }

    warn(...args) {
        console.warn(`[${this._prefix}] [WARN]`, ...args);
    }

    error(...args) {
        console.error(`[${this._prefix}] [ERROR]`, ...args);
    }

    debug(...args) {
        // Optional debug logging
        // console.debug(`[${this._prefix}] [DEBUG]`, ...args);
    }
}

export const logger = new Logger('UnifiedSuite');

