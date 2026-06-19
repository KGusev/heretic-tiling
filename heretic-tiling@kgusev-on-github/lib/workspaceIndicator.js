/**
 * WorkspaceIndicator — custom panel widget for Heretic Tiling.
 *
 * Replaces the default GNOME Shell workspace indicator with a row of
 * numbered buttons placed in the left panel box. The active workspace
 * button is highlighted via the `workspace-button-active` CSS class.
 * Workspaces that contain a window with an active urgent hint are
 * highlighted via the `workspace-button-urgent` CSS class.
 *
 * Lifecycle
 * ---------
 *   const ind = new WorkspaceIndicator(numWorkspaces, log);
 *   Main.panel._leftBox.insert_child_at_index(ind.box, 0);
 *   // … later …
 *   Main.panel._leftBox.remove_child(ind.box);
 *   ind.destroy();
 */

import St      from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main      from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export class WorkspaceIndicator {
    /**
     * @param {number} numWorkspaces  Number of workspace buttons to create.
     * @param {import('./logger.js').Logger} [log]  Optional logger instance.
     * @param {boolean} [scrollSwitch]  Whether scrolling over the indicator
     *                                  switches workspaces (default true).
     * @param {boolean} [highlightEmpty]  Whether to dim workspace buttons that
     *                                    contain no windows (default true).
     * @param {boolean} [middleClickMove]  Whether middle-clicking a workspace
     *                                     button moves the focused window to it
     *                                     (default true).
     */
    constructor(numWorkspaces, log = null, scrollSwitch = true, highlightEmpty = true, middleClickMove = true, layouts = null) {
        this._layouts = layouts;
        this._numWorkspaces = numWorkspaces;
        this._log           = log;
        this._scrollSwitch  = scrollSwitch;
        this._highlightEmpty = highlightEmpty;
        this._middleClickMove = middleClickMove;
        this._buttons       = [];   // St.Button[], indexed by workspace index
        this._menus         = [];   // PopupMenu.PopupMenu[], indexed by workspace index
        this._signals       = [];   // { obj, id } pairs to disconnect on destroy
        this._windowSignals = new Map(); // Meta.Window → signal-id[]
        this._workspaceSignals = []; // { obj, id } pairs for per-workspace window signals

        // Manages grab/close behaviour for all per-button popup menus.
        this._menuManager = new PopupMenu.PopupMenuManager(this);

        this._box = new St.BoxLayout({
            style_class:  'workspace-indicator-box',
            reactive:     true,
            can_focus:    false,
            track_hover:  false,
            vertical:     false,
        });

        // Scroll over the indicator switches workspaces (up = previous, down = next)
        this._connectSignal(this._box, 'scroll-event', (actor, event) => {
            if (!this._scrollSwitch) return Clutter.EVENT_PROPAGATE;

            const wm = global.workspace_manager;
            const n  = wm.get_n_workspaces();
            let idx  = wm.get_active_workspace_index();

            switch (event.get_scroll_direction()) {
                case Clutter.ScrollDirection.UP:
                    // Wrap around: scrolling up from the first workspace
                    // goes to the last one (infinite scroll).
                    idx = (idx - 1 + n) % n;
                    break;
                case Clutter.ScrollDirection.DOWN:
                    // Wrap around: scrolling down from the last workspace
                    // goes back to the first one (infinite scroll).
                    idx = (idx + 1) % n;
                    break;
                default:
                    return Clutter.EVENT_PROPAGATE;
            }

            const ws = wm.get_workspace_by_index(idx);
            if (ws) ws.activate(global.get_current_time());
            this._log?.debug(`scrolled to workspace ${idx + 1}`);
            return Clutter.EVENT_STOP;
        });

        this._build();
        this._connectWorkspaceSignals();

        // React to the user switching workspaces
        this._connectSignal(
            global.workspace_manager,
            'workspace-switched',
            () => this._refresh(),
        );

        // Rebuild if the number of workspaces changes at runtime
        this._connectSignal(
            global.workspace_manager,
            'notify::n-workspaces',
            () => this._rebuild(),
        );

        // Track urgent hints on all existing windows
        const existingWindows = global.display.list_all_windows();
        for (const win of existingWindows)
            this._trackWindow(win);

        // Track urgent hints on windows created after startup
        this._connectSignal(
            global.display,
            'window-created',
            (_, win) => this._trackWindow(win),
        );
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /** The St.BoxLayout to insert into the panel. */
    get box() {
        return this._box;
    }

    /**
     * Enable or disable scroll-to-switch behaviour at runtime.
     *
     * @param {boolean} enabled
     */
    setScrollSwitch(enabled) {
        this._scrollSwitch = enabled;
        this._log?.debug(`scroll-to-switch ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Enable or disable middle-click-to-move at runtime.
     *
     * @param {boolean} enabled
     */
    setMiddleClickMove(enabled) {
        this._middleClickMove = enabled;
        this._log?.debug(`middle-click-move ${enabled ? 'enabled' : 'disabled'}`);
    }

    /** Disconnect all signals and destroy the widget tree. */
    destroy() {
        for (const { obj, id } of this._signals) {
            try { obj.disconnect(id); } catch (_) {}
        }
        this._signals = [];
        this._buttons = [];

        // Destroy all per-button popup menus
        for (const menu of this._menus) {
            try { menu.destroy(); } catch (_) {}
        }
        this._menus = [];
        this._menuManager = null;

        // Disconnect per-window urgent signals
        for (const [win, ids] of this._windowSignals) {
            for (const id of ids) {
                try { win.disconnect(id); } catch (_) {}
            }
        }
        this._windowSignals.clear();

        // Disconnect per-workspace window signals
        for (const { obj, id } of this._workspaceSignals) {
            try { obj.disconnect(id); } catch (_) {}
        }
        this._workspaceSignals = [];

        this._box.destroy();
        this._box = null;
        this._log?.debug('WorkspaceIndicator destroyed');
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /**
     * Build one St.Button per workspace and append them to this._box.
     * Called once on construction and again on _rebuild().
     */
    _build() {
        const n = global.workspace_manager.get_n_workspaces();
        // Use the count from workspace_manager so we stay in sync at runtime,
        // but fall back to the configured value on first call.
        const count = n > 0 ? n : this._numWorkspaces;

        for (let i = 0; i < count; i++) {
            const label = String(i + 1);
            const btn   = new St.Button({
                label,
                style_class: 'workspace-button',
                can_focus:   true,
                reactive:    true,
                track_hover: true,
            });

            // Capture `i` in closure
            const idx = i;
            btn.connect('clicked', () => {
                const ws = global.workspace_manager.get_workspace_by_index(idx);
                if (ws) ws.activate(global.get_current_time());
                this._log?.debug(`switched to workspace ${idx + 1}`);
            });

            // Right-click opens the per-workspace context menu; middle-click
            // moves the focused window to the workspace.
            btn.connect('button-press-event', (actor, event) => {
                const button = event.get_button();

                if (button === Clutter.BUTTON_SECONDARY) {
                    const menu = this._menus[idx];
                    if (menu) {
                        this._populateMenu(menu, idx);
                        // The PopupMenu constructor only attaches the actor to the
                        // stage when the source button is already in the stage. Our
                        // buttons are built before the indicator box is inserted
                        // into the panel, so attach the actor here, right before
                        // opening, to guarantee it is in the stage for open().
                        if (!menu.actor.get_parent()) {
                            Main.uiGroup.add_child(menu.actor);
                            menu.toggle();
                        }
                    }
                    return Clutter.EVENT_STOP;
                }

                if (button === Clutter.BUTTON_MIDDLE && this._middleClickMove) {
                    this._moveFocusedToWorkspace(idx);
                    return Clutter.EVENT_STOP;
                }

                return Clutter.EVENT_PROPAGATE;
            });

            this._box.add_child(btn);
            this._buttons.push(btn);
            this._menus.push(this._buildMenu(btn));
        }

        this._refresh();
        this._refreshUrgent();
        this._refreshWindows();
        this._log?.debug(`WorkspaceIndicator built with ${count} buttons`);
    }

    /**
     * Recreate all buttons (called when n-workspaces changes at runtime).
     */
    _rebuild() {
        // Remove existing buttons
        for (const btn of this._buttons) {
            this._box.remove_child(btn);
            btn.destroy();
        }
        this._buttons = [];

        // Destroy the old per-button menus
        for (const menu of this._menus) {
            try { menu.destroy(); } catch (_) {}
        }
        this._menus = [];

        this._build();
        this._connectWorkspaceSignals();
        this._log?.debug('WorkspaceIndicator rebuilt');
    }

    /**
     * Connect `window-added` / `window-removed` signals on every workspace so
     * the empty-workspace state refreshes whenever a window enters or leaves a
     * workspace. These fire reliably on `change_workspace()` moves, unlike the
     * per-window `notify::workspace` signal. Reconnects from scratch each call
     * so it is safe to call on rebuild.
     */
    _connectWorkspaceSignals() {
        // Disconnect any previously connected workspace signals
        for (const { obj, id } of this._workspaceSignals) {
            try { obj.disconnect(id); } catch (_) {}
        }
        this._workspaceSignals = [];

        const wm = global.workspace_manager;
        const n  = wm.get_n_workspaces();
        for (let i = 0; i < n; i++) {
            const ws = wm.get_workspace_by_index(i);
            if (!ws) continue;

            this._workspaceSignals.push({
                obj: ws,
                id:  ws.connect('window-added',   () => this._refreshWindows()),
            });
            this._workspaceSignals.push({
                obj: ws,
                id:  ws.connect('window-removed', () => this._refreshWindows()),
            });
        }
    }

    /**
     * Create a PopupMenu attached to a workspace button and register it with
     * the shared menu manager. The menu is populated lazily on open so the
     * window list is always current.
     *
     * @param {St.Button} btn  The workspace button the menu is anchored to.
     * @returns {PopupMenu.PopupMenu}
     */
    _buildMenu(btn) {
        const menu = new PopupMenu.PopupMenu(btn, 0, St.Side.TOP);
        menu.actor.add_style_class_name('workspace-context-menu');

        // The actor is attached to the stage right before opening (see the
        // button-press handler). On close, detach it again so the invisible
        // boxpointer does not draw over the workspace indicator.
        menu.connect('open-state-changed', (m, isOpen) => {
            if (!isOpen && menu.actor.get_parent())
                Main.uiGroup.remove_child(menu.actor);
        });

        this._menuManager.addMenu(menu);
        return menu;
    }

    /**
     * (Re)populate a workspace context menu with the current actions and
     * window list. Called right before the menu is opened.
     *
     * @param {PopupMenu.PopupMenu} menu
     * @param {number}              idx  0-based workspace index.
     */
    _populateMenu(menu, idx) {
        menu.removeAll();

        const wm = global.workspace_manager;
        const ws = wm.get_workspace_by_index(idx);
        if (!ws) return;

        const now = global.get_current_time();

        menu.addAction('Switch to workspace', () => ws.activate(now));
        if (this._layouts) {
            const submenu = new PopupMenu.PopupSubMenuMenuItem('Layout');
            const labels = {none: 'None', hbox: 'Horizontal', vbox: 'Vertical'};
            for (const preset of this._layouts.presets) {
                const item = submenu.menu.addAction(labels[preset] ?? preset, () => this._layouts.applyPreset(ws, preset));
                if (this._layouts.getActivePreset(ws) === preset) item.setOrnament(PopupMenu.Ornament.CHECK);
            }
            submenu.menu.addAction('Reset layout', () => this._layouts.resetLayout(ws));
            menu.addMenuItem(submenu);
        }

        // "Move all windows here" — shown only when the target workspace is
        // empty AND the current active workspace has at least one movable
        // (non-sticky) window. Sticky windows are excluded because they appear
        // on every workspace, so they neither occupy the target nor can be moved.
        const activeIdx = wm.get_active_workspace_index();
        const activeWs  = wm.get_workspace_by_index(activeIdx);

        const targetEmpty = !ws.list_windows().some(win => !win.is_on_all_workspaces());
        const currentHasWindows = activeWs
            ? activeWs.list_windows().some(win => !win.is_on_all_workspaces())
            : false;

        if (targetEmpty && currentHasWindows && idx !== activeIdx) {
            menu.addAction('Move all windows here', () => {
                if (!activeWs) return;
                let moved = 0;
                for (const win of activeWs.list_windows()) {
                    if (win.is_on_all_workspaces()) continue; // sticky — leave in place
                    win.change_workspace(ws);
                    moved++;
                }
                // Switch to the target workspace so the user lands where the
                // windows were just moved.
                ws.activate(global.get_current_time());
                this._log?.debug(
                    `moved ${moved} window(s) from workspace ${activeIdx + 1} → ${idx + 1}`
                );
            });
        }
    }

    /**
     * Move the currently focused window to the workspace at `idx` and switch to
     * it. Mirrors the `Super+Shift+N` keybinding as a mouse gesture.
     *
     * No-ops when:
     *  - there is no focused window,
     *  - the focused window is sticky (appears on every workspace),
     *  - the target workspace is the current one,
     *  - the target index is out of range.
     *
     * @param {number} idx  0-based workspace index.
     */
    _moveFocusedToWorkspace(idx) {
        const wm = global.workspace_manager;
        const target = wm.get_workspace_by_index(idx);
        if (!target) return;

        const win = global.display.get_focus_window();
        if (!win || win.is_on_all_workspaces()) return;

        const activeIdx = wm.get_active_workspace_index();
        if (idx === activeIdx) return;

        win.change_workspace(target);
        target.activate(global.get_current_time());
        this._log?.debug(
            `middle-click: moved "${win.get_title()}" → workspace ${idx + 1}`
        );
    }

    /**
     * Update the active-workspace highlight without rebuilding the full widget tree.
     * Adds `workspace-button-active` to the current workspace button and removes
     * it from all others.
     */
    _refresh() {
        const activeIdx = global.workspace_manager.get_active_workspace_index();

        for (let i = 0; i < this._buttons.length; i++) {
            const btn = this._buttons[i];
            if (i === activeIdx) {
                if (!btn.has_style_class_name('workspace-button-active'))
                    btn.add_style_class_name('workspace-button-active');
            } else {
                btn.remove_style_class_name('workspace-button-active');
            }
        }
    }

    /**
     * Scan every workspace for windows with an active urgent or demands-attention
     * hint and toggle the `workspace-button-urgent` CSS class accordingly.
     */
    _refreshUrgent() {
        const wm = global.workspace_manager;

        for (let i = 0; i < this._buttons.length; i++) {
            const ws  = wm.get_workspace_by_index(i);
            let hasUrgent = false;

            if (ws) {
                for (const win of ws.list_windows()) {
                    if (win.urgent || win.demands_attention) {
                        hasUrgent = true;
                        break;
                    }
                }
            }

            const btn = this._buttons[i];
            if (hasUrgent) {
                if (!btn.has_style_class_name('workspace-button-urgent'))
                    btn.add_style_class_name('workspace-button-urgent');
            } else {
                btn.remove_style_class_name('workspace-button-urgent');
            }
        }
    }

    /**
     * Scan every workspace and toggle the `workspace-button-empty` CSS class on
     * buttons whose workspace contains no windows. Workspaces without windows
     * are rendered dimmer than ones that have windows.
     *
     * Sticky windows (on all workspaces) are excluded: they appear in
     * `list_windows()` for every workspace, so counting them would make every
     * workspace look occupied.
     *
     * When the "highlight empty workspaces" preference is disabled, the class
     * is removed from every button and never re-added.
     */
    _refreshWindows() {
        const wm = global.workspace_manager;

        for (let i = 0; i < this._buttons.length; i++) {
            const btn = this._buttons[i];

            if (!this._highlightEmpty) {
                btn.remove_style_class_name('workspace-button-empty');
                continue;
            }

            const ws = wm.get_workspace_by_index(i);
            const hasWindows = ws
                ? ws.list_windows().some(win => !win.is_on_all_workspaces())
                : false;

            if (!hasWindows) {
                if (!btn.has_style_class_name('workspace-button-empty'))
                    btn.add_style_class_name('workspace-button-empty');
            } else {
                btn.remove_style_class_name('workspace-button-empty');
            }
        }
    }

    /**
     * Begin tracking urgent-hint and workspace-change signals for a single
     * window. Safe to call multiple times for the same window (idempotent).
     *
     * @param {Meta.Window} win
     */
    _trackWindow(win) {
        if (this._windowSignals.has(win)) return;

        const ids = [
            win.connect('notify::urgent',            () => this._refreshUrgent()),
            win.connect('notify::demands-attention', () => this._refreshUrgent()),
            win.connect('unmanaged',                 () => this._untrackWindow(win)),
        ];
        this._windowSignals.set(win, ids);
        this._refreshUrgent();
        this._refreshWindows();
    }

    /**
     * Stop tracking urgent-hint and workspace-change signals for a window that
     * has been unmanaged.
     *
     * @param {Meta.Window} win
     */
    _untrackWindow(win) {
        const ids = this._windowSignals.get(win);
        if (!ids) return;

        for (const id of ids) {
            try { win.disconnect(id); } catch (_) {}
        }
        this._windowSignals.delete(win);
        this._refreshUrgent();
        this._refreshWindows();
    }

    /**
     * Helper: connect a signal and track it for disconnection in destroy().
     *
     * @param {object} obj     GObject to connect to.
     * @param {string} signal  Signal name.
     * @param {Function} fn    Handler.
     */
    _connectSignal(obj, signal, fn) {
        const id = obj.connect(signal, fn);
        this._signals.push({ obj, id });
        return id;
    }
}
