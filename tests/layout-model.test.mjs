import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loader} from './modules.mjs';
const {validateLayouts, LayoutTree, slots, geometry, resizeWeights, resizeWindow} =
    await loader()('lib/layouts/model.js');
const slot = (name, extra = {}) => ({type: 'placeholder', name, ...extra});
const box = (children, type = 'hbox') => ({type, children});
const plain = (x) => JSON.parse(JSON.stringify(x));

test('schema accepts placeholder roots and nested containers; rejects invalid and duplicate slots', () => {
    assert.equal(
        validateLayouts({
            main: slot('main'),
            code: box([slot('editor'), box([slot('term')], 'vbox')]),
        }).length,
        0,
    );
    for (const layouts of [
        null,
        [],
        {hbox: slot('a')},
        {p: box([slot('a'), slot('a')])},
        {p: slot('a', {weight: Infinity})},
        {p: slot('', {skipIfEmpty: 1})},
        {p: box([slot('a', {x: 0.8, y: 0, width: 0.4, height: 1})], 'constraint')},
    ])
        assert.ok(validateLayouts(layouts).length);
});

test('nested geometry rounds to parent extent and collapses empty subtrees', () => {
    const root = box([
        slot('a', {weight: 2}),
        box([slot('b'), slot('c')], 'vbox'),
        box([slot('empty', {skipIfEmpty: true})]),
    ]);
    const {leaves, splitters} = geometry(root, {x: 20, y: 30, width: 1001, height: 601});
    assert.equal(leaves.length, 3);
    assert.equal(leaves[0].rect.width, 667);
    assert.equal(leaves[2].rect.x + leaves[2].rect.width, 1021);
    assert.equal(leaves[2].rect.y + leaves[2].rect.height, 631);
    assert.equal(splitters.length, 2);
});

test('constraint geometry permits overlap and root placeholder fills work area', () => {
    const area = {x: 200, y: 40, width: 801, height: 601};
    const root = box(
        [
            slot('a', {x: 0.25, y: 0, width: 0.5, height: 1}),
            slot('b', {x: 0.5, y: 0.5, width: 0.5, height: 0.5}),
        ],
        'constraint',
    );
    const g = geometry(root, area);
    assert.equal(g.splitters.length, 0);
    assert.equal(g.leaves[1].rect.x + g.leaves[1].rect.width, 1001);
    assert.deepEqual(plain(geometry(slot('root'), area).leaves[0].rect), area);
});

test('assignment handles displacement, idempotence, overflow and deterministic refill', () => {
    const tree = new LayoutTree('code', box([slot('editor'), slot('terminal')]));
    const [a, b, c] = [{id: 1}, {id: 2}, {id: 3}];
    tree.reconcile([a, b, c]);
    tree.assign(c, 'editor');
    assert.equal(tree.has(a), false);
    assert.equal(slots(tree.root)[0].window, c);
    tree.reconcile([a, b, c]);
    tree.assign(c, 'editor');
    assert.equal(slots(tree.root)[0].window, c);
    tree.reconcile([a, c]);
    assert.equal(slots(tree.root)[1].window, a);
    assert.equal(tree.assign(c, 'missing'), false);
});

test('dynamic trees preserve order and weights while adding and removing windows', () => {
    const tree = new LayoutTree('hbox');
    const a = {},
        b = {},
        c = {};
    tree.reconcile([a, b]);
    tree.root.children[0].weight = 3;
    tree.reconcile([b, a, c]);
    assert.equal(tree.root.children[0].window, a);
    assert.equal(tree.root.children[0].weight, 3);
    tree.reconcile([b, c]);
    assert.equal(slots(tree.root).length, 2);
});

test('normal drag affects adjacent pair; shift preserves proportions on each side', () => {
    const normal = resizeWeights([1, 2, 3, 4], 1, 50, 1000, false);
    assert.deepEqual(plain(normal), [1, 2.5, 2.5, 4]);
    const shift = resizeWeights([1, 2, 3, 4], 1, 100, 1000, true);
    assert.ok(Math.abs(shift[0] / shift[1] - 0.5) < 1e-10);
    assert.ok(Math.abs(shift[2] / shift[3] - 0.75) < 1e-10);
    assert.ok(Math.abs(shift.reduce((a, b) => a + b) - 10) < 1e-10);
    assert.deepEqual(plain(resizeWeights([1, 1], 0, 500, 200, false, [50, 50])), [1.5, 0.5]);
});

test('shared rule validator validates layouts and placeholder actions', async () => {
    const {validateRules} = await loader()('lib/rules/validator.js');
    assert.equal(
        validateRules(
            JSON.stringify({
                rules: [{actions: {layout_placeholder: 'editor'}}],
                layouts: {main: slot('editor')},
            }),
        ).errors.length,
        0,
    );
    assert.ok(
        validateRules(JSON.stringify({rules: [{actions: {layout_placeholder: ''}}]})).errors.length,
    );
    assert.ok(
        validateRules(JSON.stringify({rules: [], layouts: {p: {type: 'bad'}}})).errors.length,
    );
});

test('large finite weights do not overflow geometry calculations', () => {
    const root = box([slot('a', {weight: 1e308}), slot('b', {weight: 1e308})]);
    const result = geometry(root, {x: 0, y: 0, width: 1000, height: 500});
    assert.equal(result.leaves[0].rect.width, 500);
    assert.equal(result.leaves[1].rect.x + result.leaves[1].rect.width, 1000);
});

test('native rectangle getters retain both dimensions in all layout nodes', () => {
    // GJS boxed Mtk.Rectangle fields are not enumerable own properties.
    const area = Object.create({
        get x() {
            return 100;
        },
        get y() {
            return 30;
        },
        get width() {
            return 1200;
        },
        get height() {
            return 770;
        },
    });
    assert.deepEqual({...area}, {});
    for (const type of ['hbox', 'vbox']) {
        const result = geometry(box([slot('a'), slot('b'), slot('c')], type), area);
        for (const {rect} of [...result.leaves, ...result.splitters]) {
            for (const field of ['x', 'y', 'width', 'height'])
                assert.ok(Number.isFinite(rect[field]), `${type}.${field}`);
            assert.ok(rect.width > 0 && rect.height > 0);
        }
        for (const {rect} of result.leaves) {
            if (type === 'hbox') {
                assert.equal(rect.y, 30);
                assert.equal(rect.height, 770);
            } else {
                assert.equal(rect.x, 100);
                assert.equal(rect.width, 1200);
            }
        }
    }
    assert.deepEqual(plain(geometry(slot('root'), area).leaves[0].rect), {
        x: 100,
        y: 30,
        width: 1200,
        height: 770,
    });
});

test('gapless boxes share edges and retain centered six-pixel drag targets', () => {
    for (const type of ['hbox', 'vbox']) {
        const root = {type, children: Array.from({length: 3}, () => ({type: 'placeholder'}))};
        const {leaves, splitters} = geometry(root, {x: 20, y: 30, width: 999, height: 999});
        const axis = type === 'hbox' ? 'x' : 'y';
        const size = type === 'hbox' ? 'width' : 'height';
        for (let i = 0; i < 2; i++) {
            const edge = leaves[i].rect[axis] + leaves[i].rect[size];
            assert.equal(edge, leaves[i + 1].rect[axis]);
            assert.equal(splitters[i].rect[size], 6);
            assert.equal(splitters[i].rect[axis] + 3, edge);
        }
    }
});

test('keyboard resize grows/shrinks edge tiles and clamps repeated keys', () => {
    const windows = [{}, {}, {}];
    const root = box(windows.map((window) => slot('', {window})));
    const area = {x: 0, y: 0, width: 900, height: 600};
    const widths = () => geometry(root, area).leaves.map((l) => l.rect.width);
    assert.equal(resizeWindow(root, area, windows[0], 'right'), true);
    assert.deepEqual(plain(widths()), [315, 285, 300]);
    resizeWindow(root, area, windows[0], 'left');
    assert.deepEqual(plain(widths()), [270, 330, 300]);
    resizeWindow(root, area, windows[2], 'right');
    assert.deepEqual(plain(widths()), [270, 315, 315]);
    for (let i = 0; i < 100; i++) resizeWindow(root, area, windows[2], 'right');
    assert.deepEqual(plain(widths()), [270, 32, 598]);
    assert.equal(resizeWindow(root, area, windows[0], 'up'), false);
});
test('keyboard resize follows nested axes and preserves sibling groups', () => {
    const a = {},
        b = {},
        c = {};
    const nested = box([slot('', {window: a}), slot('', {window: b})], 'vbox');
    const root = box([nested, slot('', {window: c})]);
    const area = {x: 0, y: 0, width: 1000, height: 600};
    resizeWindow(root, area, a, 'down');
    let leaves = geometry(root, area).leaves;
    assert.equal(leaves[0].rect.height, 330);
    assert.equal(leaves[1].rect.height, 270);
    resizeWindow(root, area, a, 'right');
    leaves = geometry(root, area).leaves;
    assert.equal(leaves[0].rect.width, 550);
    assert.equal(leaves[1].rect.width, 550);
    assert.equal(leaves[2].rect.width, 450);
    assert.equal(resizeWindow(slot('', {window: a}), area, a, 'right'), false);
});

test('a resized box resets its lone survivor before a new window joins', () => {
    for (const preset of ['hbox', 'vbox']) {
        for (const survivor of [0, 1]) {
            for (const batched of [false, true]) {
                const tree = new LayoutTree(preset);
                const windows = [{}, {}],
                    replacement = {};
                tree.reconcile(windows);
                tree.root.children[0].weight = 1.4;
                tree.root.children[1].weight = 0.6;
                if (!batched) tree.reconcile([windows[survivor]]);
                tree.reconcile([windows[survivor], replacement]);
                assert.deepEqual(plain(tree.root.children.map((c) => c.weight)), [1, 1]);
                const leaves = geometry(tree.root, {x: 0, y: 0, width: 1000, height: 800}).leaves;
                const size = preset === 'hbox' ? 'width' : 'height';
                assert.equal(leaves[0].rect[size], leaves[1].rect[size]);
            }
        }
    }
});

test('workspace layout mapping rejects invalid indices and missing presets', async () => {
    const {validateWorkspaceLayouts} = await loader()('lib/layouts/model.js');
    assert.equal(
        validateWorkspaceLayouts({1: 'main', 12: 'none'}, {main: slot('browser')}).length,
        0,
    );
    for (const mapping of [
        null,
        [],
        {0: 'hbox'},
        {'01': 'hbox'},
        {1.5: 'hbox'},
        {1: 'missing'},
        {1: 1},
    ])
        assert.ok(validateWorkspaceLayouts(mapping).length);
});

test('dynamic secondary column keeps browser 70%, preserves resize, and resets after a lone survivor', () => {
    const definition = box([
        slot('browser', {weight: 70, skipIfEmpty: true}),
        {type: 'vbox', weight: 30, dynamic: true, children: []},
    ]);
    assert.equal(validateLayouts({browser: definition}).length, 0);
    for (const bad of [
        slot('bad', {dynamic: true}),
        {...definition, dynamic: true},
        box([
            {type: 'vbox', dynamic: true, children: []},
            {type: 'hbox', dynamic: true, children: []},
        ]),
    ])
        assert.ok(validateLayouts({bad}).length);
    for (const browserFirst of [true, false]) {
        const tree = new LayoutTree('browser', definition);
        const browser = {},
            a = {},
            b = {},
            c = {};
        tree.reconcile(browserFirst ? [browser, a] : [a, browser]);
        tree.assign(browser, 'browser');
        tree.reconcile([browser, a, b]);
        const area = {x: 0, y: 0, width: 1000, height: 800};
        let leaves = geometry(tree.root, area).leaves;
        assert.equal(leaves.find((l) => l.node.window === browser).rect.width, 700);
        for (const window of [a, b]) {
            const rect = leaves.find((l) => l.node.window === window).rect;
            assert.equal(rect.width, 300);
            assert.equal(rect.height, 400);
        }
        resizeWindow(tree.root, area, browser, 'right', 10);
        tree.reconcile([browser, a, b, c]);
        assert.equal(geometry(tree.root, area).leaves[0].rect.width, 800);
        // Close secondary windows and open another in the very same batch.
        const next = {};
        tree.reconcile([browser, next]);
        assert.equal(geometry(tree.root, area).leaves[0].rect.width, 700);
        assert.equal(slots(tree.root).filter((s) => s.window).length, 2);
        tree.reconcile([next]);
        const returningBrowser = {};
        tree.reconcile([next, returningBrowser]);
        tree.assign(returningBrowser, 'browser');
        assert.equal(geometry(tree.root, area).leaves[0].rect.width, 700);
        assert.equal(tree.has(next), true);
    }
});

test('keyboard resize snaps off-grid shares in both directions independently of resolution', () => {
    for (const width of [1000, 1920, 3840]) {
        for (const [direction, step, expected] of [
            ['right', 5, 50],
            ['left', 5, 45],
            ['right', 10, 50],
            ['left', 10, 40],
        ]) {
            const a = {},
                b = {};
            const root = box([
                slot('', {window: a, weight: 47}),
                slot('', {window: b, weight: 53}),
            ]);
            const area = {x: 0, y: 0, width, height: 800};
            resizeWindow(root, area, a, direction, step);
            assert.equal(
                geometry(root, area).leaves[0].rect.width,
                Math.round((width * expected) / 100),
            );
            resizeWindow(root, area, a, direction, step);
            const next = expected + (direction === 'right' ? step : -step);
            assert.equal(
                geometry(root, area).leaves[0].rect.width,
                Math.round((width * next) / 100),
            );
        }
    }
});
