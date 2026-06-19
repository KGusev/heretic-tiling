/**
 * Keybindings manager.
 *
 * Handles:
 *  - Super+N  → switch to workspace N or toggle back
 *  - Super+Shift+N → move window to workspace N
 *  - Super+F → toggle fullscreen for the focused window
 *  - Disabling Super+1..9 dock shortcuts
 *  - Freeing Super+D from "show-desktop"
 *  - Freeing Super+W from "close"
 */

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class KeybindingsManager {
    /**
     * @param {Gio.Settings} wmKeybindings    org.gnome.desktop.wm.keybindings
     * @param {Gio.Settings} shellKeybindings org.gnome.shell.keybindings
     * @param {Gio.Settings} settings         extension shortcut settings
     * @param {number}       numWorkspaces    number of workspaces to configure (default 10)
     */
    constructor(wmKeybindings, shellKeybindings, settings, numWorkspaces = 10, mutterKeybindings = null) {
        this._wmKeybindings    = wmKeybindings;
        this._shellKeybindings = shellKeybindings;
        this._settings         = settings;
        this._numWorkspaces    = numWorkspaces;
        this._mutterKeybindings = mutterKeybindings;
        this._savedMutterKeys = {};
        this._registeredKeys   = [];
        this._previousWorkspace = null;
        this._savedKeys        = {};
        this._savedAppKeys     = {};
    }

    /**
     * Apply all keybinding overrides and remember previous values for restore.
     */
    setup() {
        // Use Mutter's native toggle so fullscreen entry and exit retain its
        // normal window-state handling. Preserve existing alternative shortcuts.
        this._savedKeys['toggle-fullscreen'] = this._wmKeybindings.get_strv('toggle-fullscreen');
        this._wmKeybindings.set_strv('toggle-fullscreen', [
            ...this._savedKeys['toggle-fullscreen'].filter(k =>
                !['<super>f', '<mod4>f'].includes(k.toLowerCase())),
            '<Super>f',
        ]);

        // Super+N / Super+Shift+N for workspaces 1-N
        for (let i = 1; i <= Math.min(this._numWorkspaces, 10); i++) {
            const num       = i === 10 ? 0 : i;
            const switchKey = `switch-to-workspace-${i}`;
            const moveKey   = `move-to-workspace-${i}`;

            this._savedKeys[switchKey] = this._wmKeybindings.get_strv(switchKey);
            this._wmKeybindings.set_strv(switchKey, []);

            this._savedKeys[moveKey] = this._wmKeybindings.get_strv(moveKey);
            this._wmKeybindings.set_strv(moveKey, [`<Super><Shift>${num}`]);
        }

        // Disable Super+1..9 = "launch app from dock" shortcuts
        for (let i = 1; i <= 9; i++) {
            const key = `switch-to-application-${i}`;
            try {
                this._savedAppKeys[key] = this._shellKeybindings.get_strv(key);
                this._shellKeybindings.set_strv(key, []);
            } catch (_) {}
        }

        // Free Super+D from "show-desktop".
        // Use case-insensitive comparison: GSettings normally stores canonical
        // lowercase, but distro overrides may use "<Super>D" etc.
        try {
            this._savedKeys['show-desktop'] = this._wmKeybindings.get_strv('show-desktop');
            const filtered = this._savedKeys['show-desktop'].filter(
                k => k.toLowerCase() !== '<super>d'
            );
            this._wmKeybindings.set_strv('show-desktop', filtered);
        } catch (_) {}

        // Free Super+W from "close".
        try {
            this._savedKeys['close'] = this._wmKeybindings.get_strv('close');
            const filtered = this._savedKeys['close'].filter(
                k => k.toLowerCase() !== '<super>w'
            );
            this._wmKeybindings.set_strv('close', filtered);
        } catch (_) {}

        // Win+R toggles Resize mode instead of a customized run-dialog binding.
        this._savedKeys['panel-run-dialog'] = this._wmKeybindings.get_strv('panel-run-dialog');
        this._wmKeybindings.set_strv('panel-run-dialog', this._savedKeys['panel-run-dialog']
            .filter(k => !['<super>r', '<mod4>r'].includes(k.toLowerCase())));

        // Win+Arrow belongs to spatial focus while the extension is enabled.
        for (const [settings, saved, key, direction] of [
            [this._wmKeybindings, this._savedKeys, 'maximize', 'up'],
            [this._wmKeybindings, this._savedKeys, 'unmaximize', 'down'],
            [this._mutterKeybindings, this._savedMutterKeys, 'toggle-tiled-left', 'left'],
            [this._mutterKeybindings, this._savedMutterKeys, 'toggle-tiled-right', 'right'],
        ]) {
            if (!settings) continue;
            saved[key] = settings.get_strv(key);
            settings.set_strv(key, saved[key].filter(k =>
                ![`<super>${direction}`, `<mod4>${direction}`].includes(k.toLowerCase())));
        }

        // Win+Shift+Arrow moves/resizes tiles instead of moving windows between
        // monitors/workspaces. Keep Ctrl+Alt and other alternative bindings.
        for (const direction of ['left', 'right', 'up', 'down']) {
            for (const prefix of ['move-to-monitor', 'move-to-workspace']) {
                const key = `${prefix}-${direction}`;
                this._savedKeys[key] = this._wmKeybindings.get_strv(key);
                this._wmKeybindings.set_strv(key, this._savedKeys[key].filter(k => {
                    const normalized = k.toLowerCase().replace('<mod4>', '<super>');
                    return ![`<super><shift>${direction}`, `<shift><super>${direction}`].includes(normalized);
                }));
            }
        }

        // Floating controls use the default input-source accelerators.
        for (const key of ['switch-input-source', 'switch-input-source-backward']) {
            this._savedKeys[key] = this._wmKeybindings.get_strv(key);
            this._wmKeybindings.set_strv(key, this._savedKeys[key].filter(k =>
                !['<super>space', '<super><shift>space', '<shift><super>space']
                    .includes(k.toLowerCase().replace('<mod4>', '<super>'))));
        }

        // Free the built-in layout shortcuts while retaining alternative accelerators.
        for (const [settings, saved, key, accelerator] of [
            [this._wmKeybindings, this._savedKeys, 'minimize', '<super>h'],
            [this._shellKeybindings, this._savedAppKeys, 'toggle-message-tray', '<super>v'],
        ]) {
            saved[key] = settings.get_strv(key);
            settings.set_strv(key, saved[key].filter(k => k.toLowerCase() !== accelerator));
        }

        for (let i = 1; i <= Math.min(this._numWorkspaces, 10); i++) {
            const key = `toggle-workspace-${i}`;
            Main.wm.addKeybinding(
                key, this._settings, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this._switchWorkspace(i - 1),
            );
            this._registeredKeys.push(key);
        }
    }

    /** Only successful numbered-shortcut switches update this shared history. */
    _switchWorkspace(index) {
        const manager = global.workspace_manager;
        const current = manager.get_active_workspace();
        const requested = manager.get_workspace_by_index(index);
        if (!requested) return;

        const target = requested === current ? this._previousWorkspace : requested;
        if (!target || target === current) return;

        // Compare object identity: removed workspaces must not resolve to a new
        // workspace that happens to occupy the same index.
        let exists = false;
        for (let i = 0; i < manager.get_n_workspaces(); i++) {
            if (manager.get_workspace_by_index(i) === target) {
                exists = true;
                break;
            }
        }
        if (!exists) return;

        target.activate(global.get_current_time());
        if (manager.get_active_workspace() === target)
            this._previousWorkspace = current;
    }

    /**
     * Restore all keybindings to their pre-extension values.
     */
    restore() {
        for (const key of this._registeredKeys)
            Main.wm.removeKeybinding(key);
        this._registeredKeys = [];
        this._previousWorkspace = null;
        for (const [key, value] of Object.entries(this._savedKeys)) {
            try { this._wmKeybindings.set_strv(key, value); } catch (_) {}
        }
        for (const [key, value] of Object.entries(this._savedAppKeys)) {
            try { this._shellKeybindings.set_strv(key, value); } catch (_) {}
        }
        for (const [key, value] of Object.entries(this._savedMutterKeys))
            this._mutterKeybindings.set_strv(key, value);
        this._savedMutterKeys = {};
        this._savedKeys    = {};
        this._savedAppKeys = {};
    }
}
