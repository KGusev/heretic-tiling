import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GnomeDesktop from 'gi://GnomeDesktop';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class SecondaryPanel {
    constructor(monitor, indicator, showClock) {
        this.indicator = indicator;
        this.actor = new St.BoxLayout({name: 'panel', reactive: true, width: monitor.width});
        this.actor.set_position(monitor.x, monitor.y);
        this.actor.add_child(indicator.box);
        this._height = Main.panel.bind_property(
            'height',
            this.actor,
            'height',
            GObject.BindingFlags.SYNC_CREATE,
        );
        if (showClock) {
            this._clock = new GnomeDesktop.WallClock();
            const label = new St.Label({
                style_class: 'secondary-panel-clock',
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this.actor.add_child(label);
            this._clockBinding = this._clock.bind_property(
                'clock',
                label,
                'text',
                GObject.BindingFlags.SYNC_CREATE,
            );
        }
        Main.layoutManager.addChrome(this.actor, {affectsStruts: true, trackFullscreen: true});
    }

    destroy() {
        this._clockBinding?.unbind();
        this._clock?.run_dispose();
        this._height.unbind();
        Main.layoutManager.removeChrome(this.actor);
        this.indicator.destroy();
        this.actor.destroy();
    }
}
