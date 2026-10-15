/**
 * Unified Shell Suite - GapEngine
 * Native window spacing math without creating fake strut actors or corrupting workArea.
 */

export class GapEngine {
    constructor(settings) {
        this._settings = settings;
    }

    get screenGap() {
        return this._settings.get_int('screen-gap-size') || 8;
    }

    get windowGap() {
        return this._settings.get_int('window-gap-size') || 8;
    }

    /**
     * Calculates a window rectangle with inner and outer gaps applied.
     * @param {Object} baseRect - {x, y, width, height} of the tile slot
     * @param {Object} bounds - {isLeft, isRight, isTop, isBottom} edge flags
     * @returns {Object} Adjusted rectangle with padding
     */
    applyGaps(baseRect, bounds = {}) {
        const sGap = this.screenGap;
        const halfWGap = Math.floor(this.windowGap / 2);

        const leftPad = bounds.isLeft ? sGap : halfWGap;
        const rightPad = bounds.isRight ? sGap : halfWGap;
        const topPad = bounds.isTop ? sGap : halfWGap;
        const bottomPad = bounds.isBottom ? sGap : halfWGap;

        return {
            x: Math.round(baseRect.x + leftPad),
            y: Math.round(baseRect.y + topPad),
            width: Math.max(100, Math.round(baseRect.width - leftPad - rightPad)),
            height: Math.max(100, Math.round(baseRect.height - topPad - bottomPad)),
        };
    }
}

