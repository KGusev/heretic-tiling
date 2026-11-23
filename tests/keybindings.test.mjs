// Run with: node --experimental-vm-modules --test tests/keybindings.test.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

async function fixture(count = 10, arrows = false, fullscreen = []) {
    const bindings = new Map();
    const manager = {
        active: null,
        get_active_workspace() {
            return this.active;
        },
        get_workspace_by_index(i) {
            return this.workspaces[i] ?? null;
        },
        get_n_workspaces() {
            return this.workspaces.length;
        },
    };
    manager.workspaces = Array.from({length: count}, () => ({
        activate() {
            manager.active = this;
        },
    }));
    manager.active = manager.workspaces[1];
    const wm = {
        addKeybinding(key, settings, flags, modes, callback) {
            assert.equal(modes, 3);
            bindings.set(key, callback);
        },
        removeKeybinding(key) {
            bindings.delete(key);
        },
    };
    const context = vm.createContext({
        global: {workspace_manager: manager, get_current_time: () => 123},
    });
    const module = new vm.SourceTextModule(
        readFileSync(
            new URL('../heretic-tiling@kgusev-on-github/lib/keybindings.js', import.meta.url),
            'utf8',
        ),
        {context},
    );
    await module.link((specifier) => {
        const exports =
            specifier === 'gi://Meta'
                ? {default: {KeyBindingFlags: {NONE: 0}}}
                : specifier === 'gi://Shell'
                  ? {default: {ActionMode: {NORMAL: 1, OVERVIEW: 2}}}
                  : {wm};
        return new vm.SyntheticModule(
            Object.keys(exports),
            function () {
                for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
            },
            {context},
        );
    });
    await module.evaluate();
    const settings = () => ({
        values: new Map(),
        get_strv(key) {
            const number = Number(key.split('-').at(-1));
            if (number > 12) throw new Error('Unknown native workspace key');
            return this.values.get(key) ?? [`original:${key}`];
        },
        set_strv(key, value) {
            this.values.set(key, Array.from(value));
        },
    });
    const native = settings();
    native.values.set('toggle-fullscreen', fullscreen);
    if (arrows) {
        native.values.set('switch-input-source', ['<Super>space', '<Alt>space']);
        native.values.set('switch-input-source-backward', ['<Shift><Mod4>space']);
    }
    const shell = settings();
    const mutter = settings();
    if (arrows) {
        native.values.set('move-to-monitor-right', ['<Shift><Super>Right', '<Alt>F9']);
        native.values.set('move-to-workspace-up', ['<Super><Shift>Up', '<Control><Alt><Shift>Up']);
        native.values.set('maximize', ['<Super>Up', '<Alt>F10']);
        native.values.set('unmaximize', ['<Super>Down']);
        mutter.values.set('toggle-tiled-left', ['<Mod4>Left', '<Alt>Left']);
        mutter.values.set('toggle-tiled-right', ['<Super>Right']);
    }
    const keys = new module.namespace.KeybindingsManager(native, shell, {}, count, mutter);
    keys.setup();
    return {
        keys,
        manager,
        native,
        shell,
        mutter,
        bindings,
        press(n) {
            bindings.get(`toggle-workspace-${n}`)();
        },
        active() {
            return manager.workspaces.indexOf(manager.active) + 1;
        },
    };
}

test('repeated number shortcuts toggle and share history', async () => {
    const f = await fixture();
    for (const expected of [5, 2, 5, 2]) {
        f.press(5);
        assert.equal(f.active(), expected);
    }
    f.press(5);
    f.press(3);
    f.press(3);
    assert.equal(f.active(), 5);
    f.press(10);
    assert.equal(f.active(), 10);
    f.press(10);
    assert.equal(f.active(), 5);
});

test('external switches do not update keyboard history', async () => {
    const f = await fixture();
    f.press(5);
    f.manager.workspaces[6].activate();
    f.press(7);
    assert.equal(f.active(), 2);
});

test('no history, removed target, and failed activation preserve history', async () => {
    const f = await fixture();
    f.press(2);
    assert.equal(f.active(), 2);
    f.press(5);
    f.manager.workspaces[2].activate = () => {};
    f.press(3);
    assert.equal(f.active(), 5);
    f.press(5);
    assert.equal(f.active(), 2);
    f.press(5);
    f.manager.workspaces.splice(1, 1);
    f.press(4);
    assert.equal(f.active(), 4); // Same workspace object; previous was removed.
    f.keys._switchWorkspace(100);
    assert.equal(f.active(), 4);
});

test('configured counts, native move bindings, restoration, and fresh history', async () => {
    for (const count of [2, 10, 20]) {
        const f = await fixture(count);
        assert.equal(f.bindings.size, Math.min(count, 10));
        assert.deepEqual(f.native.values.get('switch-to-workspace-1'), []);
        assert.deepEqual(f.native.values.get('move-to-workspace-1'), ['<Super><Shift>1']);
        f.press(1);
        f.keys.restore();
        assert.equal(f.bindings.size, 0);
        for (const settings of [f.native, f.shell])
            for (const [key, value] of settings.values)
                assert.deepEqual(value, key === 'toggle-fullscreen' ? [] : [`original:${key}`]);
        f.keys.setup();
        f.press(1);
        assert.equal(f.active(), 1);
        f.keys.restore();
    }
});

test('Win+F enables native fullscreen toggling and restores previous shortcuts', async () => {
    for (const original of [[], ['<Alt>F11'], ['<Super>F', '<Mod4>f', '<Alt>F11']]) {
        const f = await fixture(10, false, original);
        const expected = [...original.filter((k) => k === '<Alt>F11'), '<Super>f'];
        assert.deepEqual(f.native.values.get('toggle-fullscreen'), expected);
        f.keys.restore();
        assert.deepEqual(f.native.values.get('toggle-fullscreen'), original);
        f.keys.setup();
        assert.deepEqual(f.native.values.get('toggle-fullscreen'), expected);
        f.keys.restore();
        assert.deepEqual(f.native.values.get('toggle-fullscreen'), original);
    }
});

test('arrow navigation frees native accelerators and restores alternatives on disable', async () => {
    const f = await fixture(10, true);
    assert.deepEqual(f.native.values.get('move-to-monitor-right'), ['<Alt>F9']);
    assert.deepEqual(f.native.values.get('move-to-workspace-up'), ['<Control><Alt><Shift>Up']);
    assert.deepEqual(f.native.values.get('maximize'), ['<Alt>F10']);
    assert.deepEqual(f.native.values.get('unmaximize'), []);
    assert.deepEqual(f.mutter.values.get('toggle-tiled-left'), ['<Alt>Left']);
    assert.deepEqual(f.mutter.values.get('toggle-tiled-right'), []);
    f.keys.restore();
    assert.deepEqual(f.native.values.get('move-to-monitor-right'), [
        '<Shift><Super>Right',
        '<Alt>F9',
    ]);
    assert.deepEqual(f.native.values.get('maximize'), ['<Super>Up', '<Alt>F10']);
    assert.deepEqual(f.mutter.values.get('toggle-tiled-left'), ['<Mod4>Left', '<Alt>Left']);
});

test('floating shortcuts free input-source accelerators and restore them on disable', async () => {
    const f = await fixture(10, true);
    assert.deepEqual(f.native.get_strv('switch-input-source'), ['<Alt>space']);
    assert.deepEqual(f.native.get_strv('switch-input-source-backward'), []);
    f.keys.restore();
    assert.deepEqual(f.native.get_strv('switch-input-source'), ['<Super>space', '<Alt>space']);
    assert.deepEqual(f.native.get_strv('switch-input-source-backward'), ['<Shift><Mod4>space']);
});
