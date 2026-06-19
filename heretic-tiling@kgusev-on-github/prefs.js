/**
 * Heretic Tiling — Preferences window (GNOME 46+ / GTK4 + Adw).
 *
 * Shows:
 *  - Workspace count spinner
 *  - The path of the user-specific config.json file with Open + Reload buttons
 *  - Inline rules validation (count, errors)
 *  - A debug-logging toggle
 *  - Keybindings reference
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Shared pure-JS rule validator (no GObject deps — safe in the prefs process).
import {validateLayouts} from './lib/layouts/model.js';
import { validateRules } from './lib/rules/validator.js';

// ---------------------------------------------------------------------------
// Preferences window
// ---------------------------------------------------------------------------

export default class HereticTilingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Heretic Tiling',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // ------------------------------------------------------------------ Workspaces group
        const wsGroup = new Adw.PreferencesGroup({
            title: 'Workspaces',
            description: 'Changes take effect after reloading the extension (disable → enable).',
        });
        page.add(wsGroup);

        const wsRow = new Adw.SpinRow({
            title: 'Number of workspaces',
            subtitle: 'Fixed workspace count (2–20)',
            adjustment: new Gtk.Adjustment({
                lower: 2,
                upper: 20,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        settings.bind('num-workspaces', wsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        wsGroup.add(wsRow);

        const customWsIndicatorRow = new Adw.SwitchRow({
            title: 'Custom workspace indicator',
            subtitle: 'Replace the default workspace dots with a numbered-button indicator in the panel',
        });
        settings.bind('custom-workspace-indicator', customWsIndicatorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        wsGroup.add(customWsIndicatorRow);

        const scrollSwitchRow = new Adw.SwitchRow({
            title: 'Scroll to switch workspace',
            subtitle: 'Scroll the mouse wheel over the indicator to switch workspaces',
        });
        settings.bind('workspace-scroll-switch', scrollSwitchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        wsGroup.add(scrollSwitchRow);

        const highlightEmptyRow = new Adw.SwitchRow({
            title: 'Highlight empty workspaces',
            subtitle: 'Dim workspace buttons that contain no windows',
        });
        settings.bind('highlight-empty-workspaces', highlightEmptyRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        wsGroup.add(highlightEmptyRow);

        const middleClickMoveRow = new Adw.SwitchRow({
            title: 'Middle-click to move window',
            subtitle: 'Middle-click a workspace button to move the focused window there',
        });
        settings.bind('middle-click-move', middleClickMoveRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        wsGroup.add(middleClickMoveRow);

        // ------------------------------------------------------------------ Focus group
        const focusGroup = new Adw.PreferencesGroup({
            title: 'Focus',
            description: 'Options controlling window focus behaviour.',
        });
        page.add(focusGroup);

        const focusOnKillRow = new Adw.SwitchRow({
            title: 'Focus front-placed window on close',
            subtitle: 'When closing the focused window, focus the remaining window that is topmost in the stacking order',
        });
        settings.bind('focus-next-on-close', focusOnKillRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        focusGroup.add(focusOnKillRow);

        const centerCursorRow = new Adw.SwitchRow({
            title: 'Center cursor on focused window',
            subtitle: 'Move the cursor to the window center whenever focus changes. Changes apply immediately.',
        });
        settings.bind('center-cursor-on-focus', centerCursorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        focusGroup.add(centerCursorRow);

        const dimRow = new Adw.SwitchRow({
            title: 'Dim unfocused windows',
            subtitle: 'Darken inactive windows to highlight the focused window. Applies immediately.',
        });
        settings.bind('dim-unfocused-windows', dimRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        focusGroup.add(dimRow);
        const dimStrengthRow = new Adw.SpinRow({
            title: 'Dimming strength (%)',
            subtitle: 'Brightness reduction for inactive windows; suspended in overview.',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 80,
                step_increment: 5, page_increment: 10}),
        });
        settings.bind('unfocused-window-dim-percent', dimStrengthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('dim-unfocused-windows', dimStrengthRow, 'sensitive', Gio.SettingsBindFlags.GET);
        focusGroup.add(dimStrengthRow);

        // ------------------------------------------------------------------ Rules file group
        const rulesPath = GLib.build_filenamev([
            GLib.get_user_config_dir(),
            'heretic-tiling',
            'config.json',
        ]);

        const layoutGroup = new Adw.PreferencesGroup({title: 'Layout',
            description: 'Default applies after reloading the extension. Optionally remember workspace selections and splitter sizes.'});
        page.add(layoutGroup);
        let layoutNames = ['none', 'hbox', 'vbox'];
        try {
            const [, bytes] = Gio.File.new_for_path(rulesPath).load_contents(null);
            const config = JSON.parse(new TextDecoder().decode(bytes));
            if (!validateLayouts(config.layouts).length) layoutNames.push(...Object.keys(config.layouts ?? {}));
        } catch (_) { /* Config may not exist until the first enable. */ }
        const selected = settings.get_string('default-layout');
        if (!layoutNames.includes(selected)) layoutNames.push(selected);
        const labels = {none: 'None', hbox: 'Horizontal', vbox: 'Vertical'};
        const layoutRow = new Adw.ComboRow({title: 'Default layout',
            model: Gtk.StringList.new(layoutNames.map(n => labels[n] ?? n)),
            selected: layoutNames.indexOf(selected)});
        layoutRow.connect('notify::selected', () => settings.set_string('default-layout', layoutNames[layoutRow.selected]));
        layoutGroup.add(layoutRow);
        const persistRow = new Adw.SwitchRow({title: 'Remember layouts and splitter sizes',
            subtitle: 'Save workspace choices and monitor proportions across reloads. Reset layout in the workspace menu restores configured defaults.'});
        settings.bind('persist-layouts', persistRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        layoutGroup.add(persistRow);
        const resizeGridRow = new Adw.SpinRow({
            title: 'Resize grid step (%)',
            subtitle: 'Win+Shift+Arrow in Resize mode snaps tile sizes to this percentage grid. Applies immediately.',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 50,
                step_increment: 1, page_increment: 5}),
        });
        settings.bind('resize-grid-step', resizeGridRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        layoutGroup.add(resizeGridRow);
        layoutGroup.add(new Adw.ActionRow({title: 'Layout shortcuts',
            subtitle: 'Super+H: horizontal · Super+V: vertical. Drag splitters to resize; Shift resizes both groups proportionally.'}));

        const rulesGroup = new Adw.PreferencesGroup({
            title: 'Rules',
            description: 'Window rules are loaded from a JSON file in your config directory.\n' +
                         'Edit the file and save — it reloads automatically.',
        });
        page.add(rulesGroup);

        // Path row with Open button
        const pathRow = new Adw.ActionRow({
            title: 'Config file',
            subtitle: rulesPath,
            subtitle_selectable: true,
        });

        const openButton = new Gtk.Button({
            label: 'Open',
            valign: Gtk.Align.CENTER,
        });
        openButton.connect('clicked', () => {
            const uri = Gio.File.new_for_path(rulesPath).get_uri();
            Gio.AppInfo.launch_default_for_uri_async(uri, null, null, (_, result) => {
                try {
                    Gio.AppInfo.launch_default_for_uri_finish(result);
                } catch (e) {
                    console.warn(`[HereticTiling] prefs: could not open rules file – ${e.message}`);
                }
            });
        });
        pathRow.add_suffix(openButton);
        rulesGroup.add(pathRow);

        // Reload now button
        const reloadRow = new Adw.ActionRow({
            title: 'Reload rules and layouts',
            subtitle: 'Force the running extension to re-read config.json immediately',
        });
        const reloadButton = new Gtk.Button({
            label: 'Reload now',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        reloadButton.connect('clicked', () => {
            // Bump the timestamp key — extension.js watches it and calls forceReload().
            const ts = Math.floor(Date.now() / 1000);
            settings.set_int('force-reload-timestamp', ts);
        });
        reloadRow.add_suffix(reloadButton);
        rulesGroup.add(reloadRow);

        // Validate button + status label
        const validateRow = new Adw.ActionRow({
            title: 'Validate rules and layouts',
            subtitle: 'Check config.json for errors',
        });
        const validateStatusLabel = new Gtk.Label({
            valign: Gtk.Align.CENTER,
            css_classes: ['dim-label'],
        });
        const validateButton = new Gtk.Button({
            label: 'Validate',
            valign: Gtk.Align.CENTER,
        });
        validateButton.connect('clicked', () => {
            try {
                const file = Gio.File.new_for_path(rulesPath);
                const [ok, bytes] = file.load_contents(null);
                if (!ok) {
                    validateStatusLabel.set_text('Could not read file');
                    validateStatusLabel.remove_css_class('success');
                    validateStatusLabel.add_css_class('error');
                    return;
                }
                const text = new TextDecoder().decode(bytes);
                const numWorkspaces = settings.get_int('num-workspaces');
                const { total, errors } = validateRules(text, { numWorkspaces });
                if (errors.length === 0) {
                    validateStatusLabel.set_text(`✓ ${total} rule(s), no errors`);
                    validateStatusLabel.remove_css_class('error');
                    validateStatusLabel.add_css_class('success');
                } else {
                    validateStatusLabel.set_text(
                        `✗ ${total} rule(s), ${errors.length} error(s):\n` +
                        errors.slice(0, 5).join('\n') +
                        (errors.length > 5 ? `\n… and ${errors.length - 5} more` : '')
                    );
                    validateStatusLabel.remove_css_class('success');
                    validateStatusLabel.add_css_class('error');
                }
            } catch (e) {
                validateStatusLabel.set_text(`Error: ${e.message}`);
            }
        });
        validateRow.add_suffix(validateStatusLabel);
        validateRow.add_suffix(validateButton);
        rulesGroup.add(validateRow);

        // ------------------------------------------------------------------ Developer group
        const debugGroup = new Adw.PreferencesGroup({
            title: 'Developer',
        });
        page.add(debugGroup);

        const debugRow = new Adw.SwitchRow({
            title: 'Debug logging',
            subtitle: 'Write verbose log messages to journalctl (may be noisy)',
        });
        settings.bind('debug', debugRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        debugGroup.add(debugRow);

        // ------------------------------------------------------------------ Keybindings info
        const keybGroup = new Adw.PreferencesGroup({
            title: 'Keybindings',
            description:
                'Super+1…0 — switch to workspace or toggle back\n' +
                'Super+Shift+1…0 — move window to workspace\n' +
                'History tracks only Super+number switches and resets on reload.\n' +
                'Super+D — toggle app grid\n' +
                'Super+W — close focused window\n' +
                'Super+I — toggle window inspector\n' +
                'Super+Arrow — focus neighbouring tile\n' +
                'Super+R — toggle Resize mode; Escape exits\n' +
                'Super+Shift+Arrow — move tile in Normal; resize in Resize\n' +
                'Changing workspace returns to Normal mode.',
        });
        page.add(keybGroup);

        // ------------------------------------------------------------------ Rule schema reference
        const schemaGroup = new Adw.PreferencesGroup({
            title: 'Rule Schema Reference',
            description:
                'config.json is an object with a "rules" array of rule objects. Each rule:\n\n' +
                '"match" (all optional):\n' +
                '  wm_class, wm_class_instance, wm_title — string or { regex, flags? }\n' +
                '  workspace — 1-based number (1…N)\n' +
                '  monitor — 0-based index; primary_monitor: true/false\n' +
                '  window_type — "normal" | "dialog" | "utility" | "splash" | "tooltip"\n' +
                '  is_above — boolean\n\n' +
                '"actions" (all optional):\n' +
                '  move_to_workspace — 1-based number\n' +
                '  move_to_monitor — 0-based index or "primary"\n' +
                '  maximize — true (maximize) | false (unmaximize)\n' +
                '  minimize — true\n' +
                '  float — true (make_above)\n' +
                '  sticky — true (stick+above) | false (unstick)\n' +
                '  place — preset or { x, y, width, height } (0.0–1.0 fractions)\n' +
                '    presets: left-half, right-half, top-half, bottom-half,\n' +
                '             top-left, top-right, bottom-left, bottom-right,\n' +
                '             center, left-third, center-third, right-third\n' +
                '  opacity — 0.0–1.0\n' +
                '  focus — true (activate window after all other actions,\n' +
                '          switching to its workspace)\n' +
                '  no_focus — true (if the window grabbed focus, hand it back\n' +
                '             to the previously focused window)\n\n' +
                '"priority" — number (lower runs first; default = array index)\n' +
                '"stop" — true to stop processing further rules after match\n' +
                '"comment" — human-readable label',
        });
        page.add(schemaGroup);
    }
}
