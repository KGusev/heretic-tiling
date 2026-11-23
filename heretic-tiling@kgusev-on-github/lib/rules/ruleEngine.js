/**
 * RuleEngine — loads window behaviour rules from config.json and resolves
 * the merged set of actions for any given Meta.Window.
 *
 * Rule schema (one element in the JSON array):
 * {
 *   "comment":  "<optional human-readable note>",
 *   "priority": <number>,          // optional; lower = earlier; default = array index
 *   "stop":     true,              // optional; stop processing further rules after match
 *   "match": {
 *     // String / regex matchers (plain string = case-insensitive exact match)
 *     "wm_class":          "<string | { regex: string, flags?: string }>",
 *     "wm_class_instance": "<string | { regex: string, flags?: string }>",
 *     "wm_title":          "<string | { regex: string, flags?: string }>",
 *
 *     // Boolean matchers
 *     "is_above":          true | false,  // _NET_WM_STATE_ABOVE
 *
 *     // Numeric matchers
 *     "workspace":         <1-based workspace number>,  // 1..NUM_WORKSPACES
 *
 *     // Monitor matchers
 *     "monitor":           <0-based monitor index>,
 *     "primary_monitor":   true | false,
 *
 *     // Window type matcher
 *     "window_type":       "normal" | "dialog" | "utility" | "splash" | "tooltip"
 *   },
 *   "actions": {
 *     "move_to_workspace": <1-based workspace number>,  // 1..NUM_WORKSPACES
 *     "move_to_monitor":   <0-based monitor index> | "primary",
 *     "maximize":          true | false,  // true = maximize, false = unmaximize
 *     "minimize":          true,
 *     "float":             true,          // make_above() without sticking
 *     "sticky":            true | false,  // stick() + make_above() / unstick()
 *     "place":             "<preset>" | { x, y, width, height },
 *                          // presets: see lib/rules/schema.js PLACE_PRESETS
 *                          // object: fractions of the monitor work area (0.0–1.0)
 *     "opacity":           0.0–1.0,
 *     "focus":             true,          // activate/focus after all other actions
 *     "no_focus":          true           // if the window grabbed focus, hand it
 *                                         // back to the previously focused window
 *   }
 * }
 *
 * All match criteria are optional; an empty "match" block matches every window.
 * Multiple matching rules are merged in order of `priority` (ascending; then
 * array index as a tiebreaker) — later rules win on conflicts.
 * A rule with "stop": true halts further rule processing after it matches.
 *
 * Workspace numbering follows i3wm convention: numbers are 1-based and match
 * the Super+N keybinding directly (workspace 10 is Super+0).  The engine
 * converts to 0-based GNOME indices internally so callers never see raw indices.
 */

import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {Logger} from '../logger.js';
import {STRING_MATCH_FIELDS} from './schema.js';
import {validateLayouts, validateWorkspaceLayouts} from '../layouts/model.js';
import {validateRule} from './validator.js';
import {validateWorkspaceActions} from './workspaceActions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Map window_type rule string → Meta.WindowType enum value. */
const WINDOW_TYPE_MAP = {
    normal: Meta.WindowType.NORMAL,
    dialog: Meta.WindowType.DIALOG,
    utility: Meta.WindowType.UTILITY,
    splash: Meta.WindowType.SPLASHSCREEN,
    tooltip: Meta.WindowType.TOOLTIP,
};

// ---------------------------------------------------------------------------
// RuleEngine
// ---------------------------------------------------------------------------

export class RuleEngine {
    /**
     * @param {string} rulesFilePath   – absolute path to config.json
     * @param {number} [numWorkspaces] – number of workspaces (for validation)
     */
    constructor(rulesFilePath, numWorkspaces = 10) {
        this._rulesFilePath = rulesFilePath;
        this._numWorkspaces = numWorkspaces;
        this._rules = [];
        this._requiredFields = new Set(); // populated by _parseAndApply for lazy prop fetch
        this._hasTitleRules = false; // true when any rule uses wm_title matcher
        this._fileMonitor = null;
        this._loadCancel = null;
        this._reloadTimerId = null;
        this._log = new Logger('RuleEngine');

        this.layouts = {};
        this.workspaceLayouts = {};
        this.workspaceActions = [];
        this._listeners = new Set();
        this._load();
    }

    /** Subscribe to committed configuration updates; returns an unsubscribe function. */
    onReload(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /** Whether title changes need to reapply the current rules. */
    hasTitleRules() {
        return this._hasTitleRules;
    }

    // ------------------------------------------------------------------ load

    _load() {
        try {
            const file = Gio.File.new_for_path(this._rulesFilePath);
            const [ok, bytes] = file.load_contents(null);
            if (!ok) {
                this._log.warn(`could not read ${this._rulesFilePath}`);
                this._rules = [];
                return;
            }
            this._parseAndApply(bytes, `loaded`, this._rulesFilePath);
        } catch (e) {
            this._log.error(`failed to load rules – ${e.message}`);
            this._rules = [];
        }
    }

    /**
     * Async reload used by the file monitor so we don't block the main loop
     * while the editor is still flushing bytes to disk.
     */
    _loadAsync() {
        // Cancel any previous in-flight load
        if (this._loadCancel) {
            this._loadCancel.cancel();
        }
        this._loadCancel = new Gio.Cancellable();
        const cancel = this._loadCancel;

        const file = Gio.File.new_for_path(this._rulesFilePath);
        file.load_contents_async(this._loadCancel, (_, result) => {
            try {
                const [ok, bytes] = file.load_contents_finish(result);
                if (!ok) {
                    this._log.warn(`async reload: could not read ${this._rulesFilePath}`);
                    return;
                }
                if (cancel.is_cancelled() || this._loadCancel !== cancel) return;
                this._parseAndApply(bytes, `reloaded`);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    this._log.error(`async reload failed – ${e.message}`);
            } finally {
                if (this._loadCancel === cancel) this._loadCancel = null;
            }
        });
    }

    /**
     * Shared helper: decode, parse, validate and compile raw bytes into rules.
     * Also recomputes the set of required window property fields for lazy fetching.
     *
     * @param {Uint8Array} bytes   Raw file contents.
     * @param {string}     verb    Log verb ("loaded" / "reloaded").
     * @param {string}     [path]  Optional path appended to the success message.
     */
    _parseAndApply(bytes, verb, path = '') {
        const json = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(json);
        if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.rules)) {
            this._log.warn('config.json must be an object with a "rules" array');
            return;
        }

        const actionErrors = validateWorkspaceActions(parsed.workspace_actions, {
            numWorkspaces: this._numWorkspaces,
        });
        if (actionErrors.length) {
            for (const error of actionErrors) this._log.warn(error);
        } else {
            this.workspaceActions = parsed.workspace_actions ?? [];
        }

        const layoutErrors = [
            ...validateLayouts(parsed.layouts),
            ...validateWorkspaceLayouts(parsed.workspace_layouts, parsed.layouts),
        ];
        if (layoutErrors.length) {
            for (const error of layoutErrors) this._log.warn(error);
        } else {
            this.layouts = parsed.layouts ?? {};
            this.workspaceLayouts = parsed.workspace_layouts ?? {};
        }

        const compiled = parsed.rules.map((r, idx) => this._compileRule(r, idx)).filter(Boolean);

        // Sort by priority (ascending). Stable sort preserves index order as
        // a tiebreaker because we set default priority = array index.
        compiled.sort((a, b) => a.priority - b.priority);

        this._rules = compiled;

        // Compute the set of window property fields actually used by matchers.
        // This enables lazy fetching in _getWindowProps().
        this._requiredFields = new Set(this._rules.flatMap((r) => r.matchers.map((m) => m.field)));

        // Flag whether any rule needs wm_title (drives notify::title signal).
        this._hasTitleRules = this._requiredFields.has('wm_title');

        const loc = path ? ` from ${path}` : '';
        this._log.info(`${verb} ${this._rules.length} rule(s)${loc}`);
        for (const callback of this._listeners) callback();
    }

    /**
     * Compile one raw rule object into an internal representation with
     * pre-built RegExp objects so matching is cheap at runtime.
     *
     * Validation is delegated to the shared validator (lib/rules/validator.js)
     * so prefs and the engine agree on what a valid rule is; this method only
     * normalises values (1-based → 0-based, string → RegExp, enum mapping).
     *
     * @param {object} raw   Raw rule from JSON.
     * @param {number} idx   Array index (used as default priority).
     * @returns {object|null} Compiled rule, or null to skip.
     */
    _compileRule(raw, idx) {
        try {
            // ----------------------------------------------------------------
            // Validate via the shared validator
            // ----------------------------------------------------------------
            const errors = validateRule(raw, idx, {numWorkspaces: this._numWorkspaces});
            if (errors.length > 0) {
                for (const err of errors) this._log.warn(`${err} – skipping rule`);
                return null;
            }

            // ----------------------------------------------------------------
            // Normalise actions
            // ----------------------------------------------------------------
            const actions = {...(raw.actions ?? {})};

            // move_to_workspace: 1-based (user) → 0-based (GNOME API)
            if (actions.move_to_workspace != null) actions.move_to_workspace -= 1;

            // ----------------------------------------------------------------
            // Build matchers
            // ----------------------------------------------------------------
            const compiled = {
                index: idx + 1,
                comment: raw.comment ?? '',
                priority: typeof raw.priority === 'number' ? raw.priority : idx,
                stop: raw.stop === true,
                matchers: [],
                actions,
                // Rules with a window_type matcher may apply to non-NORMAL windows.
                allowNonNormal: false,
            };

            const matchDef = raw.match ?? {};

            // --- String/regex matchers for window identity fields ---
            const compiledPropKeys = new Set();
            for (const [jsonKey, propKey] of STRING_MATCH_FIELDS) {
                const value = matchDef[jsonKey];
                if (value === undefined || compiledPropKeys.has(propKey)) continue;

                const re =
                    typeof value === 'string'
                        ? new RegExp(`^${escapeRegex(value)}$`, 'i')
                        : new RegExp(value.regex, value.flags ?? 'i');

                compiled.matchers.push({field: propKey, re});
                compiledPropKeys.add(propKey);
            }

            // --- Boolean matcher: is_above ---
            if (matchDef.is_above !== undefined)
                compiled.matchers.push({field: 'is_above', boolValue: matchDef.is_above});

            // --- Numeric matcher: workspace (1-based → 0-based) ---
            if (matchDef.workspace !== undefined)
                compiled.matchers.push({field: 'workspace', numValue: matchDef.workspace - 1});

            // --- Monitor index matcher ---
            if (matchDef.monitor !== undefined)
                compiled.matchers.push({field: 'monitor', numValue: matchDef.monitor});

            // --- Primary monitor boolean matcher ---
            if (matchDef.primary_monitor !== undefined)
                compiled.matchers.push({
                    field: 'primary_monitor',
                    boolValue: matchDef.primary_monitor,
                });

            // --- Window type matcher ---
            if (matchDef.window_type !== undefined) {
                compiled.matchers.push({
                    field: 'window_type',
                    numValue: WINDOW_TYPE_MAP[matchDef.window_type],
                });
                compiled.allowNonNormal = true;
            }

            // Empty matchers = catch-all rule; this is intentional.
            return compiled;
        } catch (e) {
            this._log.error(`error compiling rule – ${e.message}`);
            return null;
        }
    }

    // ------------------------------------------------------- file monitoring

    /**
     * Start watching the rules file for changes so rules reload automatically.
     */
    startMonitor() {
        try {
            const file = Gio.File.new_for_path(this._rulesFilePath);
            this._fileMonitor = file
                .get_parent()
                .monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitor.connect('changed', (_monitor, _file, _other, eventType) => {
                if (
                    _file?.get_path() !== this._rulesFilePath &&
                    _other?.get_path() !== this._rulesFilePath
                )
                    return;
                if (eventType !== Gio.FileMonitorEvent.DELETED) {
                    this._log.debug('rules file changed – scheduling async reload');
                    if (this._reloadTimerId) GLib.source_remove(this._reloadTimerId);
                    this._reloadTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                        this._reloadTimerId = null;
                        this._loadAsync();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });
        } catch (e) {
            this._log.warn(`cannot monitor rules file – ${e.message}`);
        }
    }

    /**
     * Immediately trigger an async reload of the rules file.
     * Called when the prefs "Reload now" button updates force-reload-timestamp.
     */
    forceReload() {
        this._log.info('force reload requested');
        this._loadAsync();
    }

    stopMonitor() {
        this._listeners.clear();
        if (this._reloadTimerId) {
            GLib.source_remove(this._reloadTimerId);
            this._reloadTimerId = null;
        }
        if (this._loadCancel) {
            this._loadCancel.cancel();
            this._loadCancel = null;
        }
        if (this._fileMonitor) {
            this._fileMonitor.cancel();
            this._fileMonitor = null;
        }
    }

    // ----------------------------------------------------------------- match

    /**
     * Resolve all rules that match `window` and return their merged actions.
     * Rules are processed in priority order; later rules win on conflicts.
     * Processing stops early when a matched rule has `stop: true`.
     *
     * @param {Meta.Window} window
     * @returns {{ actions: object, allowNonNormal: boolean }}
     *          Merged actions plus a flag telling the dispatcher whether
     *          non-NORMAL windows may be processed (set when a matched rule
     *          used a window_type matcher).
     */
    resolveActions(window) {
        return this._resolve(this._getWindowProps(window));
    }

    /** Read-only snapshot, using the same merge and stop logic as execution. */
    inspect(window) {
        const properties = this._getWindowProps(
            window,
            new Set([
                'wm_class',
                'wm_class_instance',
                'wm_title',
                'workspace',
                'monitor',
                'primary_monitor',
                'window_type',
                'is_above',
            ]),
        );
        const rules = [];
        const resolved = this._resolve(properties, rules);
        const actions = {...resolved.actions};
        if (actions.move_to_workspace != null) actions.move_to_workspace++;
        properties.workspace = properties.workspace < 0 ? null : properties.workspace + 1;
        properties.window_type =
            Object.entries(WINDOW_TYPE_MAP).find(
                ([, value]) => value === properties.window_type,
            )?.[0] ?? properties.window_type;
        return {properties, rules, actions, allowNonNormal: resolved.allowNonNormal};
    }

    _resolve(props, trace = null) {
        const merged = {};
        let allowNonNormal = false;

        for (const rule of this._rules) {
            if (this._ruleMatches(rule, props)) {
                if (trace) {
                    const actions = {...rule.actions};
                    if (actions.move_to_workspace != null) actions.move_to_workspace++;
                    trace.push({
                        index: rule.index,
                        comment: rule.comment,
                        priority: rule.priority,
                        stop: rule.stop,
                        actions,
                    });
                }
                const label = rule.comment || `(priority ${rule.priority})`;
                if (!trace)
                    this._log.debug(
                        `rule "${label}" matched window ` +
                            (props.wm_class != null ? `"${props.wm_class}" ` : '') +
                            (props.wm_title != null ? `title:"${props.wm_title}" ` : '') +
                            (props.window_type != null ? `type:${props.window_type} ` : ''),
                    );
                Object.assign(merged, rule.actions);
                allowNonNormal ||= rule.allowNonNormal;

                if (rule.stop) {
                    if (!trace) this._log.debug(`rule has stop:true — halting rule processing`);
                    break;
                }
            }
        }

        return {actions: merged, allowNonNormal};
    }

    /**
     * Fetch only the window properties that are actually needed by the
     * currently-loaded rules (lazy fetching for performance).
     *
     * @param {Meta.Window} window
     * @returns {object}
     */
    _getWindowProps(window, req = this._requiredFields) {
        const props = {};

        if (req.has('wm_class')) props.wm_class = window.get_wm_class() ?? null;

        if (req.has('wm_class_instance'))
            props.wm_class_instance = window.get_wm_class_instance() ?? null;

        if (req.has('wm_title')) props.wm_title = window.get_title() ?? null;

        if (req.has('is_above')) props.is_above = window.is_above();

        if (req.has('workspace')) {
            const ws = window.get_workspace();
            props.workspace = ws ? ws.index() : -1;
        }

        if (req.has('monitor')) props.monitor = window.get_monitor();

        if (req.has('primary_monitor'))
            props.primary_monitor = window.get_monitor() === global.display.get_primary_monitor();

        if (req.has('window_type')) props.window_type = window.window_type;

        return props;
    }

    _ruleMatches(rule, props) {
        for (const matcher of rule.matchers) {
            const {field} = matcher;
            const value = props[field];
            if ('boolValue' in matcher) {
                if (value !== matcher.boolValue) return false;
            } else if ('numValue' in matcher) {
                if (value !== matcher.numValue) return false;
            } else {
                matcher.re.lastIndex = 0;
                // Regex matcher — treat missing prop (not fetched) as null → no match
                if (value == null || !matcher.re.test(value)) return false;
            }
        }
        return true;
    }
}
