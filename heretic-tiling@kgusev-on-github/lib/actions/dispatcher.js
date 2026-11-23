/**
 * Action dispatcher — applies a merged actions object to a window.
 *
 * The dispatcher is a small class so it can hold the shared context
 * (StickyManager instance + SourceTracker) instead of relying on
 * module-level state.
 */

import Meta from 'gi://Meta';
import {
    actionMoveToWorkspace, actionMoveToMonitor,
    actionMaximize, actionUnmaximize, actionMinimize,
    actionPlace, actionOpacity, actionFocus, actionNoFocus,
} from './windowActions.js';

export class ActionDispatcher {
    /**
     * @param {import('./stickyManager.js').StickyManager}     stickyManager
     * @param {import('../utils/sourceTracker.js').SourceTracker} sources
     */
    constructor(stickyManager, sources, layouts = null) {
        this._layouts = layouts;
        this._generations = new WeakMap();
        this._sticky  = stickyManager;
        this._sources = sources;
    }

    /**
     * Apply the resolved actions object to a window.
     *
     * Actions are dispatched in a deterministic order:
     *   sticky/unstick → move_to_workspace → move_to_monitor
     *   → minimize → floating state / layout assignment → unmanaged maximize/place → opacity → focus
     *   → no_focus
     *
     * Window-type guard: by default only Meta.WindowType.NORMAL windows are
     * processed. Pass opts.allowNonNormal = true (set by the rule engine when
     * a window_type matcher was used) to bypass the guard.
     *
     * @param {Meta.Window} window
     * @param {object}      actions  merged actions from RuleEngine.resolveActions()
     * @param {object}      [opts]
     * @param {number}      [opts.activeWsIndex]   workspace index before the window
     *                                             appeared; -1 = don't restore focus
     * @param {boolean}     [opts.allowNonNormal]  process non-NORMAL windows too
     */
    apply(window, actions, opts = {}) {
        if (!window) return;
        const generation = (this._generations.get(window) ?? 0) + 1;
        this._generations.set(window, generation);

        const { activeWsIndex = -1, allowNonNormal = false } = opts;

        const isNormal = window.window_type === Meta.WindowType.NORMAL;
        if (!isNormal && !allowNonNormal) return;

        // sticky: true → make sticky; sticky: false → remove sticky state
        if (actions.sticky === true)
            this._sticky.stick(window);
        else if (actions.sticky === false)
            this._sticky.unstick(window);

        if (actions.move_to_workspace != null)
            actionMoveToWorkspace(window, actions.move_to_workspace, activeWsIndex);

        if (actions.move_to_monitor != null)
            actionMoveToMonitor(window, actions.move_to_monitor);

        if (actions.minimize) actionMinimize(window);
        const managed = this._layouts?.reconcileWindow(window, actions) ?? false;

        // maximize: true → maximize; maximize: false → unmaximize
        if (!managed && actions.maximize === true)
            actionMaximize(window);
        else if (!managed && actions.maximize === false)
            actionUnmaximize(window);

        // place comes after maximize/minimize so it can override the maximized state
        if (!managed && actions.place != null)
            actionPlace(window, actions.place, this._sources, () =>
                this._generations.get(window) === generation && !this._layouts?.isManaged(window));

        if (actions.opacity != null)
            actionOpacity(window, actions.opacity);

        // focus comes last so the window's final workspace/position is what
        // gets focused; it overrides the previous-workspace restore of
        // move_to_workspace.
        if (actions.focus === true)
            actionFocus(window);

        // no_focus runs after focus: it hands focus back to the previously
        // focused window when this window grabbed it (overlay windows).
        if (actions.no_focus === true)
            actionNoFocus(window, this._sources);
    }
}
