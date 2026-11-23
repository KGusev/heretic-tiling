import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SignalTracker} from './utils/signalTracker.js';

/** Own only our brightness effects, leaving application opacity untouched. */
export class WindowDimming {
    constructor(settings, ruleEngine) {
        this._settings = settings;
        this._ruleEngine = ruleEngine;
        this._signals = new SignalTracker();
        this._effects = new Map();
        this._overview = Main.overview.visible;
        this._signals.connect(global.display, 'notify::focus-window', () => this._sync());
        // A newly created Meta.Window may not have its compositor actor yet.
        this._signals.connect(global.window_manager, 'map', () => this._sync());
        for (const key of ['dim-unfocused-windows', 'unfocused-window-dim-percent'])
            this._signals.connect(settings, `changed::${key}`, () => this._sync());
        this._signals.connect(Main.overview, 'showing', () => {
            this._overview = true;
            this._sync();
        });
        this._signals.connect(Main.overview, 'hidden', () => {
            this._overview = false;
            this._sync();
        });
        this._unsubscribeRules = ruleEngine.onReload(() => this._sync());
        this._sync();
    }

    _sync() {
        const enabled = this._settings.get_boolean('dim-unfocused-windows') && !this._overview;
        const brightness = -this._settings.get_int('unfocused-window-dim-percent') / 100;
        const focused = global.display.focus_window;
        const eligible = new Set([
            Meta.WindowType.NORMAL,
            Meta.WindowType.DIALOG,
            Meta.WindowType.MODAL_DIALOG,
            Meta.WindowType.UTILITY,
        ]);
        // Overlays that must not take focus must not darken the desktop either.
        const canDim =
            focused &&
            eligible.has(focused.get_window_type()) &&
            this._ruleEngine.resolveActions(focused).actions.no_focus !== true;
        for (const actor of global.get_window_actors()) {
            const window = actor.meta_window;
            const dim =
                enabled &&
                canDim &&
                brightness < 0 &&
                window &&
                window !== focused &&
                eligible.has(window.get_window_type());
            if (!dim) {
                this._remove(actor);
                continue;
            }
            let effect = this._effects.get(actor);
            if (!effect) {
                effect = new Clutter.BrightnessContrastEffect();
                actor.add_effect_with_name('heretic-tiling-dim', effect);
                this._effects.set(actor, effect);
                this._signals.connect(actor, 'destroy', () => {
                    this._effects.delete(actor);
                    this._signals.disconnectObject(actor);
                });
            }
            effect.set_brightness(brightness);
        }
    }

    _remove(actor) {
        const effect = this._effects.get(actor);
        if (!effect) return;
        actor.remove_effect(effect);
        this._effects.delete(actor);
        this._signals.disconnectObject(actor);
    }

    destroy() {
        this._unsubscribeRules();
        this._signals.disconnectAll();
        for (const actor of this._effects.keys()) this._remove(actor);
    }
}
