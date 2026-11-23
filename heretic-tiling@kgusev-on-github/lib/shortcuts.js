/**
 * ShortcutsManager — the extension's own keybindings.
 *
 *  - Super+D (toggle-app-grid-shortcut) → toggle overview app grid
 *  - Super+W (close-window-shortcut)    → close the focused window
 *
 * Workspace keybindings (Super+N) live in keybindings.js.
 */

import Meta from 'gi://Meta';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ControlsState} from 'resource:///org/gnome/shell/ui/overviewControls.js';

const APP_GRID_KEY = 'toggle-app-grid-shortcut';
const CLOSE_WIN_KEY = 'close-window-shortcut';

export class ShortcutsManager {
    /**
     * @param {Gio.Settings} settings  The extension's own GSettings object.
     */
    constructor(settings, layouts) {
        this._settings = settings;
        this._layouts = layouts;
        this._resizeMode = false;
    }

    /** Register extension shortcuts. */
    enable() {
        for (const [key, action] of [
            ['toggle-floating-shortcut', () => this._layouts.toggleFloating()],
            ['focus-floating-shortcut', () => this._layouts.focusFloating()],
        ])
            Main.wm.addKeybinding(
                key,
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                action,
            );
        this._modeLabel = new St.Label({
            text: 'Resize',
            style_class: 'tiling-resize-mode',
            visible: false,
            reactive: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        Main.panel._leftBox.add_child(this._modeLabel);
        this._workspaceSignal = global.workspace_manager.connect('workspace-switched', () =>
            this._setResizeMode(false),
        );
        Main.wm.addKeybinding(
            'toggle-resize-mode-shortcut',
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL,
            () => this._setResizeMode(!this._resizeMode),
        );
        for (const direction of ['left', 'right', 'up', 'down'])
            Main.wm.addKeybinding(
                `resize-${direction}-shortcut`,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () =>
                    this._resizeMode
                        ? this._layouts.resizeDirection(direction)
                        : this._layouts.moveDirection(direction),
            );
        for (const direction of ['left', 'right', 'up', 'down'])
            Main.wm.addKeybinding(
                `focus-${direction}-shortcut`,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._layouts.focusDirection(direction),
            );
        for (const type of ['hbox', 'vbox'])
            Main.wm.addKeybinding(
                `create-${type}-shortcut`,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () =>
                    this._layouts.applyPreset(
                        global.workspace_manager.get_active_workspace(),
                        type,
                    ),
            );
        Main.wm.addKeybinding(
            APP_GRID_KEY,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => {
                if (Main.overview.visible) Main.overview.hide();
                else Main.overview.show(ControlsState.APP_GRID);
            },
        );

        Main.wm.addKeybinding(
            CLOSE_WIN_KEY,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL,
            () => {
                const win = global.display.focus_window;
                if (win && win.can_close()) win.delete(global.get_current_time());
            },
        );
    }

    get mode() {
        return this._resizeMode ? 'resize' : 'normal';
    }

    _setResizeMode(enabled) {
        if (this._resizeMode === enabled) return;
        this._resizeMode = enabled;
        this._modeLabel.visible = enabled;
        if (enabled) {
            // Grab plain Escape only in Resize mode; applications retain it in Normal mode.
            Main.wm.addKeybinding(
                'exit-resize-mode-shortcut',
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL,
                () => this._setResizeMode(false),
            );
        } else {
            Main.wm.removeKeybinding('exit-resize-mode-shortcut');
        }
    }

    /** Remove extension shortcuts. */
    disable() {
        Main.wm.removeKeybinding('toggle-floating-shortcut');
        Main.wm.removeKeybinding('focus-floating-shortcut');
        this._setResizeMode(false);
        global.workspace_manager.disconnect(this._workspaceSignal);
        this._workspaceSignal = null;
        this._modeLabel.destroy();
        this._modeLabel = null;
        Main.wm.removeKeybinding('toggle-resize-mode-shortcut');
        for (const direction of ['left', 'right', 'up', 'down'])
            Main.wm.removeKeybinding(`resize-${direction}-shortcut`);
        for (const direction of ['left', 'right', 'up', 'down'])
            Main.wm.removeKeybinding(`focus-${direction}-shortcut`);
        for (const type of ['hbox', 'vbox']) Main.wm.removeKeybinding(`create-${type}-shortcut`);
        try {
            Main.wm.removeKeybinding(APP_GRID_KEY);
        } catch (_) {}
        try {
            Main.wm.removeKeybinding(CLOSE_WIN_KEY);
        } catch (_) {}
    }
}
