import assert from 'node:assert/strict';
import {loader, scheduler} from './modules.mjs';
const queue = scheduler();
class Workspace {}
for (const method of ['_isMyWindow', '_onCloneSelected', 'acceptDrop'])
    Workspace.prototype[method] = () => 'native';
class WorkspacesDisplay {}
for (const method of [
    '_updateWorkspacesViews',
    '_onScrollEvent',
    '_onKeyPressEvent',
    '_updateSwipeTracker',
])
    WorkspacesDisplay.prototype[method] = () => 'native';
const original = Workspace.prototype._isMyWindow;
class InjectionManager {
    constructor() {
        this.restore = [];
    }
    overrideMethod(object, name, factory) {
        const old = object[name];
        this.restore.push(() => (object[name] = old));
        object[name] = factory(old);
    }
    clear() {
        for (const restore of this.restore.reverse()) restore();
        this.restore = [];
    }
}
class ThumbnailsBox {
    _updateShouldShow() {}
}
let hidden = 0;
const load = loader(
    {
        'gi://Clutter': {
            default: {
                ScrollDirection: {UP: 0, DOWN: 1},
                Orientation: {HORIZONTAL: 0},
                EVENT_STOP: 1,
                EVENT_PROPAGATE: 0,
                KEY_Page_Up: 10,
                KEY_Page_Down: 11,
                KEY_Home: 12,
                KEY_End: 13,
            },
        },
        'gi://GObject': {default: {registerClass: (cls) => cls}},
        'gi://Shell': {default: {ActionMode: {OVERVIEW: 1}}},
        'resource:///org/gnome/shell/ui/swipeTracker.js': {
            SwipeTracker: class {
                constructor() {
                    this.handlers = {};
                }
                connect(name, callback) {
                    this.handlers[name] = callback;
                }
                confirmSwipe(distance, points, position) {
                    this.position = position;
                }
                destroy() {}
            },
        },
        'gi://St': {default: {Widget: class {}}},
        'gi://GLib': {default: queue.glib},
        'resource:///org/gnome/shell/ui/main.js': {
            overview: {hide: () => hidden++, connect: () => 1, disconnect() {}},
            layoutManager: {
                monitors: [{width: 1000}, {width: 1000}],
                connect: () => 1,
                disconnect() {},
            },
        },
        'resource:///org/gnome/shell/ui/layout.js': {},
        'resource:///org/gnome/shell/ui/workspaceThumbnail.js': {ThumbnailsBox},
        'resource:///org/gnome/shell/ui/workspace.js': {Workspace},
        'resource:///org/gnome/shell/ui/workspacesView.js': {WorkspacesDisplay},
        'resource:///org/gnome/shell/extensions/extension.js': {InjectionManager},
    },
    {global: {workspace_manager: {connect: () => 1, disconnect() {}}}},
);
const {OverviewIntegration} = await load('lib/overviewIntegration.js');
const activated = [],
    moved = [];
const model = {
    workspacesOn: () => [1, 4, 7],
    activeIndex: () => 4,
    activateWorkspace: (index) => activated.push(index),
    windowBelongsTo: (_, index, monitor) => index === 4 && monitor === 1,
    move: (window, index) => {
        moved.push([window, index]);
        return true;
    },
};
const integration = new OverviewIntegration(model);
integration.enable();
const workspace = Object.assign(new Workspace(), {
    metaWorkspace: {index: () => 4},
    monitorIndex: 1,
});
assert.equal(workspace._isMyWindow({}), true);
integration.select(1, 1);
assert.equal(activated.pop(), 7);
integration.key(1, {get_key_symbol: () => 12});
assert.equal(activated.pop(), 1);
let focused = 0;
workspace._onCloneSelected({metaWindow: {activate: () => focused++}}, 123);
assert.equal(activated.pop(), 4);
assert.equal(focused, 1);
assert.equal(hidden, 1);
const window = {};
assert.equal(workspace.acceptDrop({metaWindow: window}), true);
assert.deepEqual(moved.pop(), [window, 4]);
integration._swipe.handlers.begin(integration._swipe, 1);
assert.equal(integration._swipe.position, 1);
integration._swipe.handlers.end(integration._swipe, 200, 2);
assert.equal(activated.pop(), 7, 'swipes use local positions, not native workspace indices');
const launched = {};
let opened = false;
integration.launch(
    {
        get_windows: () => (opened ? [launched] : []),
        open_new_window: () => {
            opened = true;
        },
    },
    4,
);
queue.flush();
assert.deepEqual(moved.pop(), [launched, 4]);
let refreshes = 0;
integration.views.add({refresh: () => refreshes++});
for (let i = 0; i < 100; i++) integration.refresh();
assert.equal(queue.tasks.size, 1);
queue.flush();
assert.equal(refreshes, 1);
integration.refresh();
integration.destroy();
assert.equal(queue.tasks.size, 0);
assert.equal(Workspace.prototype._isMyWindow, original);
