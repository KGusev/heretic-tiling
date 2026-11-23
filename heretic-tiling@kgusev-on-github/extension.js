/**
 * Heretic Tiling — main entry point.
 *
 * Thin orchestrator: creates the modules, wires them together in enable()
 * and tears everything down in disable(). All heavy logic lives in lib/:
 *
 *  - lib/rules/ruleEngine.js     — load & match window rules from config.json
 *  - lib/rules/validator.js      — shared pure-JS rule validation
 *  - lib/actions/dispatcher.js   — apply resolved actions to a window
 *  - lib/actions/windowActions.js— stateless window actions
 *  - lib/actions/stickyManager.js— sticky-window registry + focus handling
 *  - lib/windowTracker.js        — window-created retries, title monitors
 *  - lib/keybindings.js          — workspace keybinding setup / restore
 *  - lib/shortcuts.js            — Super+D / Super+W shortcuts
 *  - lib/dockManager.js          — Ubuntu dock disable / restore
 *  - lib/workspaceIndicator.js   — custom panel workspace indicator
 *  - lib/utils/*                 — tracked GLib sources & GObject signals
 */

import Gio from 'gi://Gio';
import {WindowInspector} from './lib/windowInspector.js';
import {WindowShadows} from './lib/windowShadows.js';
import {WindowDimming} from './lib/windowDimming.js';
import {WorkspaceActions} from './lib/workspaceActions.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import GLib from 'gi://GLib';

import {LayoutManager} from './lib/layouts/layoutManager.js';
import {RuleEngine} from './lib/rules/ruleEngine.js';
import {ActionDispatcher} from './lib/actions/dispatcher.js';
import {StickyManager} from './lib/actions/stickyManager.js';
import {WindowTracker} from './lib/windowTracker.js';
import {FocusManager} from './lib/focusManager.js';
import {KeybindingsManager} from './lib/keybindings.js';
import {ShortcutsManager} from './lib/shortcuts.js';
import {DockManager} from './lib/dockManager.js';
import {WorkspaceIndicator} from './lib/workspaceIndicator.js';
import {SourceTracker} from './lib/utils/sourceTracker.js';
import {SignalTracker} from './lib/utils/signalTracker.js';
import {Logger, setGlobalDebug} from './lib/logger.js';

/** Path inside the user's XDG config dir where config.json is stored. */
const USER_CONFIG_SUBDIR = 'heretic-tiling';
const CONFIG_FILENAME = 'config.json';

export default class HereticTilingExtension extends Extension {
    enable() {
        this._windowShadows = new WindowShadows();
        this._sources = new SourceTracker();
        this._signals = new SignalTracker();

        // GSettings objects
        this._settings = this.getSettings();
        this._shellSettings = new Gio.Settings({schema: 'org.gnome.shell'});
        this._mutterSettings = new Gio.Settings({schema: 'org.gnome.mutter'});
        this._wmPrefs = new Gio.Settings({schema: 'org.gnome.desktop.wm.preferences'});
        this._mutterKeybindings = new Gio.Settings({schema: 'org.gnome.mutter.keybindings'});
        this._wmKeybindings = new Gio.Settings({schema: 'org.gnome.desktop.wm.keybindings'});
        this._shellKeybindings = new Gio.Settings({schema: 'org.gnome.shell.keybindings'});

        // Logger (debug flag comes from GSettings; global for all modules)
        setGlobalDebug(this._settings.get_boolean('debug'));
        this._log = new Logger('Extension');

        // Watch the debug key so toggling in prefs takes effect immediately
        this._signals.connect(this._settings, 'changed::debug', () => {
            const v = this._settings.get_boolean('debug');
            setGlobalDebug(v);
            this._log.info(`debug logging ${v ? 'enabled' : 'disabled'}`);
        });

        // Watch the force-reload-timestamp key so the prefs "Reload now" button works
        this._signals.connect(this._settings, 'changed::force-reload-timestamp', () => {
            this._log.info('force reload triggered from prefs');
            this._ruleEngine?.forceReload();
        });

        // Read configurable workspace count (default 10)
        const numWorkspaces = this._settings.get_int('num-workspaces');

        // 1. Fixed number of workspaces
        this._savedSettings = {
            dynamic: this._mutterSettings.get_boolean('dynamic-workspaces'),
            num: this._wmPrefs.get_int('num-workspaces'),
        };
        this._mutterSettings.set_boolean('dynamic-workspaces', false);
        this._wmPrefs.set_int('num-workspaces', numWorkspaces);

        // 2. Workspace keybindings (Super+N / Super+Shift+N)
        this._keybindings = new KeybindingsManager(
            this._wmKeybindings,
            this._shellKeybindings,
            this._settings,
            numWorkspaces,
            this._mutterKeybindings,
        );
        this._keybindings.setup();

        // 3. Rule engine — prefer user config dir, fall back to bundled config.json
        const configPath = this._ensureUserConfigFile();
        this._ruleEngine = new RuleEngine(configPath, numWorkspaces);
        this._ruleEngine.startMonitor();

        // 4. Sticky manager + action dispatcher + window tracker
        this._layouts = new LayoutManager(this._settings, this._mutterSettings, this._ruleEngine);
        this._layouts.enable();
        this._ruleEngine.onReload(() => this._layouts.reload());
        this._stickyManager = new StickyManager();
        this._dispatcher = new ActionDispatcher(this._stickyManager, this._sources, this._layouts);
        this._windowTracker = new WindowTracker(this._ruleEngine, this._dispatcher, this._sources);
        this._windowTracker.enable();

        // Focus behaviour reacts to settings on each focus change.
        this._focusManager = new FocusManager(this._settings);
        this._focusManager.enable();
        this._windowDimming = new WindowDimming(this._settings, this._ruleEngine);

        // 5. Super+D → app grid, Super+W → close focused window
        this._shortcuts = new ShortcutsManager(this._settings, this._layouts);
        this._shortcuts.enable();
        this._inspector = new WindowInspector(this._settings, this._ruleEngine, this._layouts);
        this._inspector.enable();

        // 6. Disable Ubuntu dock
        this._dockManager = new DockManager(this._shellSettings);
        this._dockManager.disableDock();

        // 7. Unfocus sticky windows after workspace switch.
        this._workspaceActions = new WorkspaceActions(this._ruleEngine, this.path, this._sources);
        this._signals.connect(global.window_manager, 'switch-workspace', () => {
            this._workspaceActions.onWorkspaceChanged();
            this._log.debug('workspace switched — deferring sticky-window check');
            this._sources.idle(() => this._stickyManager?.unfocusAll(), GLib.PRIORITY_DEFAULT_IDLE);
        });

        // 8. Custom workspace indicator in the left panel box (if enabled in prefs)
        if (this._settings.get_boolean('custom-workspace-indicator'))
            this._setupWorkspaceIndicator(numWorkspaces);

        // Watch the scroll-to-switch toggle so it takes effect without reloading
        this._signals.connect(this._settings, 'changed::workspace-scroll-switch', () => {
            this._wsIndicator?.setScrollSwitch(
                this._settings.get_boolean('workspace-scroll-switch'),
            );
        });

        // Watch the middle-click-move toggle so it takes effect without reloading
        this._signals.connect(this._settings, 'changed::middle-click-move', () => {
            this._wsIndicator?.setMiddleClickMove(this._settings.get_boolean('middle-click-move'));
        });

        this._log.info('enabled');
    }

    disable() {
        this._workspaceActions?.destroy();
        this._workspaceActions = null;
        this._inspector?.destroy();
        this._inspector = null;
        this._windowShadows?.destroy();
        this._windowShadows = null;
        this._layouts?.destroy();
        this._layouts = null;
        // Cancel all pending GLib sources and disconnect all tracked signals
        this._sources?.clearAll();
        this._sources = null;
        this._signals?.disconnectAll();
        this._signals = null;

        // Tear down window tracker (its own signals/sources)
        this._windowTracker?.destroy();
        this._windowTracker = null;
        this._dispatcher = null;

        // Focus manager: disconnect its display signals
        this._focusManager?.destroy();
        this._windowDimming?.destroy();
        this._windowDimming = null;
        this._focusManager = null;

        // Sticky manager: disconnect per-window handlers, clear registry
        this._stickyManager?.destroy();
        this._stickyManager = null;

        // Remove custom keybinding shortcuts
        this._shortcuts?.disable();
        this._shortcuts = null;

        // Restore workspace keybindings
        this._keybindings?.restore();
        this._keybindings = null;

        // Stop file monitor and discard rule engine
        this._ruleEngine?.stopMonitor();
        this._ruleEngine = null;

        // Restore workspace count settings
        if (this._savedSettings) {
            this._mutterSettings?.set_boolean('dynamic-workspaces', this._savedSettings.dynamic);
            this._wmPrefs?.set_int('num-workspaces', this._savedSettings.num);
            this._savedSettings = null;
        }

        // Destroy custom workspace indicator and restore the default one
        this._teardownWorkspaceIndicator();

        // Restore ubuntu dock
        this._dockManager?.restoreDock();
        this._dockManager = null;

        // Release GSettings objects
        this._settings = null;
        this._shellSettings = null;
        this._mutterSettings = null;
        this._wmPrefs = null;
        this._mutterKeybindings = null;
        this._wmKeybindings = null;
        this._shellKeybindings = null;

        this._log?.info('disabled');
        this._log = null;
    }

    // -----------------------------------------------------------------------
    // User rules file
    // -----------------------------------------------------------------------

    /**
     * Ensure a config.json exists in the user config directory.
     * If it doesn't, copy the bundled default there so user edits survive
     * extension updates.
     *
     * @returns {string} absolute path to the user's config.json
     */
    _ensureUserConfigFile() {
        const configDir = GLib.build_filenamev([GLib.get_user_config_dir(), USER_CONFIG_SUBDIR]);
        const userConfigPath = GLib.build_filenamev([configDir, CONFIG_FILENAME]);
        const bundledPath = GLib.build_filenamev([this.path, CONFIG_FILENAME]);

        try {
            const userFile = Gio.File.new_for_path(userConfigPath);
            if (!userFile.query_exists(null)) {
                // Create config directory if needed
                const dir = Gio.File.new_for_path(configDir);
                if (!dir.query_exists(null)) dir.make_directory_with_parents(null);

                // Copy bundled config as the initial user config
                const bundledFile = Gio.File.new_for_path(bundledPath);
                bundledFile.copy(userFile, Gio.FileCopyFlags.NONE, null, null);
                this._log.info(`created user config at ${userConfigPath}`);
            }
        } catch (e) {
            this._log.warn(
                `could not create user config file, falling back to bundled: ${e.message}`,
            );
            return bundledPath;
        }

        return userConfigPath;
    }

    // -----------------------------------------------------------------------
    // Workspace indicator
    // -----------------------------------------------------------------------

    /**
     * Hide the default workspace indicator, create the custom one and inject
     * it at the start of the panel's left box.
     *
     * @param {number} numWorkspaces
     */
    _setupWorkspaceIndicator(numWorkspaces) {
        // In GNOME Shell 45+, the workspace dots live inside the ActivitiesButton.
        // Hiding only the child (WorkspaceIndicators) leaves the button actor itself
        // visible — it still intercepts hover events and draws its background.
        // Hide the entire ActivitiesButton so no remnant is left on screen.
        this._hiddenDefaultIndicatorActor = null;

        const activities = Main.panel.statusArea.activities;
        if (activities) {
            activities.hide();
            this._hiddenDefaultIndicatorActor = activities;
            this._log.debug('ActivitiesButton (system workspace indicator) hidden');
        } else {
            this._log.warn('statusArea.activities not found — default indicator not hidden');
        }

        // Build and insert the custom indicator into the left panel box.
        const scrollSwitch = this._settings.get_boolean('workspace-scroll-switch');
        const highlightEmpty = this._settings.get_boolean('highlight-empty-workspaces');
        const middleClickMove = this._settings.get_boolean('middle-click-move');
        this._wsIndicator = new WorkspaceIndicator(
            numWorkspaces,
            this._log,
            scrollSwitch,
            highlightEmpty,
            middleClickMove,
            this._layouts,
        );
        Main.panel._leftBox.insert_child_at_index(this._wsIndicator.box, 0);
        this._log.debug('custom workspace indicator inserted into left panel box');
    }

    /** Destroy the custom indicator and unhide the default one. */
    _teardownWorkspaceIndicator() {
        if (this._wsIndicator) {
            try {
                Main.panel._leftBox.remove_child(this._wsIndicator.box);
            } catch (_) {}
            this._wsIndicator.destroy();
            this._wsIndicator = null;
        }
        if (this._hiddenDefaultIndicatorActor) {
            this._hiddenDefaultIndicatorActor.show();
            this._hiddenDefaultIndicatorActor = null;
        }
    }
}
