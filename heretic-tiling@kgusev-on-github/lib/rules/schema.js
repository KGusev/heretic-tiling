/**
 * Rule schema — single source of truth for the config.json vocabulary.
 *
 * Used by:
 *  - lib/rules/validator.js  (pure-JS validation, shared by prefs + engine)
 *  - lib/rules/ruleEngine.js (compilation & matching)
 *  - prefs.js                (validation UI)
 *
 * IMPORTANT: this module must stay free of GObject / shell imports so it can
 * be loaded in both the shell process and the prefs (GTK) process, and unit
 * tested with any plain JS runtime.
 */

/** Top-level keys allowed on a rule object. */
export const RULE_KEYS = new Set(['comment', 'priority', 'stop', 'match', 'actions']);

/** Keys allowed inside a rule's "match" block. */
export const MATCH_KEYS = new Set([
    'wm_class',
    'wm_class_instance',
    'wm_name',
    'wm_title',
    'is_above',
    'workspace',
    'monitor',
    'primary_monitor',
    'window_type',
]);

/**
 * String/regex match fields with their canonical window property.
 * "wm_name" is a legacy alias for "wm_class_instance".
 * @type {Array<[string, string]>} [jsonKey, propKey]
 */
export const STRING_MATCH_FIELDS = [
    ['wm_class', 'wm_class'],
    ['wm_class_instance', 'wm_class_instance'],
    ['wm_name', 'wm_class_instance'], // legacy alias
    ['wm_title', 'wm_title'],
];

/** Keys allowed inside a rule's "actions" block. */
export const ACTION_KEYS = new Set([
    'move_to_workspace',
    'move_to_monitor',
    'maximize',
    'minimize',
    'float',
    'sticky',
    'place',
    'opacity',
    'focus',
    'no_focus',
    'layout_placeholder',
]);

/** Valid values for match.window_type. */
export const WINDOW_TYPES = new Set(['normal', 'dialog', 'utility', 'splash', 'tooltip']);

/**
 * Place presets (fractions of the monitor work area).
 * The key set doubles as the list of valid actions.place preset names.
 */
export const PLACE_PRESETS = {
    'left-half': {x: 0, y: 0, width: 0.5, height: 1.0},
    'right-half': {x: 0.5, y: 0, width: 0.5, height: 1.0},
    'top-half': {x: 0, y: 0, width: 1.0, height: 0.5},
    'bottom-half': {x: 0, y: 0.5, width: 1.0, height: 0.5},
    'top-left': {x: 0, y: 0, width: 0.5, height: 0.5},
    'top-right': {x: 0.5, y: 0, width: 0.5, height: 0.5},
    'bottom-left': {x: 0, y: 0.5, width: 0.5, height: 0.5},
    'bottom-right': {x: 0.5, y: 0.5, width: 0.5, height: 0.5},
    center: {x: 0.1, y: 0.1, width: 0.8, height: 0.8},
    'left-third': {x: 0, y: 0, width: 1 / 3, height: 1.0},
    'center-third': {x: 1 / 3, y: 0, width: 1 / 3, height: 1.0},
    'right-third': {x: 2 / 3, y: 0, width: 1 / 3, height: 1.0},
};

/** Set of valid place preset names. */
export const PLACE_PRESET_NAMES = new Set(Object.keys(PLACE_PRESETS));
