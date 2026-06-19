/**
 * SignalTracker — tracked GObject signal connections.
 *
 * Every connection made through a tracker instance is remembered and can be
 * disconnected in bulk with disconnectAll() — typically from
 * extension.disable() — so no handler survives past the extension lifetime.
 *
 * Usage:
 *   const signals = new SignalTracker();
 *   signals.connect(global.display, 'window-created', fn);
 *   signals.connectObject(window, 'unmanaged', fn);   // grouped by object
 *   signals.disconnectObject(window);                 // only this object's
 *   signals.disconnectAll();
 */

export class SignalTracker {
    constructor() {
        /** @type {Array<{obj: object, id: number}>} */
        this._connections = [];
    }

    /**
     * Connect a signal and track it for later disconnection.
     *
     * @param {object}   obj     GObject to connect to.
     * @param {string}   signal  Signal name.
     * @param {Function} fn      Handler.
     * @returns {number} signal handler id
     */
    connect(obj, signal, fn) {
        const id = obj.connect(signal, fn);
        this._connections.push({ obj, id });
        return id;
    }

    /**
     * Disconnect one tracked connection by object + handler id.
     *
     * @param {object} obj
     * @param {number} id
     */
    disconnect(obj, id) {
        const idx = this._connections.findIndex(c => c.obj === obj && c.id === id);
        if (idx === -1) return;
        this._connections.splice(idx, 1);
        try { obj.disconnect(id); } catch (_) {}
    }

    /**
     * Disconnect every tracked connection on a specific object
     * (e.g. all signals attached to one Meta.Window).
     *
     * @param {object} obj
     */
    disconnectObject(obj) {
        const remaining = [];
        for (const c of this._connections) {
            if (c.obj === obj) {
                try { c.obj.disconnect(c.id); } catch (_) {}
            } else {
                remaining.push(c);
            }
        }
        this._connections = remaining;
    }

    /** Disconnect all tracked connections. */
    disconnectAll() {
        for (const { obj, id } of this._connections) {
            try { obj.disconnect(id); } catch (_) {}
        }
        this._connections = [];
    }
}
