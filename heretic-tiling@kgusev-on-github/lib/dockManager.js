/**
 * DockManager — disables the Ubuntu dock extension while Heretic Tiling is
 * active and restores its previous state on disable.
 */

export class DockManager {
    static UUID = 'ubuntu-dock@ubuntu.com';

    /**
     * @param {Gio.Settings} shellSettings  org.gnome.shell settings object.
     */
    constructor(shellSettings) {
        this._shellSettings = shellSettings;
        this._wasEnabled    = false;
    }

    /** Disable the Ubuntu dock, remembering whether it was enabled. */
    disableDock() {
        const uuid     = DockManager.UUID;
        const enabled  = this._shellSettings.get_strv('enabled-extensions');
        const disabled = this._shellSettings.get_strv('disabled-extensions');

        this._wasEnabled = enabled.includes(uuid);

        if (!disabled.includes(uuid)) {
            this._shellSettings.set_strv('disabled-extensions',
                [...disabled, uuid]);
        }

        // Also remove from enabled-extensions if present, to avoid conflicting state
        if (this._wasEnabled) {
            this._shellSettings.set_strv('enabled-extensions',
                enabled.filter(u => u !== uuid));
        }
    }

    /** Restore the Ubuntu dock to its pre-extension state. */
    restoreDock() {
        if (!this._shellSettings) return;
        const uuid = DockManager.UUID;

        // Remove from disabled-extensions
        const disabled = this._shellSettings.get_strv('disabled-extensions');
        this._shellSettings.set_strv('disabled-extensions',
            disabled.filter(u => u !== uuid));

        // Re-add to enabled-extensions if it was there before
        if (this._wasEnabled) {
            const enabled = this._shellSettings.get_strv('enabled-extensions');
            if (!enabled.includes(uuid)) {
                this._shellSettings.set_strv('enabled-extensions',
                    [...enabled, uuid]);
            }
        }
    }
}
