import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loader} from './modules.mjs';

test('weight snapshots exclude windows and malformed data never partially changes a tree', async () => {
    const {weightSnapshot, restoreWeights, LayoutPersistence} = await loader()('lib/layouts/persistence.js');
    const root = {type: 'hbox', children: [{type: 'placeholder', weight: 3, window: {}},
        {type: 'placeholder', weight: 1}]};
    const saved = weightSnapshot(root);
    assert.equal(JSON.stringify(saved).includes('window'), false);
    root.children[0].weight = 1;
    saved.children[1].weight = -1;
    assert.equal(restoreWeights(root, saved), false);
    assert.equal(root.children[0].weight, 1);
    saved.children[1].weight = 1;
    assert.equal(restoreWeights(root, saved), true);
    assert.equal(root.children[0].weight, 3);
    const settings = {get_string: () => '{broken', get_boolean: () => true};
    const store = new LayoutPersistence(settings);
    assert.equal(store.get({index: () => 0}, 'default', {hbox: null}), null);
});

test('monitor identities follow physical displays and ignore stale asynchronous replies', async () => {
    const pending = [];
    const Gio = {Cancellable: class { cancel() {} }, DBusCallFlags: {NONE: 0},
        DBus: {session: {call(...args) { pending.push(args.at(-1)); }}}};
    const {MonitorIdentity} = await loader({'gi://Gio': {default: Gio}})('lib/layouts/monitorIdentity.js');
    const identity = new MonitorIdentity();
    const monitors = [{x: 0, y: 0}, {x: 1000, y: 0}];
    const connection = {call_finish: result => ({deep_unpack: () => result})};
    const result = [1, [], [[0, 0, 1, 0, true, [['DP-1', 'Vendor', 'Model', 'Serial']], {}],
        [1000, 0, 1, 0, false, [['HDMI-1', 'Vendor', 'Model', 'Other']], {}]]];
    let keys;
    identity.refresh(monitors, value => { keys = value; }); pending.shift()(connection, result);
    const original = [...keys];
    identity.refresh([...monitors].reverse(), value => { keys = value; }); pending.shift()(connection, result);
    assert.equal(keys[1], original[0]);
    assert.equal(keys[0], original[1]);
    identity.refresh(monitors, () => assert.fail('stale callback'));
    identity.refresh(monitors, () => assert.fail('destroyed callback'));
    identity.destroy(); for (const callback of pending) callback(connection, result);
});
