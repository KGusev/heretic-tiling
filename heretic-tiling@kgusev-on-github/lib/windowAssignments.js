import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

/** Restart recovery for surviving X11 clients, never title-based matching. */
export class WindowAssignments {
    constructor(settings) {
        this._settings = settings;
        this._ids = new WeakMap();
        this._entries = {};
        try {
            const entries = JSON.parse(settings.get_string('window-workspace-assignments'));
            if (entries && typeof entries === 'object' && !Array.isArray(entries))
                this._entries = entries;
        } catch {}
        this._session = [
            GLib.getenv('XDG_SESSION_ID'),
            GLib.getenv('DISPLAY'),
            this._read('/proc/sys/kernel/random/boot_id').trim(),
        ];
    }

    _read(path) {
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            return ok ? new TextDecoder().decode(bytes) : '';
        } catch {
            return '';
        }
    }

    _id(window) {
        if (this._ids.has(window)) return this._ids.get(window);
        let id = null;
        if (!Meta.is_wayland_compositor()) {
            const xid = window.get_description()?.match(/^0x[0-9a-f]+/i)?.[0];
            const pid = window.get_pid();
            // Field 22 is process start time. The command in parentheses may
            // contain spaces, so split only the fields following its final ')'.
            const stat = this._read(`/proc/${pid}/stat`);
            const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
            if (xid && pid > 0 && start) id = JSON.stringify([...this._session, pid, start, xid]);
        }
        this._ids.set(window, id);
        return id;
    }

    get(window) {
        const entry = this._entries[this._id(window)];
        return entry &&
            Number.isInteger(entry.index) &&
            entry.index >= 0 &&
            typeof entry.key === 'string'
            ? entry
            : null;
    }
    set(window, entry) {
        const id = this._id(window);
        if (!id) return;
        const old = this._entries[id];
        if (old?.index === entry.index && old.key === entry.key) return;
        this._entries[id] = entry;
        this._save();
    }
    delete(window) {
        const id = this._id(window);
        if (!id || !Object.hasOwn(this._entries, id)) return;
        delete this._entries[id];
        this._save();
    }
    _save() {
        this._settings.set_string('window-workspace-assignments', JSON.stringify(this._entries));
    }
}
