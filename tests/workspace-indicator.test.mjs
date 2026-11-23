import assert from 'node:assert/strict';
import {loader} from './modules.mjs';

const load = loader({
    'gi://St': {default: {}},
    'gi://Clutter': {default: {}},
    'resource:///org/gnome/shell/ui/main.js': {layoutManager: {primaryIndex: 0}},
    'resource:///org/gnome/shell/ui/popupMenu.js': {},
});
const {WorkspaceIndicator} = await load('lib/workspaceIndicator.js');
const indicator = Object.create(WorkspaceIndicator.prototype);
indicator._monitor = 0;
indicator._monitorWorkspaces = {
    monitorForWorkspace: (index) => (index === 0 ? 0 : 1),
    activeIndex: (monitor) => monitor,
    isSecondary: (monitor) => monitor === 1,
    windowsAt: (monitor, index) => [{monitor, index}],
};
indicator._buttons = Array.from({length: 3}, () => ({
    visible: false,
    classes: new Set(),
    add_style_class_name(name) {
        this.classes.add(name);
    },
    remove_style_class_name(name) {
        this.classes.delete(name);
    },
    has_style_class_name(name) {
        return this.classes.has(name);
    },
}));
indicator._refresh();
assert.ok(indicator._buttons.every((button) => button.visible));
assert.ok(!indicator._buttons[0].classes.has('workspace-button-remote'));
assert.ok(indicator._buttons[1].classes.has('workspace-button-remote'));
assert.ok(indicator._buttons[1].classes.has('workspace-button-active'));
assert.ok(!indicator._buttons[2].classes.has('workspace-button-active'));
assert.equal(indicator._windowsAt(2)[0].monitor, 1);
indicator._monitor = 1;
indicator._refresh();
assert.ok(indicator._buttons[0].classes.has('workspace-button-remote'));
assert.ok(!indicator._buttons[1].classes.has('workspace-button-remote'));
