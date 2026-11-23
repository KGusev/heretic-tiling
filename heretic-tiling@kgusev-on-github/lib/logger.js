/**
 * Thin logging wrapper for Heretic Tiling.
 *
 * Verbose debug output is gated behind a single module-level debug flag that
 * can be toggled at runtime via GSettings
 * (org.gnome.shell.extensions.heretic-tiling → debug). The extension calls
 * setGlobalDebug() once from enable() and from the settings-changed handler;
 * every Logger instance picks the flag up automatically — no per-module
 * setDebug() plumbing required.
 *
 * Usage:
 *   import { Logger, setGlobalDebug } from './lib/logger.js';
 *   const log = new Logger('MyModule');
 *   log.debug('verbose detail');   // only printed when global debug is on
 *   log.info('status message');    // always printed
 *   log.warn('something odd');     // always printed
 *   log.error('something broke');  // always printed
 */

const PREFIX = '[HereticTiling]';

let _globalDebug = false;

/**
 * Toggle verbose debug output for all Logger instances.
 * @param {boolean} value
 */
export function setGlobalDebug(value) {
    _globalDebug = !!value;
}

export class Logger {
    /**
     * @param {string} module  Short module/class name included in every message.
     */
    constructor(module) {
        this._module = module;
    }

    _tag() {
        return `${PREFIX} ${this._module}:`;
    }

    /** Verbose — only printed when the global debug flag is enabled. */
    debug(msg) {
        if (_globalDebug) console.log(`${this._tag()} ${msg}`);
    }

    /** Informational — always printed (for important lifecycle events). */
    info(msg) {
        console.log(`${this._tag()} ${msg}`);
    }

    /** Warning — always printed. */
    warn(msg) {
        console.warn(`${this._tag()} ${msg}`);
    }

    /** Error — always printed. */
    error(msg) {
        console.error(`${this._tag()} ${msg}`);
    }
}
