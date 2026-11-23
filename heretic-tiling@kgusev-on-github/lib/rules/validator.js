/**
 * Rule validator — pure-JS validation of config.json content.
 *
 * Single source of truth for rule validation, shared by:
 *  - prefs.js               (the "Validate" button in preferences)
 *  - lib/rules/ruleEngine.js (skipping invalid rules on load)
 *
 * IMPORTANT: no GObject / shell imports — must run in both the shell and
 * prefs processes and be unit-testable with any plain JS runtime.
 */

import {validateLayouts, validateWorkspaceLayouts} from '../layouts/model.js';
import {validateWorkspaceActions} from './workspaceActions.js';

import {
    RULE_KEYS, MATCH_KEYS, ACTION_KEYS,
    STRING_MATCH_FIELDS, WINDOW_TYPES, PLACE_PRESET_NAMES,
} from './schema.js';

/**
 * Validate a single rule object.
 *
 * @param {object} rule           Raw rule from JSON.
 * @param {number} index          Array index (for the default label).
 * @param {object} [opts]
 * @param {number} [opts.numWorkspaces]  Upper bound for workspace numbers;
 *                                       omit to skip the range check.
 * @returns {string[]} list of error strings (empty = valid)
 */
export function validateRule(rule, index, opts = {}) {
    const errors = [];
    const label = rule?.comment ? `rule "${rule.comment}"` : `rule #${index + 1}`;
    const maxWs = opts.numWorkspaces ?? null;

    if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
        return [`${label}: must be an object`];
    }

    // Unknown top-level keys
    for (const k of Object.keys(rule)) {
        if (!RULE_KEYS.has(k))
            errors.push(`${label}: unknown key "${k}"`);
    }

    // priority / stop / comment
    if ('priority' in rule && typeof rule.priority !== 'number')
        errors.push(`${label}: "priority" must be a number`);
    if ('stop' in rule && typeof rule.stop !== 'boolean')
        errors.push(`${label}: "stop" must be a boolean`);
    if ('comment' in rule && typeof rule.comment !== 'string')
        errors.push(`${label}: "comment" must be a string`);

    // ------------------------------------------------------------- match
    const match = rule.match ?? {};
    if (typeof match !== 'object' || match === null || Array.isArray(match)) {
        errors.push(`${label}: "match" must be an object`);
    } else {
        for (const k of Object.keys(match)) {
            if (!MATCH_KEYS.has(k))
                errors.push(`${label}: unknown match key "${k}"`);
        }

        // String/regex fields — also detect wm_name/wm_class_instance conflict
        const seenPropKeys = new Set();
        for (const [jsonKey, propKey] of STRING_MATCH_FIELDS) {
            const v = match[jsonKey];
            if (v === undefined) continue;

            if (seenPropKeys.has(propKey)) {
                errors.push(
                    `${label}: "${jsonKey}" conflicts with an earlier matcher for ` +
                    `"${propKey}" (use "wm_class_instance" or "wm_name", not both)`);
                continue;
            }
            seenPropKeys.add(propKey);

            if (typeof v === 'string') continue;
            if (typeof v === 'object' && v !== null && typeof v.regex === 'string') {
                try {
                    // Also validate that the regex actually compiles.
                    new RegExp(v.regex, v.flags ?? 'i');
                } catch (e) {
                    errors.push(`${label}: match.${jsonKey} regex invalid — ${e.message}`);
                }
                continue;
            }
            errors.push(`${label}: match.${jsonKey} must be a string or { regex, flags? }`);
        }

        if ('is_above' in match && typeof match.is_above !== 'boolean')
            errors.push(`${label}: match.is_above must be a boolean`);

        if ('primary_monitor' in match && typeof match.primary_monitor !== 'boolean')
            errors.push(`${label}: match.primary_monitor must be a boolean`);

        if ('workspace' in match) {
            const ws = match.workspace;
            if (!Number.isInteger(ws) || ws < 1 || (maxWs !== null && ws > maxWs))
                errors.push(`${label}: match.workspace must be an integer 1..${maxWs ?? 'N'}`);
        }

        if ('monitor' in match && (!Number.isInteger(match.monitor) || match.monitor < 0))
            errors.push(`${label}: match.monitor must be a non-negative integer`);

        if ('window_type' in match && !WINDOW_TYPES.has(match.window_type))
            errors.push(`${label}: match.window_type must be one of: ${[...WINDOW_TYPES].join(', ')}`);
    }

    // ----------------------------------------------------------- actions
    const actions = rule.actions ?? {};
    if (typeof actions !== 'object' || actions === null || Array.isArray(actions)) {
        errors.push(`${label}: "actions" must be an object`);
    } else {
        for (const k of Object.keys(actions)) {
            if (!ACTION_KEYS.has(k))
                errors.push(`${label}: unknown action "${k}"`);
        }

        if ('move_to_workspace' in actions) {
            const v = actions.move_to_workspace;
            if (!Number.isInteger(v) || v < 1 || (maxWs !== null && v > maxWs))
                errors.push(`${label}: actions.move_to_workspace must be an integer 1..${maxWs ?? 'N'}`);
        }

        if ('move_to_monitor' in actions) {
            const v = actions.move_to_monitor;
            if (v !== 'primary' && (!Number.isInteger(v) || v < 0))
                errors.push(`${label}: actions.move_to_monitor must be a non-negative integer or "primary"`);
        }

        if ('layout_placeholder' in actions &&
            (typeof actions.layout_placeholder !== 'string' || !actions.layout_placeholder.trim()))
            errors.push(`${label}: actions.layout_placeholder must be a nonempty string`);

        if ('maximize' in actions && typeof actions.maximize !== 'boolean')
            errors.push(`${label}: actions.maximize must be a boolean`);

        if ('minimize' in actions && actions.minimize !== true)
            errors.push(`${label}: actions.minimize must be true`);

        if ('float' in actions && actions.float !== true)
            errors.push(`${label}: actions.float must be true`);

        if ('sticky' in actions && typeof actions.sticky !== 'boolean')
            errors.push(`${label}: actions.sticky must be a boolean`);

        if ('focus' in actions && actions.focus !== true)
            errors.push(`${label}: actions.focus must be true`);

        if ('no_focus' in actions && actions.no_focus !== true)
            errors.push(`${label}: actions.no_focus must be true`);

        if ('opacity' in actions) {
            const v = actions.opacity;
            if (typeof v !== 'number' || v < 0 || v > 1)
                errors.push(`${label}: actions.opacity must be a number 0.0–1.0`);
        }

        if ('place' in actions) {
            const v = actions.place;
            if (typeof v === 'string') {
                if (!PLACE_PRESET_NAMES.has(v))
                    errors.push(`${label}: actions.place preset "${v}" unknown; ` +
                                `valid presets: ${[...PLACE_PRESET_NAMES].join(', ')}`);
            } else if (typeof v === 'object' && v !== null) {
                for (const k of ['x', 'y', 'width', 'height']) {
                    if (typeof v[k] !== 'number' || v[k] < 0 || v[k] > 1)
                        errors.push(`${label}: actions.place.${k} must be a number 0.0–1.0`);
                }
            } else {
                errors.push(`${label}: actions.place must be a preset string or { x, y, width, height }`);
            }
        }
    }

    return errors;
}

/**
 * Validate a full config.json text.
 *
 * @param {string} jsonText
 * @param {object} [opts]              See validateRule().
 * @returns {{ total: number, errors: string[] }}
 */
export function validateRules(jsonText, opts = {}) {
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (e) {
        return { total: 0, errors: [`JSON parse error: ${e.message}`] };
    }

    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.rules))
        return { total: 0, errors: ['config.json must be an object with a "rules" array'] };

    const errors = [...validateWorkspaceActions(parsed.workspace_actions, opts), ...validateLayouts(parsed.layouts),
            ...validateWorkspaceLayouts(parsed.workspace_layouts, parsed.layouts)];
    for (let i = 0; i < parsed.rules.length; i++)
        errors.push(...validateRule(parsed.rules[i], i, opts));

    return { total: parsed.rules.length, errors };
}
