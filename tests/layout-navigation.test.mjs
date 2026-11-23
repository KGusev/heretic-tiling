import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loader} from './modules.mjs';
const {directionalNeighbour} = await loader()('lib/layouts/navigation.js');
const rect = (x, y, width = 100, height = 100) => ({x, y, width, height});
const entry = (window, r) => ({window, rect: r});
test('four directions, aligned neighbours, and no wrap', () => {
    const source = rect(100, 100);
    const candidates = [entry('left', rect(0, 100)), entry('right', rect(200, 100)),
        entry('up', rect(100, 0)), entry('down', rect(100, 200))];
    for (const direction of ['left', 'right', 'up', 'down'])
        assert.equal(directionalNeighbour(source, candidates, direction), direction);
    assert.equal(directionalNeighbour(rect(0, 0), candidates, 'left'), null);
});
test('unequal nested tiles prefer alignment, then nearest edge and centre', () => {
    const source = rect(0, 0, 200, 400);
    const candidates = [entry('far', rect(500, 0)), entry('lower', rect(200, 300)),
        entry('middle', rect(200, 150)), entry('diagonal', rect(50, 500, 400, 100))];
    assert.equal(directionalNeighbour(source, candidates, 'right'), 'middle');
    assert.equal(directionalNeighbour(rect(-1000, 0), [entry('other-monitor', rect(0, 0))], 'right'), 'other-monitor');
});
