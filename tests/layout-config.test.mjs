import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {loader, Emitter, scheduler} from './modules.mjs';
const bytes = v => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));
const Meta = {WindowType: {NORMAL: 0}, TabList: {NORMAL_ALL: 0}};

test('reload publishes once, retains last good layout catalog, and skips invalid rules', async () => {
    let config = {rules: [], layouts: {main: {type: 'placeholder', name: 'main'}}};
    const load = loader({'gi://Meta': {default: Meta}, 'gi://GLib': {default: {}},
        'gi://Gio': {default: {File: {new_for_path: () => ({load_contents: () => [true, bytes(config)]})}}}});
    const {RuleEngine} = await load('lib/rules/ruleEngine.js');
    const engine = new RuleEngine('/config');
    const catalog = engine.layouts;
    let reloads = 0; engine.onReload(() => reloads++);
    engine._parseAndApply(bytes({rules: [{actions: {layout_placeholder: 'main'}}, {actions: {unknown: 1}}],
        layouts: {broken: {type: 'bogus'}}}), 'test');
    assert.equal(reloads, 1); assert.equal(engine.layouts, catalog); assert.equal(engine._rules.length, 1);
    assert.throws(() => engine._parseAndApply(bytes('{'), 'test'));
    assert.equal(reloads, 1); assert.equal(engine.layouts, catalog);
    engine._parseAndApply(bytes({rules: [], layouts: {other: {type: 'placeholder'}}}), 'test');
    assert.equal(reloads, 2); assert.ok(engine.layouts.other);
    const {validateRules} = await load('lib/rules/validator.js');
    const bundled = readFileSync(new URL('../heretic-tiling@kgusev-on-github/config.json', import.meta.url), 'utf8');
    assert.equal(validateRules(bundled).errors.length, 0);
});

test('first title rule on reload applies to existing windows and title changes', async () => {
    const q = scheduler(); const display = new Emitter(); const window = new Emitter();
    window.get_stable_sequence = () => 1; window.get_title = () => 'new title';
    const ws = {list_windows: () => [window]};
    display.get_tab_list = () => [window];
    const wm = {get_n_workspaces: () => 1, get_workspace_by_index: () => ws};
    let titleRules = false, reload, calls = 0;
    const engine = {onReload(fn) { reload = fn; return () => { reload = null; }; },
        hasTitleRules: () => titleRules, resolveActions: () => ({actions: {layout_placeholder: 'editor'}, allowNonNormal: false})};
    const load = loader({'gi://Meta': {default: Meta}, 'gi://GLib': {default: q.glib}}, {global: {display, workspace_manager: wm}});
    const {WindowTracker} = await load('lib/windowTracker.js');
    const {SourceTracker} = await load('lib/utils/sourceTracker.js');
    const tracker = new WindowTracker(engine, {apply() { calls++; }}, new SourceTracker());
    tracker.enable(); assert.equal(calls, 1);
    window.emit('notify::title'); assert.equal(calls, 1);
    titleRules = true; reload(); assert.equal(calls, 2);
    window.emit('notify::title'); assert.equal(calls, 3);
    reload(); window.emit('notify::title'); assert.equal(calls, 5);
    tracker.destroy(); assert.equal(window.handlers.size, 0); assert.equal(reload, null);
});

test('focus manager teardown preserves external listeners and cancels pending focus', async () => {
    const q = scheduler(); const display = new Emitter(); const w = new Emitter();
    display.focus_window = w; display.list_all_windows = () => [w];
    let calls = 0;
    display.connect('notify::focus-window', () => calls++);
    const load = loader({'gi://Meta': {default: Meta}, 'gi://GLib': {default: q.glib},
        'gi://Clutter': {default: {}}}, {global: {display}});
    const {FocusManager} = await load('lib/focusManager.js');
    const focus = new FocusManager({get_boolean: key => key === 'focus-next-on-close'});
    w.get_workspace = () => null;
    focus.enable(); w.emit('unmanaging'); w.emit('unmanaged');
    assert.equal(q.tasks.size, 1); focus.destroy(); q.flush();
    display.emit('notify::focus-window'); assert.equal(calls, 1);
    assert.equal(display.handlers.size, 1);
});

test('workspace mapping and catalog reload atomically and validate in preferences', async () => {
    const load = loader({'gi://Meta': {default: Meta}, 'gi://GLib': {default: {}},
        'gi://Gio': {default: {File: {new_for_path: () => ({load_contents: () => [true, bytes({rules: []})]})}}}});
    const {RuleEngine} = await load('lib/rules/ruleEngine.js');
    const {validateRules} = await load('lib/rules/validator.js');
    const engine = new RuleEngine('/config');
    const config = {rules: [], layouts: {browser: {type: 'hbox', children: [
        {type: 'placeholder', name: 'browser', weight: 70},
        {type: 'vbox', dynamic: true, weight: 30, children: []}]}}, workspace_layouts: {'1': 'browser'}};
    assert.equal(validateRules(JSON.stringify(config)).errors.length, 0);
    engine._parseAndApply(bytes(config));
    const catalog = engine.layouts, mapping = engine.workspaceLayouts;
    engine._parseAndApply(bytes({rules: [], workspace_layouts: {'1': 'missing'}}));
    assert.equal(engine.layouts, catalog); assert.equal(engine.workspaceLayouts, mapping);
    assert.ok(validateRules(JSON.stringify({rules: [], workspace_layouts: {'0': 'hbox'}})).errors.length);
    engine._parseAndApply(bytes({rules: []}));
    assert.equal(Object.keys(engine.workspaceLayouts).length, 0);
});
