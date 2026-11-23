import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {resizeWeights, minimumSize} from './model.js';

/** Empty regions stay behind windows; splitters must clear tiled input/shadow extents. */
export class LayoutOverlay {
    constructor(changed, isManaged = () => false) {
        this._changed = changed;
        this._isManaged = isManaged;
        this._actors = new Map();
        this._splitterKeys = new WeakMap();
        this._drag = null;
        this._restackedId = global.display.connect('restacked', () => this._restack());
    }
    update(descriptors) {
        const keep = new Set();
        for (const d of descriptors) {
            let key = d.node;
            if (d.splitter) {
                const child = d.splitter.children[d.splitter.index];
                // An empty slot and the splitter following it need distinct actors.
                if (!this._splitterKeys.has(child)) this._splitterKeys.set(child, Symbol('splitter'));
                key = this._splitterKeys.get(child);
            }
            keep.add(key);
            let actor = this._actors.get(key);
            if (!actor) {
                actor = new St.Widget({reactive: Boolean(d.splitter), track_hover: false,
                    style_class: d.splitter ? 'layout-splitter' : 'layout-placeholder-empty'});
                actor._descriptor = d;
                global.window_group.add_child(actor);
                if (d.splitter) {
                    if (actor.set_cursor_type) actor.set_cursor_type(d.splitter.horizontal
                        ? Clutter.CursorType.COL_RESIZE : Clutter.CursorType.ROW_RESIZE);
                    actor._border = new St.Widget({reactive: false, style_class: 'layout-separator'});
                    global.window_group.add_child(actor._border);
                    // On X11, reactive actors also need a stage input region;
                    // otherwise X delivers the press to the client underneath.
                    if (Meta.is_wayland_compositor?.() === false) {
                        Main.layoutManager.trackChrome(actor, {affectsInputRegion: true, affectsStruts: false});
                        actor._trackedChrome = true;
                    }
                    actor.connect('enter-event', () => {
                        global.display.set_cursor?.(actor._descriptor.splitter.horizontal ? Meta.Cursor.EAST_RESIZE : Meta.Cursor.SOUTH_RESIZE);
                        return Clutter.EVENT_PROPAGATE;
                    });
                    // Highlight only on pointer motion, not synthetic enter
                    // events caused by releasing a grab or moving the edge.
                    actor.connect('motion-event', () => {
                        if (!this._drag) {
                            actor.add_style_pseudo_class('highlight');
                            global.display.set_cursor?.(actor._descriptor.splitter.horizontal ? Meta.Cursor.EAST_RESIZE : Meta.Cursor.SOUTH_RESIZE);
                        }
                        return Clutter.EVENT_PROPAGATE;
                    });
                    actor.connect('leave-event', () => {
                        actor.remove_style_pseudo_class('highlight');
                        if (!this._drag) global.display.set_cursor?.(Meta.Cursor.DEFAULT);
                        return Clutter.EVENT_PROPAGATE;
                    });
                    actor.connect('button-press-event', (_, event) => this._press(actor, event));
                }
                this._actors.set(key, actor);
            }
            actor._descriptor = d;
            actor.set_position(d.rect.x, d.rect.y);
            actor.set_size(Math.max(1, d.rect.width), Math.max(1, d.rect.height));
            if (d.splitter) {
                const horizontal = d.splitter.horizontal;
                actor._border.set_position(d.rect.x + (horizontal ? Math.floor(d.rect.width / 2) : 0),
                    d.rect.y + (horizontal ? 0 : Math.floor(d.rect.height / 2)));
                actor._border.set_size(horizontal ? 1 : d.rect.width, horizontal ? d.rect.height : 1);
            }
        }
        for (const [key, actor] of this._actors) {
            if (keep.has(key)) continue;
            if (this._drag?.actor === actor) this.cancel();
            this._actors.delete(key);
            if (actor._trackedChrome) Main.layoutManager.untrackChrome(actor);
            actor._border?.destroy();
            actor.destroy();
        }
        this._restack();
    }
    _restack() {
        const group = global.window_group;
        const windows = group.get_children().filter(a => a.meta_window);
        const topTiled = windows.filter(a => this._isManaged(a.meta_window)).at(-1);
        // Insert borders first, then splitters and the preview immediately
        // above the windows. This leaves every grey border above every blue
        // highlight, including where nested horizontal/vertical edges cross.
        for (const actor of this._actors.values()) {
            if (!actor._border) continue;
            if (topTiled) group.set_child_above_sibling(actor._border, topTiled);
            else if (windows.length) group.set_child_below_sibling(actor._border, windows[0]);
        }
        for (const actor of this._actors.values()) {
            if (actor._descriptor.splitter && topTiled) {
                // A window's reactive surface extends outside its frame. Even a
                // visible gap is not clickable when the splitter is below it.
                // Always-above floating windows remain above the tiled actors.
                group.set_child_above_sibling(actor, topTiled);
            } else if (windows.length) {
                group.set_child_below_sibling(actor, windows[0]);
            }
        }
        if (this._drag && topTiled)
            group.set_child_above_sibling(this._drag.preview, topTiled);
    }
    _press(actor, event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY || this._drag) return Clutter.EVENT_PROPAGATE;
        this._clearHighlights();
        const s = actor._descriptor.splitter;
        const [x, y] = event.get_coords();
        const grab = Main.pushModal(actor);
        const preview = new St.Widget({reactive: false, style_class: 'layout-splitter-preview'});
        const rect = {...actor._descriptor.rect};
        preview.set_position(rect.x, rect.y);
        preview.set_size(rect.width, rect.height);
        global.window_group.add_child(preview);
        this._drag = {actor, preview, rect, splitter: s, grab, origin: s.horizontal ? x : y,
            shift: Boolean(event.get_state() & Clutter.ModifierType.SHIFT_MASK),
            weights: s.children.map(c => c.weight ?? 1),
            minimums: s.children.map(c => minimumSize(c, s.horizontal))};
        // A Clutter grab routes events to its actor; ancestors (including the
        // stage) do not receive the usual capture phase while it is active.
        this._restack();
        this._eventId = actor.connect('event', (_, e) => this._event(e));
        return Clutter.EVENT_STOP;
    }
    _event(event) {
        const d = this._drag;
        if (!d) return Clutter.EVENT_PROPAGATE;
        if (event.type() === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            // Keep the grab until button release. Dismissing it while the
            // button is down can strand X11's implicit pointer grab on this
            // actor and prevent the next splitter from receiving a press.
            d.cancelled = true;
            d.preview.hide();
            return Clutter.EVENT_STOP;
        }
        if (event.type() === Clutter.EventType.BUTTON_RELEASE && event.get_button() === Clutter.BUTTON_PRIMARY) {
            if (!d.cancelled) this._preview(event);
            const weights = d.cancelled ? null : d.pending;
            const changed = weights?.some((w, i) => w !== d.weights[i]);
            if (changed) d.splitter.children.forEach((c, i) => { c.weight = weights[i]; });
            this._finish();
            if (changed) this._changed(d.actor._descriptor.workspace);
            return Clutter.EVENT_STOP;
        }
        if (event.type() === Clutter.EventType.MOTION) {
            if (d.cancelled) return Clutter.EVENT_STOP;
            this._preview(event);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
    _preview(event) {
        const d = this._drag;
        const s = d.splitter;
        const [x, y] = event.get_coords();
        d.pending = resizeWeights(d.weights, s.index, (s.horizontal ? x : y) - d.origin,
            s.available, d.shift, d.minimums);
        // Move only a compositor actor. Applications keep their current sizes
        // until release, so slow client redraws cannot stall the drag preview.
        const fraction = weights => {
            const scale = Math.max(...weights);
            const normalized = weights.map(w => w / scale);
            return normalized.slice(0, s.index + 1).reduce((a, b) => a + b, 0) /
                normalized.reduce((a, b) => a + b, 0);
        };
        const delta = Math.round((fraction(d.pending) - fraction(d.weights)) * s.available);
        d.preview.set_position(d.rect.x + (s.horizontal ? delta : 0),
            d.rect.y + (s.horizontal ? 0 : delta));
    }
    _clearHighlights() {
        for (const actor of this._actors.values())
            if (actor._descriptor.splitter) actor.remove_style_pseudo_class('highlight');
    }
    _finish() {
        if (this._eventId) this._drag.actor.disconnect(this._eventId);
        this._eventId = null;
        if (this._drag) {
            this._drag.preview.destroy();
            Main.popModal(this._drag.grab);
        }
        this._drag = null;
        this._clearHighlights();
        global.display.set_cursor?.(Meta.Cursor.DEFAULT);
    }
    cancel() {
        if (!this._drag) return;
        this._finish();
    }
    destroy() {
        global.display.disconnect(this._restackedId);
        this._restackedId = null;
        this.cancel();
        for (const actor of this._actors.values()) {
            if (actor._trackedChrome) Main.layoutManager.untrackChrome(actor);
            actor._border?.destroy();
            actor.destroy();
        }
        this._actors.clear();
    }
}
