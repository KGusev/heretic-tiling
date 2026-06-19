import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loader, Emitter} from './modules.mjs';

async function fixture() {
    const bindings = new Map(), wm = new Emitter(), actions = [];
    let destroyed = false;
    const load = loader({
        'gi://Meta': {default: {KeyBindingFlags: {NONE: 0, IGNORE_AUTOREPEAT: 16}}},
        'gi://Shell': {default: {ActionMode: {NORMAL: 1, OVERVIEW: 2}}},
        'gi://Clutter': {default: {ActorAlign: {CENTER: 2}}},
        'gi://St': {default: {Label: class { constructor(props) { Object.assign(this, props); } destroy() { destroyed = true; } }}},
        'resource:///org/gnome/shell/ui/main.js': {panel: {_leftBox: {add_child() {}}},
            wm: {addKeybinding: (name, settings, flags, mode, fn) => bindings.set(name, fn),
                removeKeybinding: name => bindings.delete(name)}},
        'resource:///org/gnome/shell/ui/overviewControls.js': {ControlsState: {APP_GRID: 1}},
    }, {global: {workspace_manager: wm}});
    const {ShortcutsManager} = await load('lib/shortcuts.js');
    const shortcuts = new ShortcutsManager({}, {
        focusDirection: d => actions.push('focus:' + d),
        moveDirection: d => actions.push('move:' + d),
        resizeDirection: d => actions.push('resize:' + d),
    });
    shortcuts.enable();
    return {shortcuts, bindings, wm, actions, destroyed: () => destroyed,
        press: name => bindings.get(name)()};
}

test('modes route modified arrows, preserve focus arrows, and grab Escape only in Resize', async () => {
    const f = await fixture();
    assert.equal(f.shortcuts.mode, 'normal');
    assert.ok(!f.bindings.has('exit-resize-mode-shortcut'));
    f.press('resize-right-shortcut');
    f.press('focus-left-shortcut');
    f.press('toggle-resize-mode-shortcut');
    assert.equal(f.shortcuts.mode, 'resize');
    assert.equal(f.shortcuts._modeLabel.visible, true);
    f.press('resize-down-shortcut');
    f.press('focus-up-shortcut');
    f.press('exit-resize-mode-shortcut');
    assert.equal(f.shortcuts.mode, 'normal');
    assert.equal(f.shortcuts._modeLabel.visible, false);
    assert.ok(!f.bindings.has('exit-resize-mode-shortcut'));
    assert.deepEqual(f.actions, ['move:right', 'focus:left', 'resize:down', 'focus:up']);
    f.press('toggle-resize-mode-shortcut');
    f.press('toggle-resize-mode-shortcut');
    assert.equal(f.shortcuts.mode, 'normal');
});
test('workspace changes and disable reset mode and remove every binding/signal', async () => {
    const f = await fixture();
    f.press('toggle-resize-mode-shortcut');
    f.wm.emit('workspace-switched');
    assert.equal(f.shortcuts.mode, 'normal');
    assert.ok(!f.bindings.has('exit-resize-mode-shortcut'));
    f.press('toggle-resize-mode-shortcut');
    f.shortcuts.disable();
    assert.equal(f.shortcuts.mode, 'normal');
    assert.equal(f.bindings.size, 0);
    assert.equal(f.wm.handlers.size, 0);
    assert.equal(f.destroyed(), true);
});
