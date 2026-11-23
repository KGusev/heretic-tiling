/**
 * WindowTracker — applies rules to windows as they appear and change.
 *
 * Responsibilities:
 *  - Apply rules to already-open windows on enable (shell restart survival)
 *  - Watch 'window-created' and apply rules once wm_class becomes available
 *    (flat, tracked retry loop — up to ~2 s)
 *  - Attach notify::title monitors when any rule uses a wm_title matcher,
 *    re-applying rules on title changes (browsers, terminals, IDEs)
 *
 * All GLib sources and GObject signals are tracked and torn down in destroy().
 */

import Meta from 'gi://Meta';
import {Logger} from './logger.js';
import {SignalTracker} from './utils/signalTracker.js';

/** Max wm_class polls after window creation (100 ms apart → ~2 s). */
const WM_CLASS_RETRIES = 20;
const WM_CLASS_RETRY_MS = 100;

export class WindowTracker {
    /**
     * @param {import('./rules/ruleEngine.js').RuleEngine}         ruleEngine
     * @param {import('./actions/dispatcher.js').ActionDispatcher} dispatcher
     * @param {import('./utils/sourceTracker.js').SourceTracker}   sources
     */
    constructor(ruleEngine, dispatcher, sources) {
        this._ruleEngine = ruleEngine;
        this._dispatcher = dispatcher;
        this._sources = sources;
        this._signals = new SignalTracker();
        this._log = new Logger('WindowTracker');

        /**
         * Windows that already have a title monitor attached.
         * @type {Set<Meta.Window>}
         */
        this._titleMonitored = new Set();

        this._destroyed = false;
    }

    /** Start listening for new windows and process the existing ones. */
    enable() {
        this._signals.connect(global.display, 'window-created', (_display, window) =>
            this._onWindowCreated(window),
        );
        this._unsubscribe = this._ruleEngine.onReload(() => this._applyToExistingWindows());
        this._applyToExistingWindows();
    }

    /** Disconnect everything. Pending sources are cleared by the shared tracker owner. */
    destroy() {
        this._destroyed = true;
        this._unsubscribe?.();
        this._signals.disconnectAll();
        this._titleMonitored.clear();
    }

    // ------------------------------------------------------------- internal

    /**
     * Apply rules to every window that is already open.
     * Needed so windows survive a shell restart without losing their state.
     */
    _applyToExistingWindows() {
        // Deduplicate with a Set: sticky windows appear in list_windows() for
        // every workspace, so without deduplication they would get rules
        // applied N times.
        const seen = new Set();
        const wsManager = global.workspace_manager;
        const nWs = wsManager.get_n_workspaces();
        for (let i = 0; i < nWs; i++) {
            const ws = wsManager.get_workspace_by_index(i);
            if (!ws) continue;
            for (const window of ws.list_windows()) {
                if (seen.has(window)) continue;
                seen.add(window);
            }
        }
        const mru = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
        const rank = new Map(mru.map((w, i) => [w, i]));
        const ordered = [...seen].sort(
            (a, b) =>
                (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) ||
                a.get_stable_sequence() - b.get_stable_sequence(),
        );
        for (const window of ordered) this._applyRules(window, -1);
    }

    /**
     * Handle a newly created window: poll until wm_class is set (it may not
     * be immediately after creation), then apply rules once.
     *
     * @param {Meta.Window} window
     */
    _onWindowCreated(window) {
        // Track destroyed state via an 'unmanaged' guard so the retry closure
        // doesn't operate on a half-destroyed GObject. The connection is made
        // through the SignalTracker, so destroy() cleans it up even when the
        // retry loop never completes.
        let windowGone = false;
        const guardSid = this._signals.connect(window, 'unmanaged', () => {
            windowGone = true;
        });

        let attemptsLeft = WM_CLASS_RETRIES;
        const tryApply = () => {
            if (this._destroyed || windowGone) {
                this._signals.disconnect(window, guardSid);
                return;
            }

            if (window.get_wm_class()) {
                // Capture the active workspace index now, not at signal-fire time.
                const activeWsIndex = global.workspace_manager.get_active_workspace_index();
                this._applyRules(window, activeWsIndex);
                this._signals.disconnect(window, guardSid);
                return;
            }

            if (attemptsLeft-- > 0) this._sources.timeout(WM_CLASS_RETRY_MS, tryApply);
            else {
                this._applyRules(window);
                this._signals.disconnect(window, guardSid);
            }
        };

        this._sources.idle(tryApply);
    }

    /**
     * Resolve and execute all matching rules for a single window.
     * Also sets up a notify::title signal if any rule uses a wm_title matcher.
     *
     * @param {Meta.Window} window
     * @param {number}      activeWsIndex  workspace index before the window appeared;
     *                                     -1 means "don't restore focus after move"
     */
    _applyRules(window, activeWsIndex = -1) {
        const {actions, allowNonNormal} = this._ruleEngine.resolveActions(window);
        this._dispatcher.apply(window, actions, {activeWsIndex, allowNonNormal});

        this._connectTitleMonitor(window);
    }

    /**
     * Connect a notify::title signal to the window so rules are re-applied
     * whenever the title changes. Safe to call multiple times for the same
     * window — only one handler is attached.
     *
     * @param {Meta.Window} window
     */
    _connectTitleMonitor(window) {
        if (this._titleMonitored.has(window)) return;

        this._signals.connect(window, 'notify::title', () => {
            if (this._destroyed || !this._ruleEngine.hasTitleRules()) return;
            this._log.debug(`title changed: "${window.get_title()}" — re-applying rules`);
            const {actions, allowNonNormal} = this._ruleEngine.resolveActions(window);
            this._dispatcher.apply(window, actions, {activeWsIndex: -1, allowNonNormal});
        });

        // Clean up when the window is destroyed. Both handlers are tracked,
        // so destroy() also disconnects them for still-alive windows.
        this._signals.connect(window, 'unmanaged', () => {
            this._signals.disconnectObject(window);
            this._titleMonitored.delete(window);
        });

        this._titleMonitored.add(window);
    }
}
