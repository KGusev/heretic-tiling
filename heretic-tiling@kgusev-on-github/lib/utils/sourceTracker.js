/**
 * SourceTracker — tracked wrapper around GLib timeout/idle sources.
 *
 * Every source created through a tracker instance is remembered and can be
 * cancelled in bulk with clearAll() — typically from extension.disable() —
 * so no callback ever fires after the extension is turned off.
 *
 * Usage:
 *   const sources = new SourceTracker();
 *   sources.timeout(100, () => { ... });   // one-shot; auto-untracked
 *   sources.idle(() => { ... });           // one-shot; auto-untracked
 *   sources.clearAll();                    // cancel everything still pending
 */

import GLib from 'gi://GLib';

export class SourceTracker {
    constructor() {
        /** @type {Set<number>} */
        this._sources = new Set();
    }

    /**
     * Schedule a one-shot timeout. The callback's return value is ignored;
     * the source always fires exactly once.
     *
     * @param {number}   intervalMs  Delay in milliseconds.
     * @param {Function} fn          Callback.
     * @param {number}   [priority]  GLib priority (default: PRIORITY_DEFAULT).
     * @returns {number} source id
     */
    timeout(intervalMs, fn, priority = GLib.PRIORITY_DEFAULT) {
        const sid = GLib.timeout_add(priority, intervalMs, () => {
            this._sources.delete(sid);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._sources.add(sid);
        return sid;
    }

    /**
     * Schedule a one-shot idle callback.
     *
     * @param {Function} fn          Callback.
     * @param {number}   [priority]  GLib priority (default: PRIORITY_DEFAULT).
     * @returns {number} source id
     */
    idle(fn, priority = GLib.PRIORITY_DEFAULT) {
        const sid = GLib.idle_add(priority, () => {
            this._sources.delete(sid);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._sources.add(sid);
        return sid;
    }

    /**
     * Cancel a single tracked source (no-op if it already fired).
     * @param {number} sid
     */
    remove(sid) {
        if (this._sources.delete(sid)) {
            try { GLib.source_remove(sid); } catch (_) {}
        }
    }

    /** Cancel all still-pending sources. */
    clearAll() {
        for (const sid of this._sources) {
            try { GLib.source_remove(sid); } catch (_) {}
        }
        this._sources.clear();
    }
}
