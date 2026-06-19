import Meta from 'gi://Meta';
import {LayoutPersistence, restoreWeights} from './persistence.js';
import {MonitorIdentity} from './monitorIdentity.js';
import {directionalNeighbour} from './navigation.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SignalTracker} from '../utils/signalTracker.js';
import {SourceTracker} from '../utils/sourceTracker.js';
import {Logger} from '../logger.js';
import {BUILTINS, LayoutTree, slots, geometry, resizeWindow} from './model.js';
import {LayoutOverlay} from './overlay.js';

export class LayoutManager {
    constructor(settings, mutterSettings, engine) {
        this._default = settings.get_string('default-layout');
        this._settings = settings;
        this._persistence = new LayoutPersistence(settings);
        this._monitorIdentity = new MonitorIdentity();
        this._monitorKeys = null;
        this._mutter = mutterSettings;
        this._engine = engine;
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
        this._overlay = new LayoutOverlay(() => {
            const ws = global.workspace_manager.get_active_workspace();
            this._save(ws, this._state(ws));
            this.queueAll();
        }, window => this.isManaged(window));
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
            for (const state of this._states.values()) state.trees.clear();
            this._requests.clear();
            this.queueAll();
        });
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
        return this._persistence.get(workspace, this._defaults(workspace), this._definitions());
    }
    _save(workspace, state) {
        if (!this._monitorKeys) return;
        for (const tree of state.trees.values()) tree.savedWeights = null;
        const trees = [...state.trees].filter(([, tree]) => slots(tree.root).filter(s => s.window).length >= 2).map(([index, tree]) => [this._monitorKeys[index], tree]);
        this._persistence.save(workspace, this._defaults(workspace), state.preset,
            this._definitions()[state.preset], trees);
    }
    _saveAll() { for (const [ws, state] of this._states) this._save(ws, state); }
    resetLayout(workspace) {
        this.applyPreset(workspace, this._workspaceDefault(workspace));
        this._persistence.clear(workspace);
    }
    getActivePreset(workspace) { return this._state(workspace).preset; }
    applyPreset(workspace, name) {
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
        // allows_resize() is false while maximized: using it here creates a
        // maximize → exclude → unmaximize → include loop on the Shell thread.
        return window.window_type === Meta.WindowType.NORMAL && window.resizeable &&
            !window.get_transient_for() && !window.is_on_all_workspaces() && !window.is_above() &&
            !window.minimized && !window.is_fullscreen() &&
            !(this._mutter.get_boolean('workspaces-only-on-primary') &&
                window.get_monitor() !== Main.layoutManager.primaryIndex);
    }
    reconcileWindow(window, actions = {}) {
        if (this._destroyed) return false;
        if (!this._windows.has(window)) {
            this._windows.set(window, actions);
            for (const signal of ['workspace-changed', 'notify::minimized', 'notify::fullscreen',
                'notify::above', 'notify::on-all-workspaces', 'notify::maximized-horizontally',
                'notify::maximized-vertically', 'notify::resizeable', 'monitor-changed'])
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
        const state = this._states.get(window.get_workspace());
        return Boolean(state?.trees.get(window.get_monitor())?.has(window));
    }
    resizeDirection(direction) {
        const window = global.display.focus_window;
        const workspace = global.workspace_manager.get_active_workspace();
        if (!window || window.get_workspace() !== workspace || !this.isManaged(window)) return;
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
        const workspace = source.get_workspace();
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
        const workspace = global.workspace_manager.get_active_workspace();
        if (!source || source.get_workspace() !== workspace || !this.isManaged(source)) return;
        const candidates = [...this._windows.keys()]
            .filter(w => w !== source && w.get_workspace() === workspace && this.isManaged(w) &&
                (!sameMonitor || w.get_monitor() === source.get_monitor()))
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence())
            .map(window => ({window, rect: window.get_frame_rect()}));
        return directionalNeighbour(source.get_frame_rect(), candidates, direction);
    }
    _sync() {
        if (!this._monitorKeys) return;
        const wm = global.workspace_manager;
        const workspaces = new Set(Array.from({length: wm.get_n_workspaces()}, (_, i) => wm.get_workspace_by_index(i)));
        for (const ws of this._states.keys()) if (!workspaces.has(ws)) this._states.delete(ws);
        for (const ws of workspaces) {
            const state = this._state(ws);
            if (state.preset === 'none') continue;
            const mru = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, ws);
            const rank = new Map(mru.map((w, i) => [w, i]));
            const windows = [...this._windows.keys()].filter(w => w.get_workspace() === ws && this._eligible(w))
                .sort((a, b) => ((rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity)) ||
                    a.get_stable_sequence() - b.get_stable_sequence());
            for (let monitor = 0; monitor < Main.layoutManager.monitors.length; monitor++) {
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
                window.unmaximize(Meta.MaximizeFlags.BOTH);
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
        const wm = global.workspace_manager;
        for (let i = 0; i < wm.get_n_workspaces(); i++) this.queueRelayout(wm.get_workspace_by_index(i));
    }
    _same(a, b) { return ['x', 'y', 'width', 'height'].every(k => a[k] === b[k]); }
    _layout(ws) {
        if (!this._monitorKeys) return;
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
                    if (window.get_maximized() !== Meta.MaximizeFlags.BOTH) {
                        this._ownedMaximize.add(window);
                        window.maximize(Meta.MaximizeFlags.BOTH);
                    }
                    continue;
                }
                this._auto.delete(window);
                this._ownedMaximize.delete(window);
                if (window.get_maximized()) {
                    window.unmaximize(Meta.MaximizeFlags.BOTH);
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
            if (auto.has(window) || (window.get_workspace() !== ws && this.isManaged(window))) continue;
            this._auto.delete(window);
            if (this._ownedMaximize.delete(window) && !window.is_fullscreen())
                window.unmaximize(Meta.MaximizeFlags.BOTH);
        }
    }
    _draw() {
        if (!this._monitorKeys) { this._overlay.update([]); return; }
        const ws = global.workspace_manager.get_active_workspace();
        const state = this._states.get(ws);
        const descriptors = [];
        if (!Main.overview.visible && !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter && state?.preset !== 'none') {
            for (const [monitor, tree] of state?.trees ?? []) {
                if (this._mutter.get_boolean('workspaces-only-on-primary') && monitor !== Main.layoutManager.primaryIndex) continue;
                if (global.display.get_monitor_in_fullscreen(monitor)) continue;
                if (slots(tree.root).some(s => this._auto.has(s.window))) continue;
                const result = geometry(tree.root, ws.get_work_area_for_monitor(monitor));
                for (const leaf of result.leaves) if (!leaf.node.window && leaf.rect.width > 0 && leaf.rect.height > 0) descriptors.push(leaf);
                for (const splitter of result.splitters) descriptors.push({rect: splitter.rect, splitter});
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
            try { if (!window.is_fullscreen()) window.unmaximize(Meta.MaximizeFlags.BOTH); } catch (_) { /* unmanaged */ }
        }
        this._auto.clear();
        this._ownedMaximize.clear();
        this._windows.clear();
        this._states.clear();
        this._requests.clear();
        this._pending.clear();
    }
}
