import assert from 'node:assert/strict';
import {loader} from './modules.mjs';
const monitors = [{index: 0}, {index: 1}];
let count = 3;
const effects = [];
const load = loader(
    {
        'gi://Meta': {default: {}},
        'gi://Clutter': {default: {}},
        'gi://GLib': {default: {getenv: () => 'test-session'}},
        'resource:///org/gnome/shell/ui/main.js': {
            layoutManager: {monitors, primaryIndex: 0},
            wm: {skipNextEffect: (actor) => effects.push(actor)},
        },
    },
    {
        global: {
            workspace_manager: {get_n_workspaces: () => count, get_active_workspace_index: () => 0},
            get_current_time: () => 0,
        },
    },
);
const {MonitorWorkspaces} = await load('lib/monitorWorkspaces.js');
const manager = new MonitorWorkspaces({get_string: () => '{}', set_string() {}}, {});
manager._monitorKeys = ['a', 'b'];
manager._bindings.set(2, 'b');
assert.equal(manager.bind(2, 0), false, 'cannot remove the last secondary workspace');
manager._active.set('b', 2);
count = 2;
manager._nativeSwitched = () => {};
manager._updateVisibility = () => {};
const moved = [];
manager.move = (window, index) => moved.push(index);
manager._windows.set({get_monitor: () => 1}, {index: 2});
manager._reconcile();
assert.equal(manager.workspacesOn(1).length, 1);
assert.equal(moved[0], 1, 'removed workspace migrates to valid owned workspace');
assert.equal(manager.activeIndex(1), 1);
manager._windows.clear();
monitors.pop();
manager.setMonitorKeys(['a']);
assert.equal(manager.monitorForWorkspace(1), 0, 'disconnected workspaces fall back to primary');
monitors.push({index: 1});
manager.setMonitorKeys(['a', 'b']);
assert.equal(manager.monitorForWorkspace(1), 1, 'reconnected display recovers ownership');
// Visibility management must not restore windows minimized by the user.
delete manager._updateVisibility;
const window = {
    minimized: true,
    unminimize() {
        throw new Error('manual minimize lost');
    },
};
manager._windows.set(window, {monitor: 1, monitorKey: 'b', index: 1});
manager._updateVisibility();

// A new manager and Meta.Window wrapper recover the same X11 client assignment.
let saved = '{}';
const settings = {
    get_string: (key) => (key === 'window-workspace-assignments' ? saved : '{}'),
    set_string: (key, value) => {
        if (key === 'window-workspace-assignments') saved = value;
    },
};
const client = () => ({
    get_description: () => '0x123abc title',
    get_pid: () => 42,
    get_workspace: () => ({index: () => 0}),
});
const before = new MonitorWorkspaces(settings, {});
before._remember(client(), {monitorKey: 'b', index: 1, monitor: 1});
const after = new MonitorWorkspaces(settings, {});
after._monitorKeys = ['a', 'b'];
after._bindings.set(1, 'b');
after._initialWindows = new WeakMap();
const restored = client();
after._windows.set(restored, {monitor: -1, ruleIndex: 0});
let restoredIndex;
after.move = (_, index) => {
    restoredIndex = index;
};
after._updateMonitor(restored, 0);
assert.equal(restoredIndex, 1, 'saved assignment wins over startup rule and current monitor');

const actor = {};
const parked = {
    minimized: false,
    get_compositor_private: () => actor,
    minimize() {
        assert.equal(effects.at(-1), actor);
        this.minimized = true;
    },
    unminimize() {
        assert.equal(effects.at(-1), actor);
        this.minimized = false;
    },
};
manager._windows.clear();
manager._windows.set(parked, {monitor: 1, monitorKey: 'b', index: 0});
manager._updateVisibility();
assert.equal(parked.minimized, true);
assert.equal(effects.length, 1);
manager._windows.get(parked).index = 1;
manager._updateVisibility();
assert.equal(parked.minimized, false);
assert.equal(effects.length, 2);
manager._updateVisibility();
assert.equal(effects.length, 2, 'unchanged visibility must not skip a later user animation');

// Real startup ordering: track first, then receive async monitor identities.
// Reconciliation must not turn the initial workspace placeholder into a move.
count = 4;
const delayed = new MonitorWorkspaces(settings, {});
delayed._initialWindows = new WeakMap();
delayed._bindings.set(1, 'b');
delayed._nativeSwitched = () => {};
delayed._updateVisibility = () => {};
const placements = [];
const secondaryClient = {...client(), get_monitor: () => 0};
const primaryClient = {
    get_monitor: () => 0,
    get_workspace: () => ({index: () => 3}),
};
delayed._windows.set(secondaryClient, {monitor: -1, index: null, ruleIndex: null});
delayed._windows.set(primaryClient, {monitor: -1, index: null, ruleIndex: null});
delayed.move = (win, index) => {
    placements.push([win, index, delayed.monitorForWorkspace(index)]);
};
delayed.setMonitorKeys(['a', 'b']);
assert.deepEqual(
    placements,
    [
        [secondaryClient, 1, 1],
        [primaryClient, 3, 0],
    ],
    'late monitor lookup restores saved secondary and native primary assignments',
);
assert.equal(
    JSON.parse(saved)[before._windowKey(client())].index,
    1,
    'startup does not overwrite the saved secondary assignment with workspace zero',
);

// Visibility work scales with monitors, not the number of parked windows.
manager._windows.clear();
for (let i = 0; i < 100; i++)
    manager._windows.set({minimized: true}, {monitor: 1, monitorKey: 'b', index: 0});
let selections = 0;
const activeIndex = manager.activeIndex.bind(manager);
manager.activeIndex = (monitor) => {
    selections++;
    return activeIndex(monitor);
};
manager._updateVisibility();
assert.equal(selections, 1);

let writes = 0;
const unchanged = new MonitorWorkspaces(
    {
        get_string: () => '{}',
        set_string: () => {
            writes++;
        },
    },
    {},
);
const sameClient = client();
for (let i = 0; i < 100; i++) unchanged._remember(sameClient, {monitorKey: 'b', index: 1});
assert.equal(writes, 1, 'unchanged window assignments must not rewrite the recovery map');

const membership = new MonitorWorkspaces(settings, {});
const parent = {get_monitor: () => 1};
membership._windows.set(parent, {monitor: 1, index: 2});
const dialog = {get_monitor: () => 1, get_transient_for: () => parent};
assert.equal(membership.windowBelongsTo(parent, 2, 1), true);
assert.equal(membership.windowBelongsTo(parent, 1, 1), false);
assert.equal(membership.windowBelongsTo(dialog, 2, 1), true);
assert.equal(membership.windowBelongsTo(dialog, 2, 0), false);
const sticky = {get_monitor: () => 1, is_on_all_workspaces: () => true};
assert.equal(membership.windowBelongsTo(sticky, 2, 1), true);
