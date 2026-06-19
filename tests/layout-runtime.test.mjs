import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loader, Emitter, scheduler} from './modules.mjs';

const Meta = {WindowType: {NORMAL: 0}, MaximizeFlags: {BOTH: 3}, TabList: {NORMAL_ALL: 0}};
const slot = name => ({type: 'placeholder', name});
const definition = {type: 'hbox', children: [slot('editor'), slot('terminal')]};
async function fixture(preset = 'hbox', settings = null) {
    const queue = scheduler();
    const display = new Emitter();
    const wm = new Emitter();
    const workspaces = [0, 1, 2, 3].map(index => ({index: () => index,
        get_work_area_for_monitor(m) {
            return Object.create({get x() { return m * 1000; }, get y() { return 30; },
                get width() { return 1000; }, get height() { return 700; }});
        },
        list_windows() { return windows.filter(w => w.ws === this); },
    }));
    const windows = [];
    Object.assign(wm, {get_n_workspaces: () => workspaces.length,
        get_workspace_by_index: i => workspaces[i], get_active_workspace: () => workspaces[0]});
    Object.assign(display, {get_tab_list: () => windows, get_monitor_in_fullscreen: () => false,
        list_all_windows: () => windows});
    const main = {layoutManager: Object.assign(new Emitter(), {monitors: [{}, {}], primaryIndex: 0}),
        overview: Object.assign(new Emitter(), {visible: false}), sessionMode: new Emitter()};
    const mutter = Object.assign(new Emitter(), {get_boolean: () => false});
    const overlays = [];
    class LayoutOverlay {
        constructor(changed) { this.changed = changed; overlays.push(this); }
        cancel() {}
        update(descriptors) { this.descriptors = descriptors; }
        destroy() { this.destroyed = true; }
    }
    const load = loader({'gi://Meta': {default: Meta}, 'gi://GLib': {default: queue.glib},
        'resource:///org/gnome/shell/ui/main.js': main, './overlay.js': {LayoutOverlay}, './monitorIdentity.js': {MonitorIdentity: class {
            refresh(monitors, done) { done(monitors.map((m, i) => m.id ?? `monitor-${i}`)); }
            destroy() {}
        }}},
    {global: {display, workspace_manager: wm, get_current_time: () => 42}});
    const {LayoutManager} = await load('lib/layouts/layoutManager.js');
    const engine = {layouts: {code: definition}};
    settings ??= Object.assign(new Emitter(), {get_string: key => key === 'default-layout' ? preset : '{}',
        get_int: () => 5, get_boolean: () => false, set_string() {}});
    const layouts = new LayoutManager(settings, mutter, engine);
    layouts.enable();
    let sequence = 0;
    function window(monitor = 0, workspace = 0) {
        const w = Object.assign(new Emitter(), {window_type: 0, monitor, ws: workspaces[workspace],
            rect: {x: 0, y: 0, width: 150, height: 100}, maximized: 0, moves: [], id: ++sequence,
            // Mutter denies interactive resize while maximized, but capability stays true.
            resizeable: true, allows_resize() { return this.resizeable && !this.maximized; },
            get_transient_for: () => null, is_on_all_workspaces() { return Boolean(this.sticky); },
            is_above() { return Boolean(this.above); }, is_fullscreen() { return Boolean(this.fullscreen); },
            get_monitor() { return this.monitor; }, get_workspace() { return this.ws; },
            get_stable_sequence() { return this.id; }, can_maximize: () => true,
            get_maximized() { return this.maximized; }, get_title: () => 'test',
            maximize() { this.maximized = 3; this.emit('notify::maximized-horizontally'); },
            unmaximize() { this.maximized = 0; this.emit('notify::maximized-horizontally'); },
            get_frame_rect() { return this.rect; },
            get_work_area_for_monitor(m) { return this.ws.get_work_area_for_monitor(m); },
            move_resize_frame(_, x, y, width, height) {
                this.rect = {x, y, width, height}; this.moves.push(this.rect); this.emit('size-changed');
            },
            change_workspace(ws) { this.ws = ws; this.emit('workspace-changed'); },
            move_to_monitor(m) { this.monitor = m; display.emit('window-entered-monitor', m, this); },
            make_above() { this.above = true; this.emit('notify::above'); },
            minimize() { this.minimized = true; this.emit('notify::minimized'); },
        });
        windows.push(w);
        return w;
    }
    return {layouts, engine, window, queue, display, wm, mutter, main, overlays, workspaces, load};
}

test('per-monitor auto maximize, 1→2→1 transitions and no resize loop', async () => {
    const f = await fixture();
    const a = f.window(), b = f.window(1);
    f.layouts.reconcileWindow(a); f.layouts.reconcileWindow(b); f.queue.flush();
    assert.equal(a.maximized, 3); assert.equal(b.maximized, 3);
    const c = f.window(); f.layouts.reconcileWindow(c); f.queue.flush();
    assert.equal(a.maximized, 0); assert.equal(b.maximized, 3);
    assert.equal(a.rect.width + c.rect.width, 1000);
    const count = a.moves.length;
    f.layouts.queueAll(); f.queue.flush(); assert.equal(a.moves.length, count);
    c.emit('unmanaged'); f.queue.flush(); assert.equal(a.maximized, 3);
    f.layouts.destroy(); assert.equal(a.maximized, 0); assert.equal(b.maximized, 0);
});

test('workspace and monitor moves reconcile both sides without moving other windows', async () => {
    const f = await fixture(); const a = f.window(), b = f.window();
    f.layouts.reconcileWindow(a); f.layouts.reconcileWindow(b); f.queue.flush();
    b.move_to_monitor(1); f.queue.flush();
    assert.equal(a.maximized, 3); assert.equal(b.maximized, 3); assert.equal(a.monitor, 0);
    b.change_workspace(f.workspaces[1]); f.queue.flush();
    assert.equal(f.layouts.isManaged(b), true);
    f.mutter.get_boolean = () => true; f.mutter.emit('changed::workspaces-only-on-primary'); f.queue.flush();
    assert.equal(f.layouts.isManaged(b), false); assert.equal(b.maximized, 0);
});

test('constraint and placeholder roots keep geometry; minimized/fullscreen/above windows are excluded', async () => {
    const f = await fixture('code');
    f.engine.layouts = {code: {type: 'constraint', children: [{...slot('editor'), x: .1, y: .2, width: .5, height: .5}]}};
    f.layouts.reload();
    const a = f.window(); f.layouts.reconcileWindow(a); f.queue.flush();
    assert.equal(a.maximized, 0); assert.equal(a.rect.width, 500);
    for (const [property, signal] of [['minimized', 'notify::minimized'], ['fullscreen', 'notify::fullscreen'], ['above', 'notify::above']]) {
        a[property] = true; a.emit(signal); f.queue.flush(); assert.equal(f.layouts.isManaged(a), false);
        a[property] = false; a.emit(signal); f.queue.flush(); assert.equal(f.layouts.isManaged(a), true);
    }
    f.engine.layouts = {code: slot('editor')}; f.layouts.reload(); f.queue.flush();
    assert.equal(a.rect.width, 1000); assert.equal(a.maximized, 0);
});

test('reload preserves unchanged weights and named assignments, removed presets fall back', async () => {
    const f = await fixture('code'); const a = f.window(), b = f.window();
    f.layouts.reconcileWindow(a, {layout_placeholder: 'terminal'}); f.layouts.reconcileWindow(b); f.queue.flush();
    let tree = f.layouts._states.get(f.workspaces[0]).trees.get(0);
    tree.root.children[0].weight = 3;
    f.layouts.reload(); f.queue.flush();
    assert.equal(f.layouts._states.get(f.workspaces[0]).trees.get(0), tree);
    f.engine.layouts = {code: {type: 'vbox', children: [slot('terminal'), slot('editor')]}};
    f.layouts.reload(); f.queue.flush();
    tree = f.layouts._states.get(f.workspaces[0]).trees.get(0);
    assert.equal(tree.root.children[0].window, a);
    f.engine.layouts = {}; f.layouts.reload(); f.queue.flush();
    assert.equal(f.layouts.getActivePreset(f.workspaces[0]), 'hbox');
});

test('manual resize snaps back; constrained client geometry does not cause a retry loop', async () => {
    const f = await fixture(); const a = f.window(), b = f.window();
    f.layouts.reconcileWindow(a); f.layouts.reconcileWindow(b); f.queue.flush();
    const intended = {...a.rect};
    a.rect.width = 900; f.display.emit('grab-op-end', a); f.queue.flush();
    assert.deepEqual(a.rect, intended);
    a.rect.width = 900; a.emit('size-changed'); const count = a.moves.length;
    f.layouts.queueAll(); f.queue.flush(); assert.equal(a.moves.length, count);
});

test('dispatcher gives assigned windows priority and cancels stale deferred place', async () => {
    const f = await fixture('none');
    const {ActionDispatcher} = await f.load('lib/actions/dispatcher.js');
    const {SourceTracker} = await f.load('lib/utils/sourceTracker.js');
    const dispatcher = new ActionDispatcher({}, new SourceTracker(), f.layouts);
    const a = f.window(); dispatcher.apply(a, {place: 'left-half'});
    f.layouts.applyPreset(f.workspaces[0], 'hbox');
    dispatcher.apply(a, {maximize: false, place: 'right-half'});
    f.queue.flush(); assert.equal(a.maximized, 3); assert.equal(a.moves.length, 0);
    const b = f.window(); dispatcher.apply(b, {place: 'center', maximize: true}); f.queue.flush();
    assert.equal(a.maximized, 0); assert.equal(b.maximized, 0);
    assert.equal(a.rect.width + b.rect.width, 1000);
    dispatcher.apply(b, {float: true, place: 'center'}); f.queue.flush();
    assert.equal(f.layouts.isManaged(b), false); assert.equal(b.rect.width, 800);
});

test('disable clears callbacks and handlers while pending; overlays hide in overview', async () => {
    const f = await fixture('code');
    const a = f.window(); f.layouts.reconcileWindow(a); f.queue.flush();
    f.main.overview.visible = true; f.main.overview.emit('showing'); f.queue.flush();
    assert.equal(f.overlays[0].descriptors.length, 0);
    f.layouts.queueAll(); f.layouts.destroy(); f.queue.flush();
    assert.equal(f.queue.tasks.size, 0); assert.equal(a.handlers.size, 0);
    assert.equal(f.display.handlers.size, 0); assert.equal(f.overlays[0].destroyed, true);
});

test('leaving auto-maximize does not overwrite an explicit unmanaged maximize rule', async () => {
    const f = await fixture();
    const {ActionDispatcher} = await f.load('lib/actions/dispatcher.js');
    const {SourceTracker} = await f.load('lib/utils/sourceTracker.js');
    const dispatcher = new ActionDispatcher({}, new SourceTracker(), f.layouts);
    const a = f.window(); dispatcher.apply(a, {}); f.queue.flush();
    assert.equal(a.maximized, 3);
    dispatcher.apply(a, {float: true, maximize: true}); f.queue.flush();
    assert.equal(a.maximized, 3);
    f.layouts.destroy(); assert.equal(a.maximized, 3);
});

test('disable preserves maximization that predated layout ownership', async () => {
    const f = await fixture(); const a = f.window(); a.maximized = 3;
    f.layouts.reconcileWindow(a); f.queue.flush(); f.layouts.destroy();
    assert.equal(a.maximized, 3);
});

test('maximized windows retain membership when interactive resize is unavailable', async () => {
    const f = await fixture(); const a = f.window();
    let maximizes = 0, unmaximizes = 0;
    const maximize = a.maximize, unmaximize = a.unmaximize;
    a.maximize = function () { maximizes++; maximize.call(this); };
    a.unmaximize = function () { unmaximizes++; unmaximize.call(this); };
    f.layouts.reconcileWindow(a); f.queue.flush();
    assert.equal(a.allows_resize(), false);
    assert.equal(f.layouts.isManaged(a), true);
    for (let i = 0; i < 20; i++) { f.layouts.queueAll(); f.queue.flush(); }
    assert.equal(maximizes, 1); assert.equal(unmaximizes, 0);
    a.resizeable = false; a.emit('notify::resizeable'); f.queue.flush();
    assert.equal(f.layouts.isManaged(a), false); assert.equal(unmaximizes, 1);
});

test('event storms produce one pending layout batch, and disable cancels it', async () => {
    const f = await fixture();
    for (let i = 0; i < 100; i++) f.layouts.queueAll();
    assert.equal(f.queue.tasks.size, 1);
    f.layouts.destroy(); assert.equal(f.queue.tasks.size, 0);
});

test('unmaximize waits for Mutter notification instead of polling an unsettled window', async () => {
    const f = await fixture(); const a = f.window(), b = f.window();
    a.maximized = 3; let requests = 0;
    a.unmaximize = () => { requests++; }; // Deferred/rejected by compositor, no acknowledgement yet.
    f.layouts.reconcileWindow(a); f.layouts.reconcileWindow(b); f.queue.flush();
    assert.equal(requests, 1); assert.equal(f.queue.tasks.size, 0);
    a.maximized = 0; a.emit('notify::maximized-horizontally'); f.queue.flush();
    assert.equal(a.rect.width + b.rect.width, 1000);
});

test('three windows on workspace four retain the full work-area height', async () => {
    const f = await fixture();
    const windows = [f.window(0, 3), f.window(0, 3), f.window(0, 3)];
    for (const window of windows) { f.layouts.reconcileWindow(window); f.queue.flush(); }
    assert.equal(f.wm.get_active_workspace(), f.workspaces[0]);
    for (const window of windows) {
        assert.equal(window.rect.height, 700); assert.equal(window.rect.y, 30);
        assert.equal(window.maximized, 0);
    }
    assert.equal(windows.reduce((sum, w) => sum + w.rect.width, 0), 1000);
});

test('directional focus skips floating and other-workspace windows and leaves geometry alone', async () => {
    const f = await fixture();
    const a = f.window(), b = f.window(), other = f.window(0, 1), floating = f.window();
    floating.above = true;
    for (const w of [a, b, other, floating]) f.layouts.reconcileWindow(w);
    f.queue.flush();
    let activated = null;
    b.activate = () => { activated = b; };
    f.display.focus_window = a;
    const before = a.moves.length + b.moves.length;
    f.layouts.focusDirection('right');
    assert.equal(activated, b);
    assert.equal(a.moves.length + b.moves.length, before);
    f.display.focus_window = b;
    f.layouts.focusDirection('right');
    activated = null;
    f.display.focus_window = floating;
    f.layouts.focusDirection('right');
    assert.equal(activated, null);
});

test('moving a tile swaps assignments, preserves focus and sizes, and stops at the monitor edge', async () => {
    const f = await fixture();
    const a = f.window(), b = f.window(), c = f.window(1);
    for (const w of [a, b, c]) f.layouts.reconcileWindow(w);
    f.queue.flush();
    const ax = a.rect.x, bx = b.rect.x, width = a.rect.width;
    f.display.focus_window = a;
    f.layouts.moveDirection('right');
    f.queue.flush();
    assert.equal(a.rect.x, bx);
    assert.equal(b.rect.x, ax);
    assert.equal(a.rect.width, width);
    assert.equal(f.display.focus_window, a);
    f.layouts.moveDirection('right');
    f.queue.flush();
    assert.equal(a.rect.x, bx);
    assert.equal(a.monitor, 0);
    f.layouts.moveDirection('left');
    f.queue.flush();
    assert.equal(a.rect.x, ax);
});

test('workspace defaults isolate geometry, preserve manual selections on reload and reset removed mappings', async () => {
    const f = await fixture();
    f.engine.layouts.browser = {type: 'hbox', children: [
        {type: 'placeholder', name: 'browser', weight: 70, skipIfEmpty: true},
        {type: 'vbox', weight: 30, dynamic: true, children: []}]};
    f.engine.workspaceLayouts = {'1': 'browser'};
    f.layouts.reload();
    const a = f.window(), browser = f.window(), b = f.window(), other = f.window(0, 1);
    f.layouts.reconcileWindow(a);
    f.layouts.reconcileWindow(browser, {layout_placeholder: 'browser'});
    f.layouts.reconcileWindow(b); f.layouts.reconcileWindow(other); f.queue.flush();
    assert.equal(browser.rect.width, 700); assert.equal(browser.rect.height, 700);
    assert.equal(a.rect.width, 300); assert.equal(a.rect.height, 350);
    assert.equal(b.rect.width, 300); assert.equal(b.rect.height, 350);
    assert.equal(other.maximized, 3);
    f.display.focus_window = browser;
    f.layouts.resizeDirection('right'); f.queue.flush();
    assert.equal(browser.rect.width, 750);
    f.layouts.reload(); f.queue.flush(); assert.equal(browser.rect.width, 750);
    a.emit('unmanaged'); b.emit('unmanaged'); f.queue.flush();
    assert.equal(browser.maximized, 3);
    const next = f.window(); f.layouts.reconcileWindow(next); f.queue.flush();
    assert.equal(browser.rect.width, 700); assert.equal(next.rect.width, 300);
    f.layouts.applyPreset(f.workspaces[0], 'vbox'); f.queue.flush();
    f.layouts.reload(); f.queue.flush();
    assert.equal(f.layouts.getActivePreset(f.workspaces[0]), 'vbox');
    f.engine.workspaceLayouts = {}; f.layouts.reload(); f.queue.flush();
    assert.equal(f.layouts.getActivePreset(f.workspaces[0]), 'hbox');
    assert.equal(browser.rect.width, 500);
    f.layouts.destroy();
});

function persistentSettings() {
    const values = {'default-layout': 'hbox', 'persist-layouts': true, 'saved-layouts': '{}', 'resize-grid-step': 5};
    return Object.assign(new Emitter(), {values, get_string: key => values[key],
        get_int: key => values[key], get_boolean: key => values[key], set_string: (key, value) => { values[key] = value; }});
}

test('saved selection and keyboard weights survive reload and incremental window discovery', async () => {
    const settings = persistentSettings();
    const f = await fixture('hbox', settings);
    const a = f.window(), b = f.window();
    f.layouts.reconcileWindow(a); f.layouts.reconcileWindow(b); f.queue.flush();
    f.layouts.applyPreset(f.workspaces[0], 'vbox'); f.queue.flush();
    f.display.focus_window = a; f.layouts.resizeDirection('down'); f.queue.flush();
    const height = a.rect.height;
    assert.equal(height, 385);
    f.layouts.destroy();
    const g = await fixture('hbox', settings);
    const c = g.window(); g.layouts.reconcileWindow(c); g.queue.flush();
    const d = g.window(); g.layouts.reconcileWindow(d); g.queue.flush();
    assert.equal(g.layouts.getActivePreset(g.workspaces[0]), 'vbox');
    assert.equal(c.rect.height, height);
    g.layouts.resetLayout(g.workspaces[0]); g.queue.flush();
    assert.equal(g.layouts.getActivePreset(g.workspaces[0]), 'hbox');
    assert.equal(c.rect.width, 500);
    assert.equal(JSON.parse(settings.values['saved-layouts']).workspaces['1'], undefined);
    g.layouts.destroy();
});

test('committed drag survives monitor index changes and named preset startup', async () => {
    const settings = persistentSettings();
    const f = await fixture('hbox', settings);
    f.main.layoutManager.monitors[0].id = 'left';
    f.main.layoutManager.monitors[1].id = 'right';
    f.main.layoutManager.emit('monitors-changed');
    const a = f.window(), b = f.window();
    f.layouts.reconcileWindow(a); f.layouts.reconcileWindow(b); f.queue.flush();
    f.layouts.applyPreset(f.workspaces[0], 'code'); f.queue.flush();
    const tree = f.layouts._states.get(f.workspaces[0]).trees.get(0);
    tree.root.children[0].weight = 3; tree.root.children[1].weight = 1;
    f.overlays[0].changed(); f.queue.flush();
    assert.equal(a.rect.width, 750);
    f.main.layoutManager.monitors.reverse(); a.monitor = 1; b.monitor = 1;
    f.main.layoutManager.emit('monitors-changed'); f.queue.flush();
    assert.equal(a.rect.width, 750);
    f.layouts.destroy();
    const g = await fixture('hbox', settings);
    g.main.layoutManager.monitors[0].id = 'left';
    g.main.layoutManager.emit('monitors-changed');
    const c = g.window(); g.layouts.reconcileWindow(c); g.queue.flush();
    const d = g.window(); g.layouts.reconcileWindow(d); g.queue.flush();
    assert.equal(c.rect.width, 750);
    g.engine.layouts = {code: {type: 'hbox', children: [{...slot('editor'), weight: 2}, slot('terminal')]}};
    g.layouts.reload(); g.queue.flush();
    assert.equal(c.rect.width, 667);
    g.layouts.destroy();
});

test('disabled persistence ignores saved state; workspace config changes override saved choices', async () => {
    const settings = persistentSettings();
    const f = await fixture('hbox', settings); f.queue.flush();
    f.layouts.applyPreset(f.workspaces[0], 'vbox'); f.queue.flush(); f.layouts.destroy();
    const saved = settings.values['saved-layouts'];
    settings.values['persist-layouts'] = false;
    const g = await fixture('hbox', settings); g.queue.flush();
    assert.equal(g.layouts.getActivePreset(g.workspaces[0]), 'hbox');
    const a = g.window(), b = g.window();
    g.layouts.reconcileWindow(a); g.layouts.reconcileWindow(b); g.queue.flush();
    g.display.focus_window = a; g.layouts.resizeDirection('right'); g.queue.flush();
    assert.equal(settings.values['saved-layouts'], saved);
    g.layouts.destroy(); settings.values['persist-layouts'] = true;
    const h = await fixture('hbox', settings); h.queue.flush();
    h.engine.workspaceLayouts = {'1': 'code'}; h.layouts.reload(); h.queue.flush();
    assert.equal(h.layouts.getActivePreset(h.workspaces[0]), 'code'); h.layouts.destroy();
    const i = await fixture('hbox', settings); i.queue.flush();
    assert.equal(i.layouts.getActivePreset(i.workspaces[0]), 'hbox'); i.layouts.destroy();
});

test('keyboard resize reads grid preference on every keypress', async () => {
    const settings = persistentSettings();
    const f = await fixture('hbox', settings);
    const a = f.window(), b = f.window();
    f.layouts.reconcileWindow(a); f.layouts.reconcileWindow(b); f.queue.flush();
    f.display.focus_window = a;
    f.layouts.resizeDirection('left'); f.queue.flush();
    assert.equal(a.rect.width, 450);
    settings.values['resize-grid-step'] = 10;
    f.layouts.resizeDirection('right'); f.queue.flush();
    assert.equal(a.rect.width, 500);
    f.layouts.resizeDirection('right'); f.queue.flush();
    assert.equal(a.rect.width, 600);
    assert.equal(f.display.focus_window, a);
    f.layouts.destroy();
});
