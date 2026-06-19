import Gio from 'gi://Gio';

/** Resolve physical display identities without blocking the Shell thread. */
export class MonitorIdentity {
    constructor() { this._cancel = null; this._generation = 0; }
    refresh(monitors, done) {
        this._cancel?.cancel();
        const generation = ++this._generation;
        this._cancel = new Gio.Cancellable();
        const fallback = monitors.map(m => `geometry:${m.x},${m.y},${m.width},${m.height}`);
        Gio.DBus.session.call('org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
            'org.gnome.Mutter.DisplayConfig', 'GetCurrentState', null, null,
            Gio.DBusCallFlags.NONE, 2000, this._cancel, (connection, result) => {
                let keys = fallback;
                try {
                    const [, , logical] = connection.call_finish(result).deep_unpack();
                    keys = monitors.map((monitor, i) => {
                        const display = logical.find(([x, y]) => x === monitor.x && y === monitor.y);
                        // Logical monitors can mirror multiple physical displays. Include the
                        // connector to distinguish identical displays with missing serials.
                        return display?.[5]?.length ? `display:${JSON.stringify(display[5].map(spec => [...spec]).sort())}` : fallback[i];
                    });
                } catch (_) { /* Older/backing displays may only expose geometry. */ }
                if (generation !== this._generation) return;
                this._cancel = null;
                done(keys);
            });
    }
    destroy() { this._generation++; this._cancel?.cancel(); this._cancel = null; }
}
