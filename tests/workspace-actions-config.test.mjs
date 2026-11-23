import test from 'node:test';
import assert from 'node:assert/strict';
import {loader} from './modules.mjs';

const job = {
    workspace: 3,
    match: {wm_class: 'Utility'},
    click: {x: 5, y: 10, width: 100, height: 50},
    attempts: 3,
};
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));

test('corner anchors allow signed offsets and optional paired size guards', async () => {
    const {validateWorkspaceActions: validate} = await loader()('lib/rules/workspaceActions.js');
    for (const anchor of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
        const click = {
            anchor,
            x: anchor.endsWith('right') ? -20 : 20,
            y: anchor.startsWith('bottom') ? -20 : 20,
        };
        assert.equal(validate([{...job, click}]).length, 0);
        assert.equal(validate([{...job, click: {...click, width: 280, height: 158}}]).length, 0);
    }
    for (const click of [
        {anchor: 'center', x: 0, y: 0},
        {anchor: null, x: 0, y: 0},
        {anchor: 'bottom-right', x: 0, y: -20},
        {anchor: 'top-left', x: -20, y: 0},
        {anchor: 'bottom-right', x: -20, y: -20, width: 280},
        {anchor: 'bottom-right', x: -20.5, y: -20},
        {anchor: 'bottom-right', x: -20},
    ])
        assert.ok(validate([{...job, click}]).length, JSON.stringify(click));
});

test('validate exact matching, coordinates, timing and unknown fields', async () => {
    const {validateWorkspaceActions: validate} = await loader()('lib/rules/workspaceActions.js');
    assert.equal(validate([job]).length, 0);
    assert.equal(validate(undefined).length, 0);
    for (const invalid of [
        null,
        {},
        [null],
        [{...job, workspace: 0}],
        [{...job, match: {}}],
        [{...job, match: {wm_class: {regex: '.*'}}}],
        [{...job, match: {unknown: 'app'}}],
        [{...job, click: {...job.click, x: 100}}],
        [{...job, click: {...job.click, button: 4}}],
        [{...job, attempts: 0}],
        [{...job, interval_ms: 0}],
        [{...job, delay_ms: -1}],
        [{...job, command: 'oops'}],
    ])
        assert.ok(validate(invalid).length, JSON.stringify(invalid));
    assert.ok(validate([job], {numWorkspaces: 2}).length);
});

test('engine loads actions, preserves last valid section and clears it when removed', async () => {
    const load = loader({
        'gi://Meta': {default: {WindowType: {NORMAL: 0}}},
        'gi://GLib': {default: {}},
        'gi://Gio': {
            default: {
                File: {
                    new_for_path: () => ({
                        load_contents: () => [true, bytes({rules: [], workspace_actions: [job]})],
                    }),
                },
            },
        },
    });
    const {RuleEngine} = await load('lib/rules/ruleEngine.js');
    const {validateRules} = await load('lib/rules/validator.js');
    const engine = new RuleEngine('/config');
    assert.equal(engine.workspaceActions[0].workspace, 3);
    const invalid = {rules: [], workspace_actions: [{...job, attempts: -1}]};
    assert.ok(validateRules(JSON.stringify(invalid)).errors.length);
    engine._parseAndApply(bytes(invalid));
    assert.equal(engine.workspaceActions[0].attempts, 3);
    engine._parseAndApply(bytes({rules: []}));
    assert.equal(engine.workspaceActions.length, 0);
});
