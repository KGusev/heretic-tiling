import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loader, Emitter, scheduler} from './modules.mjs';

async function fixture(values, secondary = true) {
    const queue = scheduler();
    const skipped = [];
    const layout = Object.assign(new Emitter(), {
        monitors: secondary ? [{index: 0}, {index: 1}] : [{index: 0}],
        primaryIndex: 0,
    });
    const native = {count: null, primary: null, workspace: 0};
    const display = Object.assign(new Emitter(), {
        list_all_windows: () => [],
        get_n_monitors: () => native.count ?? layout.monitors.length,
        get_primary_monitor: () => native.primary ?? layout.primaryIndex,
    });
    const clients = [];
    const workspaces = Array.from({length: 10}, (_, index) => ({
        index: () => index,
        list_windows: () => clients.filter((window) => window.get_workspace().index() === index),
    }));
    const wm = Object.assign(new Emitter(), {
        get_n_workspaces: () => 10,
        get_active_workspace_index: () => native.workspace,
        get_workspace_by_index: (index) => workspaces[index],
    });
    const settings = {
        get_string: (key) => values[key] ?? '',
        set_string: (key, value) => {
            values[key] = value;
        },
        get_int: () => 1,
        reset() {},
    };
    const load = loader(
        {
            'gi://Meta': {default: {WindowType: {NORMAL: 0}, is_wayland_compositor: () => false}},
            'gi://Clutter': {default: {}},
            'gi://GLib': {
                default: {
                    ...queue.glib,
                    getenv: () => 'session',
                    file_get_contents: (path) => [
                        true,
                        new TextEncoder().encode(
                            path.endsWith('/stat')
                                ? '42 (client with spaces) ' +
                                      Array.from({length: 20}, (_, i) =>
                                          i === 19 ? '12345' : '0',
                                      ).join(' ')
                                : 'boot',
                        ),
                    ],
                },
            },
            'resource:///org/gnome/shell/ui/main.js': {
                layoutManager: layout,
                wm: {skipNextEffect: (actor) => skipped.push(actor)},
            },
        },
        {global: {display, workspace_manager: wm, get_current_time: () => 0}},
    );
    const {MonitorWorkspaces} = await load('lib/monitorWorkspaces.js');
    const model = new MonitorWorkspaces(settings, {get_boolean: () => true, set_boolean() {}});
    model.enable();
    const window = (index = 8, monitor = 0, xid = '0x123') => {
        const client = Object.assign(new Emitter(), {
            window_type: 0,
            minimized: false,
            get_description: () => `${xid} title`,
            get_pid: () => 42,
            get_transient_for: () => null,
            can_minimize: () => true,
            get_workspace: () => workspaces[index],
            get_monitor: () => monitor,
            is_on_all_workspaces: () => false,
            move_to_monitor(value) {
                monitor = value;
                display.emit('window-entered-monitor', value, this);
            },
            change_workspace(ws) {
                index = ws.index();
                this.emit('workspace-changed');
            },
            minimize() {
                this.minimized = true;
                this.emit('notify::minimized');
            },
            unminimize() {
                this.minimized = false;
                this.emit('notify::minimized');
            },
        });
        clients.push(client);
        return client;
    };
    return {model, layout, window, skipped, native, queue};
}

test('WS9 survives Shell restart with M2 absent and returns with its window', async () => {
    const values = {'workspace-monitor-bindings': '{}', 'monitor-workspaces': '{}'};
    const before = await fixture(values);
    before.model.setMonitorKeys(['M1', 'M2']);
    const original = before.window();
    before.model.track(original, {});
    assert.equal(before.model.bind(8, 1), true);
    assert.equal(original.get_monitor(), 1);
    before.model.destroy();

    // Separate JS context and window wrapper: the module WeakMap is gone.
    const after = await fixture(values, false);
    const restored = after.window(0);
    after.model.track(restored, {}); // identities arrive asynchronously
    after.model.setMonitorKeys(['M1']);
    assert.equal(restored.get_workspace().index(), 8);
    assert.equal(restored.get_monitor(), 0);
    assert.equal(JSON.parse(values['workspace-monitor-bindings'])['8'], 'M2');
    const saved = Object.values(JSON.parse(values['window-workspace-assignments']));
    assert.equal(saved[0].index, 8);
    assert.equal(saved[0].key, 'M2');

    after.layout.monitors.push({index: 1});
    after.layout.emit('monitors-changed');
    after.model.setMonitorKeys(['M1', 'M2']);
    assert.equal(restored.get_monitor(), 1);
    assert.equal(after.model.windowsAt(1, 8)[0], restored);
    assert.equal(restored.minimized, false);
    // Physical indices can change when displays return; connector identity wins.
    after.layout.primaryIndex = 1;
    after.layout.emit('monitors-changed');
    after.model.setMonitorKeys(['M2', 'M1']);
    assert.equal(restored.get_monitor(), 0);
    assert.equal(after.model.windowsAt(0, 8)[0], restored);
    restored.emit('unmanaged');
    assert.equal(Object.keys(JSON.parse(values['window-workspace-assignments'])).length, 0);
    after.model.destroy();
});

test('manual reassignment during monitor absence wins on reconnection', async () => {
    const values = {'workspace-monitor-bindings': '{"8":"M2"}', 'monitor-workspaces': '{}'};
    const f = await fixture(values, false);
    const window = f.window();
    f.model.track(window, {});
    f.model.setMonitorKeys(['M1']);
    // A real primary workspace change must update the retained logical index.
    window.change_workspace({index: () => 3});
    f.layout.monitors.push({index: 1});
    f.layout.emit('monitors-changed');
    f.model.setMonitorKeys(['M1', 'M2']);
    assert.equal(window.get_monitor(), 0);
    assert.equal(window.get_workspace().index(), 3);
    f.model.destroy();
});

test('disconnect preserves logical workspace even if Mutter moves the window first', async () => {
    const values = {'workspace-monitor-bindings': '{"8":"M2"}', 'monitor-workspaces': '{"M2":8}'};
    const f = await fixture(values);
    f.model.setMonitorKeys(['M1', 'M2']);
    const window = f.window();
    f.model.track(window, {});
    assert.equal(window.get_monitor(), 1);
    f.layout.monitors.pop();
    window.move_to_monitor(0);
    f.layout.emit('monitors-changed');
    f.model.setMonitorKeys(['M1']);
    assert.equal(window.get_workspace().index(), 8);
    f.layout.monitors.push({index: 1});
    f.layout.emit('monitors-changed');
    f.model.setMonitorKeys(['M1', 'M2']);
    assert.equal(f.model.windowsAt(1, 8)[0], window);
    f.model.destroy();
});

test('secondary workspace parking skips restore effects without changing manual minimization', async () => {
    const f = await fixture({
        'workspace-monitor-bindings': '{"8":"M2","9":"M2"}',
        'monitor-workspaces': '{"M2":8}',
    });
    f.model.setMonitorKeys(['M1', 'M2']);
    const window = f.window();
    const actor = {};
    window.get_compositor_private = () => actor;
    f.model.track(window, {});
    assert.equal(f.skipped.length, 0);
    f.model._active.set('M2', 9);
    f.model._updateVisibility(1);
    assert.equal(window.minimized, true);
    assert.equal(f.skipped.length, 1);
    assert.equal(f.skipped[0], actor);
    f.model._active.set('M2', 8);
    f.model._updateVisibility(1);
    assert.equal(window.minimized, false);
    assert.equal(f.skipped.length, 2);
    f.model._updateVisibility(1);
    assert.equal(f.skipped.length, 2, 'unchanged visibility must not skip a later animation');
    window.minimize();
    f.model._active.set('M2', 9);
    f.model._updateVisibility(1);
    f.model._active.set('M2', 8);
    f.model._updateVisibility(1);
    assert.equal(window.minimized, true, 'user-minimized windows stay minimized');
    assert.equal(f.skipped.length, 2);
    f.model.destroy();
});

test('disconnect clears implicit sticky state before restoring the assigned workspace', async () => {
    const f = await fixture({
        'workspace-monitor-bindings': '{"8":"M2"}',
        'monitor-workspaces': '{"M2":8}',
    });
    f.model.setMonitorKeys(['M1', 'M2']);
    const window = f.window();
    f.model.track(window, {});
    let sticky = true;
    let requested = false;
    let nativeIndex = 0;
    const order = [];
    window.is_on_all_workspaces = () => sticky;
    window.get_workspace = () => ({index: () => nativeIndex});
    window.stick = () => {
        requested = true;
        order.push('stick');
    };
    window.unstick = () => {
        if (!requested) return; // Mutter's implicit sticky state is not a request.
        requested = false;
        sticky = false;
        nativeIndex = 0; // Mutter initially puts an unstuck window on the active workspace.
        window.emit('workspace-changed');
        order.push('unstick');
    };
    window.change_workspace = (ws) => {
        if (sticky) return;
        nativeIndex = ws.index();
        window.emit('workspace-changed');
        order.push('workspace');
    };
    f.layout.monitors.pop();
    f.layout.emit('monitors-changed');
    window.move_to_monitor(0);
    f.model.setMonitorKeys(['M1']);
    assert.equal(sticky, false);
    assert.equal(nativeIndex, 8);
    assert.deepEqual(order, ['stick', 'unstick', 'workspace']);
    assert.equal(
        f.model._windows.get(window).index,
        8,
        'unstick notifications must not overwrite placement',
    );
    f.layout.monitors.push({index: 1});
    f.layout.emit('monitors-changed');
    f.model.setMonitorKeys(['M1', 'M2']);
    assert.equal(f.model.windowsAt(1, 8)[0], window);
    f.model.destroy();
});

test('explicit sticky rules remain outside workspace recovery', async () => {
    const f = await fixture({
        'workspace-monitor-bindings': '{"8":"M2"}',
        'monitor-workspaces': '{}',
    });
    const window = f.window();
    window.unstick = () => {
        throw new Error('explicit sticky window modified');
    };
    f.model.track(window, {sticky: true});
    f.layout.monitors.pop();
    f.layout.emit('monitors-changed');
    f.model.setMonitorKeys(['M1']);
    assert.equal(f.model._windows.has(window), false);
    f.model.destroy();
});

for (const externalOnly of [true, false]) {
    test(`preserve WS9 when native topology changes before Shell (external-only=${externalOnly})`, async () => {
        const f = await fixture({
            'workspace-monitor-bindings': '{"8":"M2"}',
            'monitor-workspaces': '{"M2":8}',
        });
        f.model.setMonitorKeys(['M1', 'M2']);
        const window = f.window();
        f.model.track(window, {});
        if (externalOnly) {
            f.native.count = 1;
            f.native.primary = 0;
            window.move_to_monitor(0);
        } else {
            f.native.primary = 1;
            f.layout.primaryIndex = 1;
        }
        window.change_workspace({index: () => 0});
        assert.equal(f.model._windows.get(window).index, 8);
        if (externalOnly) f.layout.monitors.pop();
        f.layout.emit('monitors-changed');
        f.model.setMonitorKeys(externalOnly ? ['M2'] : ['M1', 'M2']);
        assert.equal(window.get_workspace().index(), 8);
        assert.equal(f.model._windows.get(window).index, 8);
        f.model.destroy();
    });
}

test('joining monitors preserves the external primary workspace and manual minimization', async () => {
    const values = {
        'workspace-monitor-bindings': '{"8":"M2","9":"M2"}',
        'monitor-workspaces': '{"M2":9}',
    };
    const f = await fixture(values, false);
    f.model.setMonitorKeys(['M2']);
    f.native.workspace = 8;
    f.model._nativeSwitched();
    const visible = f.window(8, 0, '0x111');
    const manual = f.window(8, 0, '0x222');
    manual.minimized = true;
    f.model.track(visible, {});
    f.model.track(manual, {});
    f.layout.monitors.push({index: 1});
    f.native.workspace = 0;
    f.layout.emit('monitors-changed');
    f.model.setMonitorKeys(['M1', 'M2']);
    assert.equal(f.model.activeIndex(1), 8);
    assert.equal(visible.get_monitor(), 1);
    assert.equal(visible.minimized, false);
    assert.equal(manual.minimized, true);
    assert.equal(JSON.parse(values['monitor-workspaces']).M2, 8);
    f.model.destroy();
});

test('topology-induced unminimize retains parking ownership without activating a workspace', async () => {
    const f = await fixture({
        'workspace-monitor-bindings': '{"8":"M2","9":"M2"}',
        'monitor-workspaces': '{"M2":9}',
    });
    f.model.setMonitorKeys(['M1', 'M2']);
    const window = f.window(8);
    f.model.track(window, {});
    assert.equal(window.minimized, true);
    let activations = 0;
    f.model.activateWorkspace = () => {
        activations++;
    };
    f.layout.emit('monitors-changed');
    window.unminimize();
    assert.equal(f.model.ownsMinimize(window), true);
    assert.equal(activations, 0);
    f.model.setMonitorKeys(['M1', 'M2']);
    assert.equal(window.minimized, true);
    f.model._active.set('M2', 8);
    f.model._updateVisibility(1);
    assert.equal(window.minimized, false);
    f.model.destroy();
});

test('late WS1 notifications after joined-to-external-only reconciliation cannot overwrite WS9', async () => {
    const values = {'workspace-monitor-bindings': '{"8":"M2"}', 'monitor-workspaces': '{"M2":8}'};
    const f = await fixture(values);
    f.model.setMonitorKeys(['M1', 'M2']);
    const window = f.window(8);
    f.model.track(window, {});
    f.native.count = 1;
    f.layout.monitors.pop();
    f.layout.emit('monitors-changed');
    window.move_to_monitor(0);
    f.model.setMonitorKeys(['M2']);
    // Mutter reports its automatic active-workspace placement after our first move.
    window.change_workspace({index: () => 0});
    window.move_to_monitor(0);
    assert.equal(f.model._windows.get(window).index, 8);
    assert.equal(Object.values(JSON.parse(values['window-workspace-assignments']))[0].index, 8);
    f.queue.flush();
    assert.equal(window.get_workspace().index(), 8);
    assert.equal(window.get_monitor(), 0);
    // Once settled, genuine user moves remain accepted.
    window.change_workspace({index: () => 3});
    assert.equal(f.model._windows.get(window).index, 3);
    f.model.destroy();
});

test('repeated external-only and joined transitions preserve WS9 and manual minimization', async () => {
    const f = await fixture({
        'workspace-monitor-bindings': '{"8":"M2"}',
        'monitor-workspaces': '{"M2":8}',
    });
    f.model.setMonitorKeys(['M1', 'M2']);
    const visible = f.window(8, 0, '0x901');
    const manual = f.window(8, 0, '0x902');
    manual.minimized = true;
    f.model.track(visible, {});
    f.model.track(manual, {});
    for (let i = 0; i < 5; i++) {
        f.native.count = 1;
        f.layout.monitors.pop();
        f.layout.emit('monitors-changed');
        f.model.setMonitorKeys(['M2']);
        visible.change_workspace({index: () => 0});
        manual.change_workspace({index: () => 0});
        f.queue.flush();
        assert.equal(visible.get_workspace().index(), 8);
        assert.equal(manual.get_workspace().index(), 8);
        f.native.count = 2;
        f.layout.monitors.push({index: 1});
        f.layout.emit('monitors-changed');
        f.model.setMonitorKeys(['M1', 'M2']);
        f.queue.flush();
        assert.equal(f.model.windowsAt(1, 8).length, 2);
        assert.equal(visible.minimized, false);
        assert.equal(manual.minimized, true);
    }
    f.model.destroy();
});
