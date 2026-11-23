/**
 * StickyManager — owns the sticky-window registry and sticky focus handling.
 *
 * Replaces the former module-level registry in windowActions.js with an
 * instance owned by the extension: created in enable(), destroyed in
 * disable(). All per-window 'unmanaged' cleanup handlers are tracked and
 * disconnected on destroy(), so nothing leaks across disable/enable cycles.
 */

import Meta from 'gi://Meta';
import {Logger} from '../logger.js';
import {SignalTracker} from '../utils/signalTracker.js';

export class StickyManager {
    constructor() {
        /** @type {Set<Meta.Window>} */
        this._windows = new Set();
        this._signals = new SignalTracker();
        this._log = new Logger('StickyManager');
    }

    /** Disconnect all handlers and forget all windows. */
    destroy() {
        this._signals.disconnectAll();
        this._windows.clear();
    }

    /**
     * Returns all windows currently marked as sticky by this extension.
     * @returns {Meta.Window[]}
     */
    getStickyWindows() {
        return Array.from(this._windows);
    }

    /**
     * Check if a window is tracked as sticky.
     * @param {Meta.Window} window
     * @returns {boolean}
     */
    has(window) {
        return this._windows.has(window);
    }

    /**
     * Make the window sticky — visible on all workspaces and always on top.
     *
     * Combines stick() (cross-workspace presence) with make_above() (z-order).
     * Registers an `unmanaged` handler to automatically clean the registry
     * when the window is closed.
     *
     * Guard: if the window is already tracked as sticky (e.g. rules re-applied
     * after a shell restart), skip re-registration to avoid duplicate handlers.
     *
     * @param {Meta.Window} window
     */
    stick(window) {
        try {
            if (this._windows.has(window)) {
                this._log.debug(`stick: "${window.get_title()}" already sticky — skipping`);
                return;
            }

            window.stick(); // appear on every workspace
            window.make_above(); // keep above other windows
            this._windows.add(window);
            this._log.debug(`made window sticky: "${window.get_title()}"`);

            // Auto-remove from registry when the window is destroyed.
            this._signals.connect(window, 'unmanaged', () => {
                this._windows.delete(window);
                this._signals.disconnectObject(window);
                this._log.debug('cleaned sticky registry for destroyed window');
            });

            // Unfocus so it doesn't steal focus after being made above.
            this._unfocusIfFocused(window);
        } catch (e) {
            this._log.warn(`stick: ${e.message}`);
        }
    }

    /**
     * Remove sticky state from a window and stop tracking it.
     * @param {Meta.Window} window
     */
    unstick(window) {
        try {
            window.unstick();
            window.unmake_above();
            this._signals.disconnectObject(window);
            this._windows.delete(window);
            this._log.debug(`unstick: "${window.get_title()}"`);
        } catch (e) {
            this._log.warn(`unstick: ${e.message}`);
        }
    }

    /**
     * After a workspace switch, if a sticky window has focus, hand focus to
     * the most-recently-used non-sticky normal window on the active workspace.
     */
    unfocusAll() {
        const focused = global.display.focus_window;
        if (!focused || !this._isSticky(focused)) return;

        this._log.debug('sticky window has focus after workspace switch — finding replacement');

        try {
            const activeWs = global.workspace_manager.get_active_workspace();
            if (!activeWs) return;

            // Collect non-sticky normal windows, sorted by most-recently-used first.
            const candidates = activeWs
                .list_windows()
                .filter(
                    (win) =>
                        win.window_type === Meta.WindowType.NORMAL &&
                        !win.minimized &&
                        !this._isSticky(win) &&
                        win !== focused,
                )
                .sort((a, b) => b.get_user_time() - a.get_user_time());

            this._log.debug(`found ${candidates.length} candidate window(s)`);

            if (candidates.length > 0) {
                const target = candidates[0];
                this._log.debug(`focusing: "${target.get_title()}"`);
                activeWs.activate_with_focus(target, global.get_current_time());
            } else {
                this._log.debug('no candidates — using focus_default');
                global.display.focus_default();
            }
        } catch (e) {
            this._log.warn(`unfocusAll: ${e.message}`);
        }
    }

    // ------------------------------------------------------------- internal

    /**
     * Check if a window is sticky (either tracked by us or natively sticky).
     * @param {Meta.Window} window
     * @returns {boolean}
     */
    _isSticky(window) {
        return this._windows.has(window) || window.is_on_all_workspaces();
    }

    /**
     * Unfocus a sticky window by focusing the default window of the display.
     * @param {Meta.Window} window
     */
    _unfocusIfFocused(window) {
        try {
            if (global.display.focus_window === window) {
                this._log.debug(`unfocusing newly sticky window: "${window.get_title()}"`);
                global.display.focus_default();
            }
        } catch (_) {
            // Silently ignore — focus_default may fail if there is no other window.
        }
    }
}
