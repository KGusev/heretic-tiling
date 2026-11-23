/**
 * FocusManager — tracks focus, centers the cursor, and restores focus on close.
 *
 * When a workspace has two or more windows and the focused window is destroyed,
 * Mutter's default behaviour may not focus the window the user expects. This
 * module re-focuses the remaining window that is topmost in the stacking
 * (z) order — the "front-placed" window.
 *
 * Responsibilities:
 *  - Track the currently focused window via 'notify::focus-window'.
 *  - Watch each window's 'unmanaging' signal (attached on 'window-created');
 *    if the destroyed window was the focused one, defer to an idle callback
 *    (so Mutter finishes the unmanage sequence) and focus the front-most
 *    remaining NORMAL, non-minimized, non-sticky window on the active workspace.
 *
 * All GLib sources and GObject signals are tracked and torn down in destroy().
 */

import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import {SignalTracker} from './utils/signalTracker.js';
import {SourceTracker} from './utils/sourceTracker.js';
import {Logger} from './logger.js';

export class FocusManager {
    /** Own resources so toggling focus never disconnects another subsystem. */
    constructor(settings, monitorWorkspaces = null) {
        this._settings = settings;
        this._monitorWorkspaces = monitorWorkspaces;
        this._centerSource = null;
        this._sources = new SourceTracker();
        this._signals = new SignalTracker();
        this._focused = null;
        this._log = new Logger('FocusManager');
    }

    /** Start tracking focus and window destruction. */
    enable() {
        this._focused = global.display.focus_window;
        for (const window of global.display.list_all_windows()) this._watchWindow(window);
        this._signals.connect(global.display, 'notify::focus-window', () => {
            const window = global.display.focus_window;
            if (window === this._focused) return;
            this._focused = window;
            if (this._centerSource !== null) this._sources.remove(this._centerSource);
            this._centerSource = null;
            if (!window || !this._settings.get_boolean('center-cursor-on-focus')) return;
            // Let focus redirects and queued layout changes settle before moving.
            this._centerSource = this._sources.timeout(16, () => {
                this._centerSource = null;
                if (
                    global.display.focus_window !== window ||
                    !this._settings.get_boolean('center-cursor-on-focus') ||
                    this._monitorWorkspaces?.canCenterOn(window) === false
                )
                    return;
                const rect = window.get_frame_rect();
                if (rect.width <= 0 || rect.height <= 0) return;
                Clutter.get_default_backend()
                    .get_default_seat()
                    .warp_pointer(
                        Math.round(rect.x + rect.width / 2),
                        Math.round(rect.y + rect.height / 2),
                    );
            });
        });
        this._signals.connect(global.display, 'window-created', (_display, window) =>
            this._watchWindow(window),
        );
    }

    /** Disconnect handlers and cancel this manager's pending callbacks. */
    destroy() {
        this._sources.clearAll();
        this._centerSource = null;
        this._signals.disconnectAll();
        this._focused = null;
    }

    // ------------------------------------------------------------- internal

    /**
     * Observe unmanaging before Mutter clears or redirects focus.
     * The handler is tracked and auto-disconnected when the window goes away.
     *
     * @param {Meta.Window} window
     */
    _watchWindow(window) {
        this._signals.connect(window, 'unmanaging', () => this._onWindowRemoved(window));
        this._signals.connect(window, 'unmanaged', () => {
            this._signals.disconnectObject(window);
        });
    }

    /**
     * Handle a destroyed window. If it was the focused one, schedule a deferred
     * focus replacement so Mutter finishes the unmanage sequence first.
     *
     * @param {Meta.Window} removed
     */
    _onWindowRemoved(removed) {
        if (!this._settings.get_boolean('focus-next-on-close') || removed !== this._focused) return;
        const workspace = removed.get_workspace();
        this._log.debug('focused window removed — scheduling focus replacement');
        this._sources.idle(() => this._focusNext(removed, workspace));
    }

    /**
     * Focus the front-most (topmost in stacking order) remaining NORMAL,
     * non-minimized, non-sticky window on the active workspace.
     */
    _focusNext(removed, workspace) {
        if (!this._settings.get_boolean('focus-next-on-close')) return;
        try {
            const activeWs = global.workspace_manager.get_active_workspace();
            if (!activeWs || activeWs !== workspace) return;

            // Tab order is MRU, not stacking order, and can include windows
            // demanding attention on other workspaces. Filter those explicitly.
            const candidates = global.display
                .get_tab_list(Meta.TabList.NORMAL_ALL, activeWs)
                .filter(
                    (win) =>
                        !win.minimized &&
                        !this._isSticky(win) &&
                        win !== removed &&
                        win.get_workspace() === workspace &&
                        win.get_window_type() === Meta.WindowType.NORMAL,
                );

            if (candidates.length === 0) {
                this._log.debug('no candidate window to focus after kill');
                return;
            }

            const target = global.display.sort_windows_by_stacking(candidates).at(-1);
            // Mutter may already have focused the correct survivor.
            if (target === global.display.focus_window) return;
            this._log.debug(`focusing front-placed window: "${target.get_title()}"`);
            activeWs.activate_with_focus(target, global.get_current_time());
        } catch (e) {
            this._log.warn(`_focusNext: ${e.message}`);
        }
    }

    /**
     * Check if a window is sticky (present on all workspaces).
     * @param {Meta.Window} win
     * @returns {boolean}
     */
    _isSticky(win) {
        return win.is_on_all_workspaces();
    }
}
