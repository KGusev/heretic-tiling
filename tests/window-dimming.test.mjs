import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loader, Emitter} from './modules.mjs';

async function fixture() {
    const display = Object.assign(new Emitter(), {focus_window: null});
    const wm = new Emitter(),
        overview = new Emitter(),
        actors = [];
    const values = {'dim-unfocused-windows': true, 'unfocused-window-dim-percent': 20};
    const settings = Object.assign(new Emitter(), {
        get_boolean: (key) => values[key],
        get_int: (key) => values[key],
    });
    const actor = (type = 0) => {
        const a = Object.assign(new Emitter(), {
            meta_window: {get_window_type: () => type},
            opacity: 180,
            effects: new Set(),
            add_effect_with_name: (_name, effect) => a.effects.add(effect),
            remove_effect: (effect) => a.effects.delete(effect),
        });
        actors.push(a);
        return a;
    };
    const first = actor(),
        second = actor(),
        popup = actor(9);
    display.focus_window = first.meta_window;
    const load = loader(
        {
            'gi://Clutter': {
                default: {
                    BrightnessContrastEffect: class {
                        set_brightness(value) {
                            this.brightness = value;
                        }
                    },
                },
            },
            'gi://Meta': {
                default: {WindowType: {NORMAL: 0, DIALOG: 1, MODAL_DIALOG: 2, UTILITY: 3}},
            },
            'resource:///org/gnome/shell/ui/main.js': {overview},
        },
        {global: {display, window_manager: wm, get_window_actors: () => actors}},
    );
    const {WindowDimming} = await load('lib/windowDimming.js');
    const rules = new Map(),
        reloadListeners = new Set();
    const ruleEngine = {
        resolveActions: (window) => ({actions: rules.get(window) ?? {}}),
        onReload: (callback) => {
            reloadListeners.add(callback);
            return () => reloadListeners.delete(callback);
        },
    };
    return {
        manager: new WindowDimming(settings, ruleEngine),
        rules,
        reloadListeners,
        display,
        wm,
        overview,
        settings,
        values,
        actors,
        actor,
        first,
        second,
        popup,
    };
}

test('focus and live settings update brightness without changing opacity or other effects', async () => {
    const f = await fixture();
    const other = {};
    f.second.effects.add(other);
    assert.equal(f.first.effects.size, 0);
    assert.equal(f.popup.effects.size, 0);
    assert.equal([...f.second.effects][0].brightness, -0.2);
    f.values['unfocused-window-dim-percent'] = 45;
    f.settings.emit('changed::unfocused-window-dim-percent');
    assert.equal([...f.second.effects][0].brightness, -0.45);
    f.display.focus_window = f.second.meta_window;
    f.display.emit('notify::focus-window');
    assert.deepEqual([...f.second.effects], [other]);
    assert.equal(f.first.effects.size, 1);
    assert.equal(f.second.opacity, 180);
    f.values['dim-unfocused-windows'] = false;
    f.settings.emit('changed::dim-unfocused-windows');
    assert.equal(f.first.effects.size, 0);
    f.manager.destroy();
});

test('new actors, overview, actor destruction and extension cleanup', async () => {
    const f = await fixture();
    const added = f.actor();
    f.wm.emit('map', added);
    assert.equal(added.effects.size, 1);
    f.overview.emit('showing');
    assert.equal(added.effects.size, 0);
    f.overview.emit('hidden');
    assert.equal(added.effects.size, 1);
    added.emit('destroy');
    f.actors.splice(f.actors.indexOf(added), 1);
    assert.equal(added.handlers.size, 0);
    f.manager.destroy();
    assert.equal(f.second.effects.size, 0);
    assert.equal(f.reloadListeners.size, 0);
    for (const obj of [f.display, f.wm, f.overview, f.settings, f.second])
        assert.equal(obj.handlers.size, 0);
});

test('no_focus overlays, unsupported windows and absent focus do not dim other windows', async () => {
    const f = await fixture();
    const toolbar = f.actor();
    f.rules.set(toolbar.meta_window, {no_focus: true, maximize: false, float: true});
    for (const focused of [toolbar.meta_window, f.popup.meta_window, null]) {
        f.display.focus_window = focused;
        f.display.emit('notify::focus-window');
        for (const actor of f.actors) assert.equal(actor.effects.size, 0);
    }
    f.display.focus_window = f.second.meta_window;
    f.display.emit('notify::focus-window');
    assert.equal(f.first.effects.size, 1);
    assert.equal(f.second.effects.size, 0);
    f.manager.destroy();
});

test('rule reload immediately updates whether the focused window may dim others', async () => {
    const f = await fixture();
    f.rules.set(f.first.meta_window, {no_focus: true});
    for (const callback of f.reloadListeners) callback();
    assert.equal(f.second.effects.size, 0);
    f.rules.set(f.first.meta_window, {no_focus: false, float: true});
    for (const callback of f.reloadListeners) callback();
    assert.equal(f.second.effects.size, 1);
    f.manager.destroy();
});
