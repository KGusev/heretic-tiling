import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loader} from './modules.mjs';

test('inspection shares resolution order, honors stop, and leaves execution numbering unchanged', async () => {
    const config = {rules: [
        {priority: 20, comment: 'stop here', match: {wm_title: {regex: 'Editor', flags: 'g'}},
            actions: {move_to_workspace: 3, opacity: 0.8}, stop: true},
        {priority: 10, actions: {opacity: 0.5, maximize: true}},
        {priority: 30, actions: {opacity: 0.1}},
    ]};
    const load = loader({
        'gi://Meta': {default: {WindowType: {NORMAL: 0}}},
        'gi://GLib': {default: {}},
        'gi://Gio': {default: {File: {new_for_path: () => ({
            load_contents: () => [true, new TextEncoder().encode(JSON.stringify(config))],
        })}}},
    }, {global: {display: {get_primary_monitor: () => 1}}});
    const {RuleEngine} = await load('lib/rules/ruleEngine.js');
    const engine = new RuleEngine('/config');
    const window = {get_title: () => 'Editor', get_wm_class: () => 'Code',
        get_wm_class_instance: () => 'code', get_workspace: () => ({index: () => 1}),
        get_monitor: () => 1, is_above: () => false, window_type: 0};
    for (let i = 0; i < 3; i++) {
        const report = engine.inspect(window);
        assert.equal(report.properties.workspace, 2);
        assert.equal(report.properties.primary_monitor, true);
        assert.equal(report.properties.window_type, 'normal');
        assert.equal(report.rules.map(r => r.index).join(','), '2,1');
        assert.equal(report.rules[1].stop, true);
        assert.equal(report.actions.move_to_workspace, 3);
        assert.equal(report.actions.opacity, 0.8);
        assert.equal(report.actions.maximize, true);
        assert.equal(engine.resolveActions(window).actions.move_to_workspace, 2);
        assert.equal(engine.resolveActions(window).actions.opacity, 0.8);
    }
});

test('inspector captures before opening menu, copies snapshot, toggles and cleans up', async () => {
    const bindings = new Map();
    let copied, destroyed = 0, inspections = 0;
    const display = {focus_window: {name: 'target'}};
    class Actor { constructor(props) { Object.assign(this, props); } add_child() {} set_policy() {} }
    class Button extends Actor {
        constructor() {
            super();
            this.actions = new Map();
            this.menu = {addMenuItem() {}, addAction: (name, fn) => this.actions.set(name, fn),
                open() { display.focus_window = null; }};
        }
        destroy() { destroyed++; }
    }
    const load = loader({
        'gi://Clutter': {default: {ActorAlign: {CENTER: 0}}},
        'gi://Meta': {default: {KeyBindingFlags: {IGNORE_AUTOREPEAT: 1}}},
        'gi://Shell': {default: {ActionMode: {NORMAL: 1, POPUP: 2}}},
        'gi://St': {default: {Label: Actor, BoxLayout: Actor, ScrollView: Actor,
            PolicyType: {AUTOMATIC: 0}, ClipboardType: {CLIPBOARD: 0},
            Clipboard: {get_default: () => ({set_text: (_, text) => { copied = text; }})}}},
        'resource:///org/gnome/shell/ui/main.js': {
            wm: {addKeybinding: (key, _s, _f, _m, fn) => bindings.set(key, fn),
                removeKeybinding: key => bindings.delete(key)}, panel: {addToStatusArea() {}}},
        'resource:///org/gnome/shell/ui/panelMenu.js': {Button},
        'resource:///org/gnome/shell/ui/popupMenu.js': {PopupBaseMenuItem: Actor},
    }, {global: {display}});
    const {WindowInspector} = await load('lib/windowInspector.js');
    const inspector = new WindowInspector({}, {inspect(window) {
        inspections++; assert.equal(window.name, 'target');
        return {properties: {wm_title: 'Editor'}, rules: [], actions: {}};
    }}, {isManaged: () => true});
    inspector.enable();
    bindings.get('inspect-window-shortcut')();
    inspector._indicator.actions.get('Copy report')();
    assert.match(copied, /Editor/);
    assert.match(copied, /No matching rules/);
    assert.match(copied, /Tiling overrides/);
    bindings.get('inspect-window-shortcut')();
    assert.equal(destroyed, 1);
    assert.equal(inspector._indicator, null);
    bindings.get('inspect-window-shortcut')();
    inspector._indicator.actions.get('Copy report')();
    assert.match(copied, /No focused window/);
    assert.equal(inspections, 1);
    inspector.destroy();
    assert.equal(destroyed, 2);
    assert.equal(bindings.size, 0);
});
