/**
 * Unified Shell Suite - WindowTracker
 * Safe WeakMap-based state storage for Meta.Window instances.
 * Prevents memory leaks and avoids attaching ad-hoc properties directly to C GObject wrappers.
 */

const windowDataMap = new WeakMap();

/**
 * Retrieves or initializes state object for a Meta.Window.
 * @param {Meta.Window} window 
 * @returns {Object} State data for the window
 */
export function getWindowData(window) {
    if (!window) return null;

    let data = windowDataMap.get(window);
    if (!data) {
        data = {
            isTiled: false,
            tiledRect: null,
            untiledRect: null,
            maximizedHorizontally: false,
            maximizedVertically: false,
            customGap: null,
        };
        windowDataMap.set(window, data);

        // Auto-clean on window unmanage if signal is available
        if (typeof window.connect === 'function') {
            try {
                const unmanagedId = window.connect('unmanaged', () => {
                    windowDataMap.delete(window);
                    try {
                        window.disconnect(unmanagedId);
                    } catch (_) {}
                });
            } catch (_) {}
        }
    }
    return data;
}

/**
 * Sets state data for a Meta.Window.
 * @param {Meta.Window} window 
 * @param {Object} partialData 
 */
export function updateWindowData(window, partialData) {
    const current = getWindowData(window);
    if (current && partialData) {
        Object.assign(current, partialData);
    }
    return current;
}

/**
 * Clears stored data for a window.
 * @param {Meta.Window} window 
 */
export function removeWindowData(window) {
    if (window) {
        windowDataMap.delete(window);
    }
}

