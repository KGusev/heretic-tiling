/** A frozen rule preview: opening Shell UI must not change the inspected target. */
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const KEY = 'inspect-window-shortcut';

export class WindowInspector {
    constructor(settings, rules, layouts) {
        this._settings = settings;
        this._rules = rules;
        this._layouts = layouts;
        this._indicator = null;
    }

    enable() {
        Main.wm.addKeybinding(KEY, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP, () => this.toggle());
    }

    toggle() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
            return;
        }
        const window = global.display.focus_window;
        let report = 'No focused window. Close the inspector, focus a window, and press Win+I.';
        if (window) {
            const snapshot = this._rules.inspect(window);
            const managed = this._layouts.isManaged(window);
            report = [
                'Window properties (workspace: 1-based; monitor: 0-based)',
                JSON.stringify(snapshot.properties, null, 2),
                '\nMatching rules (evaluation order; stops at stop: true)',
                snapshot.rules.length ? JSON.stringify(snapshot.rules, null, 2) : 'No matching rules.',
                '\nFinal merged rule actions',
                JSON.stringify(snapshot.actions, null, 2),
                `\nManaged by tiling: ${managed ? 'yes' : 'no'}`,
                managed ? 'Tiling overrides rule place/maximize geometry.' : '',
                'Preview only: actions are not executed. Non-normal windows require an explicit window_type rule.',
                'Snapshot taken when Win+I was pressed. Close and reopen to refresh.',
            ].filter(Boolean).join('\n');
        }
        const indicator = new PanelMenu.Button(0.0, 'Window inspector');
        this._indicator = indicator;
        indicator.add_child(new St.Label({text: 'Inspector', y_align: Clutter.ActorAlign.CENTER}));
        const scroll = new St.ScrollView({style: 'max-height: 500px; max-width: 720px;'});
        scroll.set_policy(St.PolicyType.AUTOMATIC, St.PolicyType.AUTOMATIC);
        const content = new St.BoxLayout({vertical: true});
        content.add_child(new St.Label({text: report, style: 'font-family: monospace; padding: 12px;'}));
        scroll.add_child(content);
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(scroll);
        indicator.menu.addMenuItem(item);
        indicator.menu.addAction('Copy report', () =>
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, report));
        indicator.menu.addAction('Close inspector', () => this.toggle());
        Main.panel.addToStatusArea('heretic-window-inspector', indicator);
        indicator.menu.open();
    }

    destroy() {
        Main.wm.removeKeybinding(KEY);
        this._indicator?.destroy();
        this._indicator = null;
    }
}
