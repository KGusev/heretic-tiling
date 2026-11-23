import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loader, Emitter, scheduler} from './modules.mjs';

async function fixture() {
    const queue = scheduler(), moves = [], activations = [];
    let activeWorkspace;
    const workspace = {activate_with_focus: target => { activations.push(target); focus(target); }};
    activeWorkspace = workspace;
    const display = Object.assign(new Emitter(), {focus_window: null, list_all_windows: () => []});
    const values = {'center-cursor-on-focus': true, 'focus-next-on-close': false};
    const load = loader({
        'gi://Meta': {default: {TabList: {NORMAL_ALL: 0}, WindowType: {NORMAL: 0}}},
        'gi://GLib': {default: queue.glib},
        'gi://Clutter': {default: {get_default_backend: () => ({get_default_seat: () => ({
            warp_pointer: (x, y) => moves.push([x, y]),
        })})}},
    }, {global: {display, workspace_manager: {get_active_workspace: () => activeWorkspace},
        get_current_time: () => 123}});
    const {FocusManager} = await load('lib/focusManager.js');
    const manager = new FocusManager({get_boolean: key => values[key]});
    manager.enable();
    const window = (x = 100, y = -100) => ({get_frame_rect: () => ({x, y, width: 501, height: 303})});
    const focus = target => { display.focus_window = target; display.emit('notify::focus-window'); };
    const windows = [];
    display.get_tab_list = () => windows;
    display.sort_windows_by_stacking = candidates => [...candidates].sort((a, b) => a.z - b.z);
    const managed = (z = 0, overrides = {}) => {
        const win = Object.assign(new Emitter(), window(), {z, minimized: false,
            is_on_all_workspaces: () => false, get_workspace: () => workspace,
            get_window_type: () => 0, get_title: () => 'test', ...overrides});
        windows.push(win); display.emit('window-created', win);
        return win;
    };
    return {queue, moves, display, values, manager, window, focus, managed, activations,
        switchWorkspace: () => { activeWorkspace = {}; }};
}

test('any focused window centers the cursor independently of focus-on-close', async () => {
    const f = await fixture();
    for (const x of [100, 1100, -1000]) {
        f.focus(f.window(x)); f.queue.flush();
        assert.deepEqual(f.moves.at(-1), [x + 251, 52]);
    }
    f.focus(f.display.focus_window); f.queue.flush();
    assert.equal(f.moves.length, 3);
    f.manager.destroy();
});

test('focus redirects and cleared focus cancel obsolete cursor movement', async () => {
    const f = await fixture();
    f.focus(f.window()); f.focus(f.window(1100)); f.queue.flush();
    assert.deepEqual(f.moves, [[1351, 52]]);
    f.focus(f.window()); f.focus(null); f.queue.flush();
    assert.equal(f.moves.length, 1);
    f.manager.destroy();
});

test('setting changes apply live and disable cancels pending movement', async () => {
    const f = await fixture();
    f.focus(f.window()); f.values['center-cursor-on-focus'] = false; f.queue.flush();
    f.focus(f.window()); f.queue.flush();
    assert.equal(f.moves.length, 0);
    f.values['center-cursor-on-focus'] = true;
    f.focus(f.window()); f.queue.flush();
    assert.equal(f.moves.length, 1);
    f.focus(f.window()); f.manager.destroy(); f.queue.flush();
    assert.equal(f.moves.length, 1);
    assert.equal(f.display.handlers.size, 0);
});


test('closing the focused tile does not skip the survivor Mutter already focused', async () => {
    const f = await fixture();
    f.values['focus-next-on-close'] = true;
    const closed = f.managed(10), survivor = f.managed(5);
    f.managed(0);
    f.focus(closed);
    closed.emit('unmanaging');
    f.focus(survivor);
    closed.emit('unmanaged');
    f.queue.flush();
    assert.equal(f.display.focus_window, survivor);
    assert.deepEqual(f.activations, []);
    assert.equal(closed.handlers.size, 0);
    f.manager.destroy();
});

test('focus cleared before unmanaged still restores the topmost eligible survivor', async () => {
    const f = await fixture();
    f.values['focus-next-on-close'] = true;
    const closed = f.managed(100);
    f.managed(1); // First in MRU order, but behind the intended survivor.
    const top = f.managed(5);
    f.managed(10, {minimized: true});
    f.managed(20, {is_on_all_workspaces: () => true});
    f.managed(30, {get_workspace: () => ({})});
    f.managed(40, {get_window_type: () => 1});
    f.focus(closed);
    closed.emit('unmanaging'); f.focus(null); closed.emit('unmanaged');
    f.queue.flush();
    assert.deepEqual(f.activations, [top]);
    f.manager.destroy();
});

test('background closes and closing the last window do not activate a window', async () => {
    const f = await fixture();
    f.values['focus-next-on-close'] = true;
    const focused = f.managed(1), background = f.managed(0);
    f.focus(focused);
    background.emit('unmanaging'); background.emit('unmanaged'); f.queue.flush();
    assert.deepEqual(f.activations, []);
    f.display.get_tab_list = () => [focused];
    focused.emit('unmanaging'); f.focus(null); focused.emit('unmanaged'); f.queue.flush();
    assert.deepEqual(f.activations, []);
    f.manager.destroy();
});

test('pending close restoration respects workspace switches, settings and teardown', async () => {
    for (const cancel of [f => f.switchWorkspace(),
        f => { f.values['focus-next-on-close'] = false; }, f => f.manager.destroy()]) {
        const f = await fixture();
        f.values['focus-next-on-close'] = true;
        const closed = f.managed(10);
        f.managed(5); f.focus(closed);
        closed.emit('unmanaging'); f.focus(null); closed.emit('unmanaged');
        cancel(f); f.queue.flush();
        assert.deepEqual(f.activations, []);
        f.manager.destroy();
    }
});
