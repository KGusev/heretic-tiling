/**
 * Window action handlers — stateless.
 *
 * Each exported function represents one action that a rule can trigger.
 * Sticky handling lives in stickyManager.js; dispatching in dispatcher.js.
 *
 * Adding a new action:
 *   1. Export a new function here (or a method on StickyManager for stateful ones).
 *   2. Add the key to ACTION_KEYS in lib/rules/schema.js and to the validator.
 *   3. Add a dispatch branch in lib/actions/dispatcher.js.
 */

import Meta from 'gi://Meta';
import {Logger} from '../logger.js';
import {PLACE_PRESETS} from '../rules/schema.js';

const _log = new Logger('WindowActions');

// GNOME 50 renamed the flags getter and made maximize/unmaximize parameterless.
export function getMaximizeFlags(window) {
    return window.get_maximize_flags?.() ?? window.get_maximized();
}

export function maximizeWindow(window) {
    if (window.get_maximize_flags) window.maximize();
    else window.maximize(Meta.MaximizeFlags.BOTH);
}

export function unmaximizeWindow(window) {
    if (window.get_maximize_flags) window.unmaximize();
    else window.unmaximize(Meta.MaximizeFlags.BOTH);
}

/**
 * Move the window to a specific workspace by 0-based index.
 *
 * @param {Meta.Window} window
 * @param {number}      targetWsIndex   0-based workspace index
 * @param {number}      activeWsIndex   workspace the user was on before;
 *                                      pass -1 to skip the focus-restore step
 */
export function actionMoveToWorkspace(window, targetWsIndex, activeWsIndex = -1) {
    try {
        const wsManager = global.workspace_manager;
        if (targetWsIndex < 0 || targetWsIndex >= wsManager.get_n_workspaces()) {
            _log.warn(`actionMoveToWorkspace: index ${targetWsIndex} out of range`);
            return;
        }

        const workspace = wsManager.get_workspace_by_index(targetWsIndex);
        if (!workspace) return;

        window.change_workspace(workspace);
        _log.debug(`moved "${window.get_title()}" → workspace ${targetWsIndex}`);

        // Restore the user's original workspace so GNOME doesn't auto-switch
        // away when a background app opens a window on a different workspace.
        if (activeWsIndex >= 0 && targetWsIndex !== activeWsIndex) {
            const activeWorkspace = wsManager.get_workspace_by_index(activeWsIndex);
            if (activeWorkspace) activeWorkspace.activate(global.get_current_time());
        }
    } catch (e) {
        _log.warn(`actionMoveToWorkspace: ${e.message}`);
    }
}

/**
 * Move the window to a specific monitor by 0-based index.
 *
 * @param {Meta.Window} window
 * @param {number|string} target  0-based monitor index, or "primary"
 */
export function actionMoveToMonitor(window, target) {
    try {
        const monitorIndex = target === 'primary' ? global.display.get_primary_monitor() : target;

        const nMonitors = global.display.get_n_monitors();
        if (monitorIndex < 0 || monitorIndex >= nMonitors) {
            _log.warn(
                `actionMoveToMonitor: index ${monitorIndex} out of range (${nMonitors} monitors)`,
            );
            return;
        }

        window.move_to_monitor(monitorIndex);
        _log.debug(`moved "${window.get_title()}" → monitor ${monitorIndex}`);
    } catch (e) {
        _log.warn(`actionMoveToMonitor: ${e.message}`);
    }
}

/**
 * Maximize the window (both axes) if the window type allows it.
 * @param {Meta.Window} window
 */
export function actionMaximize(window) {
    try {
        if (window.can_maximize()) {
            maximizeWindow(window);
            _log.debug(`actionMaximize: "${window.get_title()}"`);
        }
    } catch (e) {
        _log.warn(`actionMaximize: ${e.message}`);
    }
}

/**
 * Unmaximize the window (both axes).
 * @param {Meta.Window} window
 */
export function actionUnmaximize(window) {
    try {
        unmaximizeWindow(window);
        _log.debug(`actionUnmaximize: "${window.get_title()}"`);
    } catch (e) {
        _log.warn(`actionUnmaximize: ${e.message}`);
    }
}

/**
 * Minimize the window.
 * @param {Meta.Window} window
 */
export function actionMinimize(window) {
    try {
        if (window.can_minimize()) {
            window.minimize();
            _log.debug(`actionMinimize: "${window.get_title()}"`);
        }
    } catch (e) {
        _log.warn(`actionMinimize: ${e.message}`);
    }
}

/**
 * Position and resize the window relative to its monitor's work area.
 *
 * @param {Meta.Window}   window
 * @param {string|object} descriptor  Named preset string or
 *                                    { x, y, width, height } fractions (0.0–1.0)
 * @param {import('../utils/sourceTracker.js').SourceTracker} sources
 *                                    Tracker for the deferred resize idle source.
 */
export function actionPlace(window, descriptor, sources, shouldApply = () => true) {
    try {
        let frac;
        if (typeof descriptor === 'string') {
            frac = PLACE_PRESETS[descriptor];
            if (!frac) {
                _log.warn(`actionPlace: unknown preset "${descriptor}"`);
                return;
            }
        } else {
            frac = descriptor;
        }

        // Unmaximize first so move_resize_frame takes effect.
        if (getMaximizeFlags(window)) unmaximizeWindow(window);

        // Wait one idle tick so Mutter processes the unmaximize before resize.
        // The source is tracked so it is cancelled on extension disable.
        sources.idle(() => {
            try {
                if (!shouldApply()) return;
                const monitorIndex = window.get_monitor();
                const area = window.get_work_area_for_monitor(monitorIndex);

                const x = Math.round(area.x + frac.x * area.width);
                const y = Math.round(area.y + frac.y * area.height);
                const width = Math.round(frac.width * area.width);
                const height = Math.round(frac.height * area.height);

                window.move_resize_frame(false, x, y, width, height);
                _log.debug(
                    `actionPlace: "${window.get_title()}" → ` +
                        `[${x},${y} ${width}×${height}] on monitor ${monitorIndex}`,
                );
            } catch (e) {
                _log.warn(`actionPlace (idle): ${e.message}`);
            }
        });
    } catch (e) {
        _log.warn(`actionPlace: ${e.message}`);
    }
}

/**
 * Focus (activate) the window, switching to its workspace if necessary.
 * Dispatched last so it acts on the window's final workspace/position;
 * it deliberately overrides the "restore previous workspace" behaviour of
 * move_to_workspace.
 *
 * @param {Meta.Window} window
 */
export function actionFocus(window) {
    try {
        const ws = window.get_workspace();
        if (ws) ws.activate_with_focus(window, global.get_current_time());
        else window.activate(global.get_current_time());
        _log.debug(`actionFocus: "${window.get_title()}"`);
    } catch (e) {
        _log.warn(`actionFocus: ${e.message}`);
    }
}

/**
 * Prevent the window from keeping focus: if it grabbed focus, hand focus back
 * to the most-recently-used other window on the active workspace.
 *
 * Intended for overlay windows (e.g. Zoom's "annotate_toolbar") that are
 * created full-screen and always-on-top but must not steal focus from the
 * window the user is working in.
 *
 * The refocus is deferred to an idle callback so Mutter finishes the focus
 * sequence for the newly created window first. It is a no-op when the window
 * did not actually take focus (e.g. it was created on a background workspace).
 *
 * @param {Meta.Window} window
 * @param {import('../utils/sourceTracker.js').SourceTracker} sources
 *                                    Tracker for the deferred idle source.
 */
export function actionNoFocus(window, sources) {
    sources.idle(() => {
        try {
            // Only act if the window actually stole focus.
            if (global.display.focus_window !== window) {
                _log.debug(`actionNoFocus: "${window.get_title()}" did not take focus`);
                return;
            }

            const activeWs = global.workspace_manager.get_active_workspace();
            if (!activeWs) return;

            // Most-recently-used other window on the active workspace.
            const candidates = activeWs
                .list_windows()
                .filter(
                    (win) =>
                        win !== window &&
                        win.window_type === Meta.WindowType.NORMAL &&
                        !win.minimized &&
                        !win.is_on_all_workspaces(),
                )
                .sort((a, b) => b.get_user_time() - a.get_user_time());

            if (candidates.length === 0) {
                _log.debug('actionNoFocus: no other window to focus');
                return;
            }

            const target = candidates[0];
            activeWs.activate_with_focus(target, global.get_current_time());
            _log.debug(`actionNoFocus: refocused "${target.get_title()}"`);
        } catch (e) {
            _log.warn(`actionNoFocus: ${e.message}`);
        }
    });
}

/**
 * Set per-window compositor opacity.
 *
 * @param {Meta.Window} window
 * @param {number}      value   Opacity fraction 0.0 (transparent) – 1.0 (opaque)
 */
export function actionOpacity(window, value) {
    try {
        const actor = window.get_compositor_private();
        if (!actor) {
            _log.warn(`actionOpacity: no compositor actor for "${window.get_title()}"`);
            return;
        }
        actor.opacity = Math.round(Math.max(0, Math.min(1, value)) * 255);
        _log.debug(`actionOpacity: "${window.get_title()}" → ${value}`);
    } catch (e) {
        _log.warn(`actionOpacity: ${e.message}`);
    }
}
