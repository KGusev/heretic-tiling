import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SignalTracker} from './utils/signalTracker.js';
import {SourceTracker} from './utils/sourceTracker.js';

// Meta.Window objects survive extension reloads and screen locks in this session.
const windowWorkspaces = new WeakMap();

/** Mutter supplies real workspaces on the primary display. On other displays,
 * keep windows assigned to a local workspace and minimize only those we hide.
 */
export class MonitorWorkspaces {
    constructor(settings, mutter) {
        this._settings = settings;
        this._mutter = mutter;
        this._signals = new SignalTracker();
        this._sources = new SourceTracker();
        this._pointerMonitor = null;
        this._pointerTimeout = null;
        this._windows = new Map();
        this._hidden = new Set();
        this._scopes = new WeakMap();
        this._monitorKeys = [];
        this._bindings = new Map();
        const bindings = settings.get_string('workspace-monitor-bindings');
        this._hasBindings = Boolean(bindings);
        try {
            for (const [index, key] of Object.entries(JSON.parse(bindings || '{}'))) {
                if (/^\d+$/.test(index) && typeof key === 'string') this._bindings.set(Number(index), key);
            }
        } catch { /* Invalid bindings default to the primary monitor. */ }
        this._placements = new Set();
        this._active = new Map();
        this.onChanged = () => {};
        this.onBindingChanged = () => {};
        try {
            for (const [key, index] of Object.entries(JSON.parse(settings.get_string('monitor-workspaces')))) {
                if (Number.isInteger(index) && index >= 0) this._active.set(key, index);
            }
        } catch { /* Start on workspace 1 if the stored selections are invalid. */ }
    }

    static restoreMutterSetting(settings, mutter) {
        const previous = settings.get_int('previous-primary-only');
        if (previous < 0) return;
        mutter.set_boolean('workspaces-only-on-primary', previous === 1);
        settings.reset('previous-primary-only');
    }

    enable() {
        const primaryOnly = this._mutter.get_boolean('workspaces-only-on-primary');
        if (this._settings.get_int('previous-primary-only') < 0)
            this._settings.set_int('previous-primary-only', Number(primaryOnly));
        this._lastPrimary = global.workspace_manager.get_active_workspace_index();
        this._initialWindows = new WeakMap();
        if (!primaryOnly) {
            for (const window of global.display.list_all_windows()) {
                const workspace = window.get_workspace();
                if (workspace && this.isSecondary(window.get_monitor()))
                    this._initialWindows.set(window, workspace.index());
            }
        }
        this._mutter.set_boolean('workspaces-only-on-primary', true);
        this._signals.connect(global.display, 'window-entered-monitor', (_, monitor, window) =>
            this._updateMonitor(window, monitor));
        this._signals.connect(global.workspace_manager, 'workspace-switched', () => this._nativeSwitched());
        this._signals.connect(global.workspace_manager, 'notify::n-workspaces', () => {
            const count = global.workspace_manager.get_n_workspaces();
            for (const [window, entry] of this._windows) {
                if (entry.index < count) continue;
                entry.index = Math.max(0, count - 1);
                this._remember(window, entry);
            }
            this._updateVisibility();
        });
    }

    isSecondary(monitor) {
        return monitor >= 0 && monitor < Main.layoutManager.monitors.length &&
            monitor !== Main.layoutManager.primaryIndex;
    }

    get currentMonitor() {
        const [x, y] = global.get_pointer();
        const monitor = Main.layoutManager.monitors.find(rect =>
            x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
        return monitor?.index ?? global.display.get_current_monitor();
    }

    canCenterOn(window) {
        return this._pointerMonitor === null || this._pointerMonitor === window.get_monitor();
    }

    _keepPointerOn(monitor) {
        this._pointerMonitor = monitor;
        if (this._pointerTimeout !== null) this._sources.remove(this._pointerTimeout);
        this._pointerTimeout = this._sources.timeout(250, () => {
            this._pointerMonitor = null;
            this._pointerTimeout = null;
        });
    }

    monitorForWorkspace(index) {
        const monitor = this._monitorKeys.indexOf(this._bindings.get(index));
        return monitor >= 0 ? monitor : Main.layoutManager.primaryIndex;
    }

    workspacesOn(monitor) {
        const count = global.workspace_manager.get_n_workspaces();
        return Array.from({length: count}, (_, index) => index)
            .filter(index => this.monitorForWorkspace(index) === monitor);
    }

    get monitors() { return Main.layoutManager.monitors; }

    monitorLabel(monitor) {
        const key = this._monitorKeys[monitor];
        try {
            const [connector, , model] = JSON.parse(key.slice('display:'.length))[0];
            return model ? `${model} (${connector})` : connector;
        } catch {
            return `Monitor ${monitor + 1}`;
        }
    }

    _saveBindings() {
        this._hasBindings = true;
        this._settings.set_string('workspace-monitor-bindings', JSON.stringify(Object.fromEntries(this._bindings)));
    }

    bind(index, monitor) {
        if (!this._validIndex(index) || !this._monitorKeys[monitor]) return false;
        const previous = this.monitorForWorkspace(index);
        if (previous === monitor) return true;
        const primary = Main.layoutManager.primaryIndex;
        if (previous === primary && this.workspacesOn(primary).length === 1) return false;
        const windows = this._windowsIn(index, previous);
        this.onBindingChanged(index, previous, monitor);
        this._bindings.set(index, this._monitorKeys[monitor]);
        this._saveBindings();
        for (const window of windows) this.move(window, index);
        this._nativeSwitched();
        this._updateVisibility();
        this.onChanged();
        return true;
    }

    setMonitorKeys(keys) {
        this._monitorKeys = keys;
        if (!this._hasBindings) {
            const available = this.workspacesOn(Main.layoutManager.primaryIndex).filter(index => index !== 0);
            for (const monitor of this.monitors) {
                if (this.isSecondary(monitor.index) && available.length)
                    this._bindings.set(available.shift(), keys[monitor.index]);
            }
            if (this._bindings.size) this._saveBindings();
        }
        for (const window of this._windows.keys()) this._updateMonitor(window, window.get_monitor());
        this._nativeSwitched();
        this._updateVisibility();
        this.onChanged();
    }

    activeIndex(monitor) {
        const wm = global.workspace_manager;
        if (!this.isSecondary(monitor)) return wm.get_active_workspace_index();
        const selected = this._active.get(this._monitorKeys[monitor]);
        return this.monitorForWorkspace(selected) === monitor ? selected : this.workspacesOn(monitor)[0] ?? -1;
    }

    _nativeSwitched() {
        const wm = global.workspace_manager;
        const index = wm.get_active_workspace_index();
        if (!this.isSecondary(this.monitorForWorkspace(index))) {
            this._lastPrimary = index;
            return;
        }
        // Native GNOME workspace gestures and overview can still select any number.
        this._sources.idle(() => {
            if (wm.get_active_workspace_index() !== index) return;
            const primary = Main.layoutManager.primaryIndex;
            const local = this.workspacesOn(primary);
            const fallback = local.includes(this._lastPrimary) ? this._lastPrimary : local[0];
            if (fallback !== undefined) wm.get_workspace_by_index(fallback).activate(global.get_current_time());
            this.activateWorkspace(index);
        });
    }

    scope(workspace, monitor) {
        if (!workspace || !this.isSecondary(monitor)) return workspace;
        const key = this._monitorKeys[monitor];
        if (!key) return null;
        let scopes = this._scopes.get(workspace);
        if (!scopes) {
            scopes = new Map();
            this._scopes.set(workspace, scopes);
        }
        let scope = scopes.get(key);
        if (!scope) {
            scope = {
                native: workspace,
                monitorKey: key,
                get layoutKey() { return JSON.stringify([key, workspace.index() + 1]); },
                index: () => workspace.index(),
                get_work_area_for_monitor: m => workspace.get_work_area_for_monitor(m),
            };
            scopes.set(key, scope);
        }
        return scope;
    }

    monitorForScope(scope) { return this._monitorKeys.indexOf(scope.monitorKey); }

    scopeForWindow(window) {
        const monitor = window.get_monitor();
        if (!this.isSecondary(monitor)) return window.get_workspace();
        const entry = this._windows.get(window);
        return entry && entry.monitor === monitor
            ? this.scope(global.workspace_manager.get_workspace_by_index(entry.index), monitor)
            : null;
    }

    windowsAt(monitor, index) {
        return [...this._windows].filter(([, entry]) => entry.monitor === monitor && entry.index === index)
            .map(([window]) => window);
    }

    track(window, actions) {
        // Explicit sticky rules and attached dialogs retain Mutter's behavior.
        const eligible = window.window_type === Meta.WindowType.NORMAL && !window.get_transient_for() &&
            window.can_minimize() && actions.sticky !== true;
        if (!eligible) {
            if (this._windows.has(window)) this._forget(window, true);
            return;
        }
        let entry = this._windows.get(window);
        const alreadyTracked = Boolean(entry);
        if (!entry) {
            entry = {monitor: -1, index: 0, ruleIndex: null};
            this._windows.set(window, entry);
            this._signals.connect(window, 'unmanaged', () => this._forget(window, false));
            this._signals.connect(window, 'workspace-changed', () => {
                if (this._placements.has(window) || this.isSecondary(window.get_monitor())) return;
                const index = window.get_workspace()?.index();
                if (this._validIndex(index) && this.monitorForWorkspace(index) !== window.get_monitor())
                    this.move(window, index);
            });
            this._signals.connect(window, 'notify::minimized', () => {
                // Selecting a parked window from the app switcher reveals its workspace.
                if (!window.minimized && this._hidden.delete(window))
                    this.activateWorkspace(entry.index);
            });
        }
        const ruleIndex = Number.isInteger(actions.move_to_workspace) ? actions.move_to_workspace : null;
        const ruleChanged = entry.ruleIndex !== ruleIndex;
        entry.ruleIndex = ruleIndex;
        this._updateMonitor(window, window.get_monitor());
        if (alreadyTracked && ruleChanged && this.isSecondary(entry.monitor) && this._validIndex(ruleIndex)) {
            this.move(window, ruleIndex);
        }
    }

    _remember(window, entry) {
        if (entry.monitorKey && this.isSecondary(entry.monitor))
            windowWorkspaces.set(window, {key: entry.monitorKey, index: entry.index});
    }

    _forget(window, restore) {
        windowWorkspaces.delete(window);
        this._signals.disconnectObject(window);
        this._windows.delete(window);
        const hidden = this._hidden.delete(window);
        if (!restore) return;
        if (hidden) window.unminimize();
        this.onChanged();
    }

    _updateMonitor(window, monitor) {
        const entry = this._windows.get(window);
        if (!entry || this._placements.has(window)) return;
        const key = this._monitorKeys[monitor];
        if (!key || (entry.monitor === monitor && entry.monitorKey === key)) return;
        const firstPlacement = entry.monitor < 0;
        const remembered = windowWorkspaces.get(window);
        const initial = remembered?.key === key ? remembered.index : this._initialWindows.get(window);
        this._initialWindows.delete(window);
        const native = window.get_workspace()?.index();
        const active = this.activeIndex(monitor);
        let index = this.isSecondary(monitor) ? active : native;
        if (firstPlacement && this._validIndex(initial) && this.monitorForWorkspace(initial) === monitor)
            index = initial;
        if (firstPlacement && this._validIndex(entry.ruleIndex)) index = entry.ruleIndex;
        if (!this._validIndex(index)) index = global.workspace_manager.get_active_workspace_index();
        this.move(window, index);
    }

    _validIndex(index) {
        return Number.isInteger(index) && index >= 0 && index < global.workspace_manager.get_n_workspaces();
    }

    _windowsIn(index, monitor) {
        if (this.isSecondary(monitor)) return this.windowsAt(monitor, index);
        return (global.workspace_manager.get_workspace_by_index(index)?.list_windows() ?? [])
            .filter(window => window.get_monitor() === monitor && !window.is_on_all_workspaces());
    }

    activateWorkspace(index) {
        if (!this._validIndex(index)) return false;
        const monitor = this.monitorForWorkspace(index);
        const rect = this.monitors[monitor];
        if (!rect) return false;
        const time = global.get_current_time();
        this._keepPointerOn(monitor);
        if (this.isSecondary(monitor)) {
            const key = this._monitorKeys[monitor];
            this._active.set(key, index);
            this._settings.set_string('monitor-workspaces', JSON.stringify(Object.fromEntries(this._active)));
            this._updateVisibility(monitor);
        }

        const candidates = this._windowsIn(index, monitor).filter(window => !window.minimized);
        const target = global.display.sort_windows_by_stacking(candidates).at(-1);
        if (target && this.isSecondary(monitor)) target.activate(time);
        else if (!this.isSecondary(monitor)) {
            const workspace = global.workspace_manager.get_workspace_by_index(index);
            if (target) workspace.activate_with_focus(target, time);
            else workspace.activate(time);
        }
        if (this.currentMonitor !== monitor) {
            Clutter.get_default_backend().get_default_seat().warp_pointer(
                Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
        }
        this.onChanged();
        return true;
    }

    move(window, index) {
        const entry = this._windows.get(window);
        if (!entry || !this._validIndex(index)) return false;
        const monitor = this.monitorForWorkspace(index);
        const previous = entry.monitor;
        this._placements.add(window);
        try {
            if (window.get_monitor() !== monitor) window.move_to_monitor(monitor);
            if (!this.isSecondary(monitor)) {
                if (this._hidden.delete(window)) window.unminimize();
                const workspace = global.workspace_manager.get_workspace_by_index(index);
                if (window.get_workspace() !== workspace) window.change_workspace(workspace);
                windowWorkspaces.delete(window);
            }
            entry.monitor = monitor;
            entry.monitorKey = this._monitorKeys[monitor];
            entry.index = index;
            this._remember(window, entry);
        } finally {
            this._placements.delete(window);
        }
        this._updateVisibility(monitor);
        if (previous !== monitor && previous >= 0) this._updateVisibility(previous);
        this.onChanged();
        return true;
    }

    ownsMinimize(window) { return this._hidden.has(window); }

    _updateVisibility(monitor = null) {
        for (const [window, entry] of this._windows) {
            if (!this.isSecondary(entry.monitor) || !entry.monitorKey ||
                (monitor !== null && entry.monitor !== monitor)) continue;
            const visible = entry.index === this.activeIndex(entry.monitor);
            if (!visible && !window.minimized) {
                this._hidden.add(window);
                window.minimize();
            } else if (visible && this._hidden.delete(window)) {
                window.unminimize();
            }
        }
    }

    destroy() {
        this._signals.disconnectAll();
        this._sources.clearAll();
        for (const window of this._hidden) window.unminimize();
        this._hidden.clear();
        this._windows.clear();
        MonitorWorkspaces.restoreMutterSetting(this._settings, this._mutter);
    }
}
