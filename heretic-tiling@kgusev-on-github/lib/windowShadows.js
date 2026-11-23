import Meta from 'gi://Meta';

/** Suppress compositor window shadows while enabled; restore previous parameters. */
export class WindowShadows {
    constructor() {
        this._saved = [];
        this._factory = Meta.ShadowFactory?.get_default();
        if (!this._factory || !Meta.ShadowParams) return;
        for (const name of ['normal', 'dialog', 'modal_dialog', 'utility', 'border', 'attached']) {
            for (const focused of [false, true]) {
                this._saved.push({name, focused, params: this._factory.get_params(name, focused)});
                this._factory.set_params(name, focused, new Meta.ShadowParams({
                    radius: 0, top_fade: 0, x_offset: 0, y_offset: 0, opacity: 0,
                }));
            }
        }
    }
    destroy() {
        for (const {name, focused, params} of this._saved)
            this._factory.set_params(name, focused, params);
        this._saved = [];
    }
}
