import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import {Logger} from './logger.js';

/** Execute user-configured actions when entering a workspace. */
export class WorkspaceActions {
    constructor(engine, path, sources) {
        this._engine = engine;
        this._path = path;
        this._sources = sources;
        this._pending = new Map();
        this._log = new Logger('WorkspaceActions');
        this._unsubscribe = engine.onReload(() => this.cancel());
    }

    onWorkspaceChanged() {
        this.cancel();
        if (Meta.is_wayland_compositor?.() ?? true) return;
        const workspace = global.workspace_manager.get_active_workspace_index() + 1;
        for (const job of this._engine.workspaceActions) {
            if (job.workspace !== workspace) continue;
            try {
                const process = Gio.Subprocess.new(
                    ['python3', `${this._path}/helpers/window-click.py`, JSON.stringify(job)],
                    Gio.SubprocessFlags.NONE,
                );
                const timeout = this._sources.timeout(
                    (job.delay_ms ?? 0) + (job.attempts ?? 1) * (job.interval_ms ?? 250) + 2000,
                    () => this._cancel(process),
                );
                this._pending.set(process, timeout);
                process.wait_async(null, (proc, result) => {
                    try {
                        proc.wait_finish(result);
                        if (this._pending.has(proc) && !proc.get_successful())
                            this._log.warn('Window click helper failed; see session log');
                    } catch (e) {
                        this._log.warn(e.message);
                    } finally {
                        if (this._pending.has(proc)) {
                            this._sources.remove(this._pending.get(proc));
                            this._pending.delete(proc);
                        }
                    }
                });
            } catch (e) {
                this._log.warn(`Cannot execute workspace action: ${e.message}`);
            }
        }
    }

    _cancel(process) {
        this._sources.remove(this._pending.get(process));
        this._pending.delete(process);
        process.force_exit();
    }

    cancel() {
        for (const process of this._pending.keys()) this._cancel(process);
    }

    destroy() {
        this.cancel();
        this._unsubscribe();
    }
}
