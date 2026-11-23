import Meta from 'gi://Meta';
import {LayoutPersistence, restoreWeights} from './persistence.js';
import {MonitorIdentity} from './monitorIdentity.js';
import {directionalNeighbour} from './navigation.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SignalTracker} from '../utils/signalTracker.js';
import {SourceTracker} from '../utils/sourceTracker.js';
import {Logger} from '../logger.js';
import {getMaximizeFlags, maximizeWindow, unmaximizeWindow} from '../actions/windowActions.js';
import {BUILTINS, LayoutTree, slots, geometry, resizeWindow} from './model.js';
import {LayoutOverlay} from './overlay.js';

export class LayoutManager {
    constructor(settings, mutterSettings, engine, workspaces = null) {
        this._default = settings.get_string('default-layout');
        this._settings = settings;
        this._persistence = new LayoutPersistence(settings);
        this._monitorIdentity = new MonitorIdentity();
        this._monitorKeys = null;
        this._mutter = mutterSettings;
        this._engine = engine;
        this._workspaces = workspaces;
        this._catalog = engine.layouts;
        this._workspaceLayouts = engine.workspaceLayouts ?? {};
        this._states = new Map();
        this._windows = new Map();
        this._signals = new SignalTracker();
        this._sources = new SourceTracker();
        this._pending = new Set();
        this._layoutSource = null;
        this._auto = new Set();
        this._ownedMaximize = new Set();
        this._requests = new Map();
        this._log = new Logger('LayoutManager');
        this._overlay = new LayoutOverlay(workspace => {
            const ws = workspace ?? this.activeWorkspace();
            if (ws) this._save(ws, this._state(ws));
            this.queueAll();
        }, window => !window.minimized && this.isManaged(window));
        this._destroyed = false;
    }
    enable() {
        const refresh = () => { this._overlay.cancel(); this.queueAll(); };
        this._signals.connect(global.workspace_manager, 'workspace-switched', refresh);
        this._signals.connect(global.workspace_manager, 'notify::n-workspaces', refresh);
        this._signals.connect(global.display, 'workareas-changed', refresh);
        this._signals.connect(global.display, 'window-entered-monitor', refresh);
        this._signals.connect(global.display, 'window-left-monitor', refresh);
        this._signals.connect(global.display, 'grab-op-begin', (_, window) => {
            this._grabbed = window;
            this._overlay.cancel();
        });
        this._signals.connect(global.display, 'grab-op-end', (_, window) => {
            this._grabbed = null;
            this._requests.delete(window);
            refresh();
        });
        this._signals.connect(Main.layoutManager, 'monitors-changed', () => this._refreshMonitors());
        this._signals.connect(this._settings, 'changed::persist-layouts', () => {
            if (this._persistence.enabled) this._saveAll();
        });
        this._signals.connect(this._mutter, 'changed::workspaces-only-on-primary', refresh);
        for (const signal of ['showing', 'hidden']) this._signals.connect(Main.overview, signal, refresh);
        this._signals.connect(Main.sessionMode, 'updated', refresh);
        this._signals.connect(global.display, 'in-fullscreen-changed', refresh);
        this._refreshMonitors();
    }
    _refreshMonitors() {
        this._overlay.cancel();
        this._monitorKeys = null;
        this._overlay.update([]);
        this._monitorIdentity.refresh(Main.layoutManager.monitors, keys => {
            this._monitorKeys = keys;
            this._workspaces?.setMonitorKeys(keys);
            for (const state of this._states.values()) state.trees.clear();
            this._requests.clear();
            this.queueAll();
        });
    }
    activeWorkspace(monitor = this._workspaces?.currentMonitor) {
        const wm = global.workspace_manager;
        if (!this._workspaces?.isSecondary(monitor)) return wm.get_active_workspace();
        return this.workspaceAt(this._workspaces.activeIndex(monitor), monitor);
    }
    workspaceAt(index, monitor) {
        if (index < 0) return null;
        const native = global.workspace_manager.get_workspace_by_index(index);
        return this._workspaces ? this._workspaces.scope(native, monitor) : native;
    }
    transferWorkspaceLayout(index, previous, monitor) {
        if (!this._persistence.enabled || !this._monitorKeys) return;
        const source = this.workspaceAt(index, previous);
        const destination = this.workspaceAt(index, monitor);
        if (!source || !destination) return;
        const state = this._states.get(source);
        if (state) this._save(source, state);
        const saved = this._saved(source);
        if (!saved) return;
        const weights = saved.monitors?.[this._monitorKeys[previous]];
        this._persistence.copy(destination, this._defaults(destination), saved,
            this._monitorKeys[monitor], weights);
        this._states.delete(destination);
    }
    _windowWorkspace(window) {
        return this._workspaces ? this._workspaces.scopeForWindow(window) : window.get_workspace();
    }
    _layoutWorkspaces() {
        const wm = global.workspace_manager;
        const native = Array.from({length: wm.get_n_workspaces()}, (_, i) => wm.get_workspace_by_index(i));
        if (!this._workspaces) return native;
        return native.map(ws => this._workspaces.scope(ws, this._workspaces.monitorForWorkspace(ws.index())))
            .filter(Boolean);
    }
    _workspaceHasMonitor(workspace, monitor) {
        if (!this._workspaces) return true;
        return workspace.native ? this._workspaces.monitorForScope(workspace) === monitor
            : !this._workspaces.isSecondary(monitor);
    }
    _workspaceVisible(workspace) {
        if (!workspace.native) return true;
        const monitor = this._workspaces.monitorForScope(workspace);
        return monitor >= 0 && this._workspaces.activeIndex(monitor) === workspace.index();
    }
    get presets() { return [...BUILTINS, ...Object.keys(this._catalog)]; }
    _workspaceDefault(workspace) {
        const name = this._workspaceLayouts[String(workspace.index() + 1)] ?? this._default;
        return this.presets.includes(name) ? name : 'hbox';
    }
    _state(workspace) {
        let state = this._states.get(workspace);
        if (!state) {
            const saved = this._saved(workspace);
            state = {preset: saved?.preset ?? this._workspaceDefault(workspace), trees: new Map()};
            this._states.set(workspace, state);
        }
        return state;
    }
    _defaults(workspace) {
        return JSON.stringify([this._default, this._workspaceLayouts[String(workspace.index() + 1)] ?? null]);
    }
    _definitions() { return {none: null, hbox: null, vbox: null, ...this._catalog}; }
    _saved(workspace) {
        const saved = this._persistence.get(workspace, this._defaults(workspace), this._definitions());
        // Older configurations stored secondary split weights alongside the primary preset.
        if (saved || !workspace.native || this._persistence.has(workspace)) return saved;
        return this._persistence.get(workspace.native, this._defaults(workspace), this._definitions());
    }
    _save(workspace, state) {
        if (!this._monitorKeys) return;
        const trees = [];
        for (const [monitor, tree] of state.trees) {
            if (slots(tree.root).filter(slot => slot.window).length < 2) continue;
            tree.savedWeights = null;
            trees.push([this._monitorKeys[monitor], tree]);
        }
        this._persistence.save(workspace, this._defaults(workspace), state.preset,
            this._definitions()[state.preset], trees);
    }
    _saveAll() { for (const [ws, state] of this._states) this._save(ws, state); }
    resetLayout(workspace) {
        this.applyPreset(workspace, this._workspaceDefault(workspace));
        if (!workspace.native) this._persistence.clear(workspace);
    }
    getActivePreset(workspace) { return this._state(workspace).preset; }
    applyPreset(workspace, name) {
        if (!workspace) return;
        this._overlay.cancel();
        const state = this._state(workspace);
        state.preset = this.presets.includes(name) ? name : 'hbox';
        state.trees.clear();
        if (this._persistence.enabled) {
            this._persistence.clear(workspace);
            this._save(workspace, state);
        }
        this._requests.clear();
        this.queueRelayout(workspace);
    }
    reload() {
        this._overlay.cancel();
        const old = this._catalog;
        this._catalog = this._engine.layouts;
        const oldMapping = this._workspaceLayouts;
        this._workspaceLayouts = this._engine.workspaceLayouts ?? {};
        for (const [ws, state] of this._states) {
            const key = String(ws.index() + 1);
            if (oldMapping[key] !== this._workspaceLayouts[key]) {
                this.applyPreset(ws, this._workspaceDefault(ws));
                continue;
            }
            if (!this.presets.includes(state.preset)) { this.applyPreset(ws, 'hbox'); continue; }
            if (JSON.stringify(old[state.preset]) === JSON.stringify(this._catalog[state.preset])) continue;
            if (this._persistence.enabled) this._persistence.clear(ws);
            for (const [monitor, tree] of state.trees) {
                const next = new LayoutTree(state.preset, this._catalog[state.preset]);
                for (const slot of slots(next.root)) {
                    if (slot.name) slot.window = slots(tree.root).find(s => s.name === slot.name)?.window;
                }
                state.trees.set(monitor, next);
            }
        }
        this._requests.clear();
        this.queueAll();
    }
    _eligible(window) {
        const secondary = this._workspaces?.isSecondary(window.get_monitor());
        const eligibleWorkspace = secondary ? Boolean(this._windowWorkspace(window))
            : !window.is_on_all_workspaces() && !(this._mutter.get_boolean('workspaces-only-on-primary') &&
                window.get_monitor() !== Main.layoutManager.primaryIndex);
        // Interactive resize is unavailable while a window is maximized.
        return eligibleWorkspace && window.window_type === Meta.WindowType.NORMAL && window.resizeable &&
            !window.get_transient_for() && !window.is_above() && !window.is_fullscreen() &&
            (!window.minimized || this._workspaces?.ownsMinimize(window));
    }
    reconcileWindow(window, actions = {}) {
        if (this._destroyed) return false;
        this._workspaces?.track(window, actions);
        if (!this._windows.has(window)) {
            this._windows.set(window, actions);
            for (const signal of ['workspace-changed', 'notify::minimized', 'notify::fullscreen',
                'notify::above', 'notify::on-all-workspaces', 'notify::maximized-horizontally',
                'notify::maximized-vertically', 'notify::resizeable'])
                this._signals.connect(window, signal, () => this.queueAll());
            this._signals.connect(window, 'shown', () => {
                this._requests.delete(window);
                this.queueAll();
            });
            this._signals.connect(window, 'size-changed', () => {
                const requested = this._requests.get(window);
                if (requested && !this._same(window.get_frame_rect(), requested) && !requested.warned) {
                    requested.warned = true;
                    this._log.debug('Client constrained requested layout size; retaining its result');
                }
            });
            this._signals.connect(window, 'unmanaged', () => {
                this._windows.delete(window);
                this._requests.delete(window);
                this._auto.delete(window);
                this._ownedMaximize.delete(window);
                this._signals.disconnectObject(window);
                this.queueAll();
            });
        }
        this._windows.set(window, actions);
        // Membership is synchronous so the dispatcher can suppress competing geometry.
        this._sync();
        this.queueAll();
        return this.isManaged(window);
    }
    isManaged(window) {
        if (!this._windows.has(window) || !this._eligible(window)) return false;
        const state = this._states.get(this._windowWorkspace(window));
        return Boolean(state?.trees.get(window.get_monitor())?.has(window));
    }
    resizeDirection(direction) {
        const window = global.display.focus_window;
        if (!window || !this.isManaged(window)) return;
        const workspace = this._windowWorkspace(window);
        if (workspace !== this.activeWorkspace(window.get_monitor())) return;
        this._overlay.cancel();
        const tree = this._states.get(workspace).trees.get(window.get_monitor());
        if (resizeWindow(tree.root, workspace.get_work_area_for_monitor(window.get_monitor()), window, direction,
            this._settings.get_int('resize-grid-step'))) {
            this._save(workspace, this._state(workspace));
            this.queueRelayout(workspace);
        }
    }
    moveDirection(direction) {
        const source = global.display.focus_window;
        const target = this._directionTarget(source, direction, true);
        if (!target) return;
        this._overlay.cancel();
        const workspace = this._windowWorkspace(source);
        const tree = this._states.get(workspace).trees.get(source.get_monitor());
        const all = slots(tree.root);
        const from = all.find(s => s.window === source), to = all.find(s => s.window === target);
        [from.window, to.window] = [to.window, from.window];
        this._requests.delete(source);
        this._requests.delete(target);
        this.queueRelayout(workspace);
    }
    focusDirection(direction) {
        const target = this._directionTarget(global.display.focus_window, direction);
        if (!target) return;
        target.activate(global.get_current_time());

    }
    _directionTarget(source, direction, sameMonitor = false) {
        if (!source || !this.isManaged(source) ||
            this._windowWorkspace(source) !== this.activeWorkspace(source.get_monitor())) return;
        const candidates = [...this._windows.keys()]
            .filter(w => w !== source && !w.minimized && this.isManaged(w) &&
                this._windowWorkspace(w) === this.activeWorkspace(w.get_monitor()) &&
                (!sameMonitor || w.get_monitor() === source.get_monitor()))
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence())
            .map(window => ({window, rect: window.get_frame_rect()}));
        return directionalNeighbour(source.get_frame_rect(), candidates, direction);
    }
    _sync() {
        if (!this._monitorKeys) return;
        const workspaces = new Set(this._layoutWorkspaces());
        for (const ws of this._states.keys()) if (!workspaces.has(ws)) this._states.delete(ws);
        for (const ws of workspaces) {
            const state = this._state(ws);
            if (state.preset === 'none') continue;
            const mru = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, ws.native ?? ws);
            const rank = new Map(mru.map((w, i) => [w, i]));
            const windows = [...this._windows.keys()].filter(w => this._windowWorkspace(w) === ws && this._eligible(w))
                .sort((a, b) => ((rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity)) ||
                    a.get_stable_sequence() - b.get_stable_sequence());
            for (let monitor = 0; monitor < Main.layoutManager.monitors.length; monitor++) {
                if (!this._workspaceHasMonitor(ws, monitor)) continue;
                let tree = state.trees.get(monitor);
                if (!tree) {
                    tree = new LayoutTree(state.preset, this._catalog[state.preset]);
                    const saved = this._saved(ws);
                    tree.savedWeights = saved?.preset === state.preset ? saved.monitors?.[this._monitorKeys[monitor]] : null;
                    state.trees.set(monitor, tree);
                }
                const previous = slots(tree.root).map(s => s.window);
                const local = windows.filter(w => w.get_monitor() === monitor);
                tree.reconcile(local);
                for (const window of local) {
                    if (!tree.assign(window, this._windows.get(window).layout_placeholder))
                        this._log.debug(`Unknown layout placeholder: ${this._windows.get(window).layout_placeholder}`);
                }
                // Startup discovers windows incrementally. Wait until the saved
                // shape exists, then restore once rather than overriding later edits.
                if (this._persistence.enabled && slots(tree.root).filter(s => s.window).length >= 2 &&
                    tree.savedWeights && restoreWeights(tree.root, tree.savedWeights))
                    tree.savedWeights = null;
                const current = slots(tree.root).map(s => s.window);
                if (previous.length !== current.length || previous.some((w, i) => w !== current[i]))
                    this._overlay.cancel();
            }
        }
        for (const window of this._requests.keys()) if (!this.isManaged(window)) this._requests.delete(window);
        // Release our maximize flag before the dispatcher applies unmanaged rules.
        for (const window of this._auto) {
            if (this.isManaged(window)) continue;
            this._auto.delete(window);
            if (this._ownedMaximize.delete(window) && !window.is_fullscreen())
                unmaximizeWindow(window);
        }
    }
    queueRelayout(workspace) {
        if (this._destroyed || !workspace) return;
        this._pending.add(workspace);
        if (this._layoutSource !== null) return;
        // One batch per frame interval. Unlike a self-rearming priority-0 idle,
        // this always lets Mutter process frames and Wayland configure replies.
        this._layoutSource = this._sources.timeout(16, () => {
            this._layoutSource = null;
            const workspaces = [...this._pending];
            this._pending.clear();
            this._sync();
            for (const ws of workspaces) this._layout(ws);
            this._draw();
        });
    }
    queueAll() {
        if (this._destroyed) return;
        for (const workspace of this._layoutWorkspaces()) this.queueRelayout(workspace);
    }
    _same(a, b) { return ['x', 'y', 'width', 'height'].every(k => a[k] === b[k]); }
    _layout(ws) {
        if (!this._monitorKeys || !this._workspaceVisible(ws)) return;
        const state = this._states.get(ws);
        if (!state) return;
        const auto = new Set();
        if (state.preset !== 'none') for (const [monitor, tree] of state.trees) {
            const occupied = slots(tree.root).filter(s => s.window);
            if (['hbox', 'vbox'].includes(tree.root.type) && occupied.length === 1 && occupied[0].window.can_maximize())
                auto.add(occupied[0].window);
            for (const {node, rect} of geometry(tree.root, ws.get_work_area_for_monitor(monitor)).leaves) {
                const window = node.window;
                if (!window || this._grabbed === window ||
                    !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k])) ||
                    rect.width < 1 || rect.height < 1) continue;
                if (auto.has(window)) {
                    this._auto.add(window);
                    this._requests.delete(window);
                    if (getMaximizeFlags(window) !== Meta.MaximizeFlags.BOTH) {
                        this._ownedMaximize.add(window);
                        maximizeWindow(window);
                    }
                    continue;
                }
                this._auto.delete(window);
                this._ownedMaximize.delete(window);
                if (getMaximizeFlags(window)) {
                    unmaximizeWindow(window);
                    this._requests.delete(window);
                    // The maximization notifications schedule the settled geometry.
                    // Do not poll: Mutter may need a frame/client reply to finish.
                    continue;
                }
                if (this._requests.has(window) && this._same(this._requests.get(window), rect)) continue;
                this._requests.set(window, {...rect});
                if (!this._same(window.get_frame_rect(), rect))
                    window.move_resize_frame(false, rect.x, rect.y, rect.width, rect.height);
            }
        }
        for (const window of this._auto) {
            if (auto.has(window) || (this._windowWorkspace(window) !== ws && this.isManaged(window))) continue;
            this._auto.delete(window);
            if (this._ownedMaximize.delete(window) && !window.is_fullscreen())
                unmaximizeWindow(window);
        }
    }
    _draw() {
        if (!this._monitorKeys) { this._overlay.update([]); return; }
        const descriptors = [];
        if (!Main.overview.visible && !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter) {
            for (let monitor = 0; monitor < Main.layoutManager.monitors.length; monitor++) {
                const ws = this.activeWorkspace(monitor);
                const tree = this._states.get(ws)?.trees.get(monitor);
                if (!tree || (!this._workspaces && this._mutter.get_boolean('workspaces-only-on-primary') &&
                    monitor !== Main.layoutManager.primaryIndex)) continue;
                if (global.display.get_monitor_in_fullscreen(monitor)) continue;
                if (slots(tree.root).some(slot => this._auto.has(slot.window))) continue;
                const result = geometry(tree.root, ws.get_work_area_for_monitor(monitor));
                for (const leaf of result.leaves) if (!leaf.node.window && leaf.rect.width > 0 && leaf.rect.height > 0) descriptors.push(leaf);
                for (const splitter of result.splitters) descriptors.push({rect: splitter.rect, splitter, workspace: ws});
            }
        }
        this._overlay.update(descriptors);
    }
    destroy() {
        this._destroyed = true;
        this._monitorIdentity.destroy();
        this._sources.clearAll();
        this._layoutSource = null;
        this._signals.disconnectAll();
        this._overlay.destroy();
        for (const window of this._ownedMaximize) {
            try { if (!window.is_fullscreen()) unmaximizeWindow(window); } catch (_) { /* unmanaged */ }
        }
        this._auto.clear();
        this._ownedMaximize.clear();
        this._windows.clear();
        this._states.clear();
        this._requests.clear();
        this._pending.clear();
    }
}
