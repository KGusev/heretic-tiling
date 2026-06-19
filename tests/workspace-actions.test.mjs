import test from 'node:test';
import assert from 'node:assert/strict';
import {loader, scheduler} from './modules.mjs';

async function fixture() {
    const schedule = scheduler();
    let reload;
    const job = {workspace: 6, match: {wm_class: 'example'}, click: {x: 10, y: 20, width: 100, height: 100}};
    const state = {workspace: 5, wayland: false};
    const engine = {workspaceActions: [job], onReload(fn) { reload = fn; return () => { reload = null; }; }};
    const processes = [];
    const load = loader({
        'gi://Meta': {default: {is_wayland_compositor: () => state.wayland}},
        'gi://GLib': {default: schedule.glib},
        'gi://Gio': {default: {SubprocessFlags: {NONE: 0}, Subprocess: {
            new(argv) {
                const process = {argv, killed: false,
                    wait_async(_, cb) { this.callback = cb; },
                    wait_finish() {}, get_successful: () => true,
                    force_exit() { this.killed = true; },
                    complete() { this.callback(this, {}); },
                };
                processes.push(process);
                return process;
            },
        }}},
    }, {global: {
        workspace_manager: {get_active_workspace_index: () => state.workspace},
    }});
    const {SourceTracker} = await load('lib/utils/sourceTracker.js');
    const {WorkspaceActions} = await load('lib/workspaceActions.js');
    const runner = new WorkspaceActions(engine, '/extension', new SourceTracker());
    return {runner, state, processes, schedule, engine, reload: () => reload?.()};
}

test('runs once for matching workspace and mini-window, cleans up on completion', async () => {
    const {runner, processes, schedule} = await fixture();
    runner.onWorkspaceChanged();
    assert.deepEqual([...processes[0].argv], ['python3', '/extension/helpers/window-click.py', JSON.stringify({workspace: 6, match: {wm_class: 'example'}, click: {x: 10, y: 20, width: 100, height: 100}})]);
    processes[0].complete();
    assert.equal(schedule.tasks.size, 0);
    runner.destroy();
    assert.equal(processes[0].killed, false);
});

test('wrong workspace and Wayland are no-ops', async () => {
    for (const change of [{workspace: 1}, {wayland: true}]) {
        const {runner, state, processes} = await fixture();
        Object.assign(state, change);
        runner.onWorkspaceChanged();
        assert.equal(processes.length, 0);
    }
});

test('switch away, disable, and timeout cancel pending helper', async () => {
    for (const action of ['switch', 'destroy', 'timeout']) {
        const {runner, state, processes, schedule} = await fixture();
        runner.onWorkspaceChanged();
        if (action === 'switch') {
            state.workspace = 1;
            runner.onWorkspaceChanged();
        } else if (action === 'destroy') runner.destroy();
        else schedule.flush();
        assert.equal(processes[0].killed, true);
        processes[0].complete();
        assert.equal(schedule.tasks.size, 0);
    }
});

test('old helper completion cannot clear a newer helper timeout', async () => {
    const {runner, processes, schedule} = await fixture();
    runner.onWorkspaceChanged();
    runner.onWorkspaceChanged();
    processes[0].complete();
    assert.equal(schedule.tasks.size, 1);
    runner.destroy();
    assert.equal(processes[1].killed, true);
});

 test('configuration reload cancels work and removal disables future actions', async () => {
    const {runner, engine, processes, reload} = await fixture();
    runner.onWorkspaceChanged();
    engine.workspaceActions = [];
    reload();
    assert.equal(processes[0].killed, true);
    runner.onWorkspaceChanged();
    assert.equal(processes.length, 1);
    runner.destroy();
 });
 test('multiple configured jobs have independent lifetimes', async () => {
    const {runner, engine, processes, schedule} = await fixture();
    engine.workspaceActions.push({...engine.workspaceActions[0], delay_ms: 500});
    runner.onWorkspaceChanged();
    assert.equal(processes.length, 2);
    processes[0].complete();
    assert.equal(schedule.tasks.size, 1);
    runner.destroy();
    assert.equal(processes[1].killed, true);
 });
