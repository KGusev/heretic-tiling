import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loader, Emitter} from './modules.mjs';

async function fixture() {
    const tracked = new Set();
    const actors = [], stage = new Emitter();
    const display = Object.assign(new Emitter(), {set_cursor() {}}); let dismissed = 0, updates = 0;
    stage.grab = () => ({dismiss() { dismissed++; }});
    class Widget extends Emitter {
        constructor(props) { super(); Object.assign(this, props); }
        set_position(x, y) { this.x = x; this.y = y; } set_size(width, height) { this.width = width; this.height = height; }
        add_child(child) { this.child = child; }
        hide() { this.hidden = true; }
        add_style_pseudo_class(name) { this.highlight = name; }
        remove_style_pseudo_class() { this.highlight = null; }
        destroy() { if (actors.includes(this)) actors.splice(actors.indexOf(this), 1);
            stack.splice(stack.indexOf(this), 1); this.handlers.clear(); }
    }
    const tiled = {meta_window: {managed: true}}, floating = {meta_window: {managed: false}};
    const stack = [tiled, floating];
    const move = (actor, sibling, above) => {
        stack.splice(stack.indexOf(actor), 1);
        stack.splice(stack.indexOf(sibling) + (above ? 1 : 0), 0, actor);
    };
    const group = {add_child(a) { if (a.style_class !== 'layout-separator') actors.push(a); stack.push(a); }, get_children: () => stack,
        set_child_below_sibling: (a, b) => move(a, b, false),
        set_child_above_sibling: (a, b) => move(a, b, true)};
    const Clutter = {BUTTON_PRIMARY: 1, EVENT_PROPAGATE: 0, EVENT_STOP: 1, KEY_Escape: 27,
        ModifierType: {SHIFT_MASK: 1}, EventType: {KEY_PRESS: 1, BUTTON_RELEASE: 2, MOTION: 3}};
    const load = loader({'resource:///org/gnome/shell/ui/main.js': {pushModal: actor => stage.grab(actor), popModal: grab => grab.dismiss(), layoutManager: {
        trackChrome(actor, params) { assert.equal(params.affectsInputRegion, true); assert.equal(params.affectsStruts, false); tracked.add(actor); },
        untrackChrome(actor) { assert.ok(tracked.delete(actor)); },
    }}, 'gi://St': {default: {Widget}}, 'gi://Clutter': {default: Clutter},
        'gi://Meta': {default: {is_wayland_compositor: () => false, Cursor: {DEFAULT: 0, EAST_RESIZE: 1, SOUTH_RESIZE: 2}}}},
    {global: {stage, window_group: group, display}});
    const {LayoutOverlay} = await load('lib/layouts/overlay.js');
    const overlay = new LayoutOverlay(() => updates++, w => w.managed);
    const children = Array.from({length: 4}, () => ({type: 'placeholder', weight: 1}));
    const splitter = {children, index: 1, horizontal: true, available: 400};
    const descriptor = {splitter, rect: {x: 0, y: 0, width: 6, height: 300}};
    overlay.update([descriptor]);
    const event = (type, x = 0, shift = false) => ({type: () => type, get_coords: () => [x, 0],
        get_button: () => 1, get_state: () => shift ? 1 : 0, get_key_symbol: () => 27});
    return {overlay, tracked, stage, actors, display, stack, tiled, floating, children, event, descriptor, dismissed: () => dismissed, updates: () => updates};
}

test('Escape restores weights, ignores motion, and keeps the grab through button release', async () => {
    const f = await fixture();
    f.actors[0].emit('button-press-event', f.event(0, 0, true));
    f.actors[0].emit('event', f.event(3, 50, false));
    assert.ok(f.children.every(c => c.weight === 1));
    assert.equal(f.overlay._drag.preview.x, 50);
    assert.equal(f.updates(), 0);
    f.actors[0].emit('event', f.event(1));
    assert.ok(f.children.every(c => c.weight === 1));
    assert.equal(f.dismissed(), 0);
    f.actors[0].emit('event', f.event(3, 80));
    assert.ok(f.children.every(c => c.weight === 1));
    f.actors[0].emit('event', f.event(2));
    assert.equal(f.stage.handlers.size, 0); assert.equal(f.dismissed(), 1);
});

test('release commits; destroying during drag restores snapshot and releases grab', async () => {
    const f = await fixture();
    f.actors[0].emit('button-press-event', f.event(0));
    f.actors[0].emit('event', f.event(3, 20));
    f.actors[0].emit('event', f.event(2, 20));
    assert.equal(f.children[1].weight, 1.2);
    assert.equal(f.updates(), 1);
    f.actors[0].emit('button-press-event', f.event(0));
    f.actors[0].emit('event', f.event(3, 40));
    f.overlay.destroy();
    assert.equal(f.children[1].weight, 1.2);
    assert.equal(f.actors.length, 0); assert.equal(f.stage.handlers.size, 0); assert.equal(f.dismissed(), 2);
});

test('splitters are above tiled input extents, below floating windows, and restack on focus changes', async () => {
    const f = await fixture(); const actor = f.actors[0];
    assert.deepEqual(f.stack, [f.tiled, actor, actor._border, f.floating]);
    f.stack.splice(0, f.stack.length, actor._border, actor, f.tiled, f.floating);
    f.display.emit('restacked');
    assert.deepEqual(f.stack, [f.tiled, actor, actor._border, f.floating]);
    actor.emit('button-press-event', f.event(0));
    const preview = f.overlay._drag.preview;
    f.display.emit('restacked');
    assert.deepEqual(f.stack, [f.tiled, preview, actor, actor._border, f.floating]);
    f.overlay.destroy(); assert.equal(f.display.handlers.size, 0);
    assert.deepEqual(f.stack, [f.tiled, f.floating]);
});

test('an empty slot and its following splitter keep distinct actors and input behavior', async () => {
    const f = await fixture();
    const node = f.children[1];
    f.overlay.update([{node, rect: {x: 0, y: 0, width: 100, height: 300}}, f.descriptor]);
    assert.equal(f.actors.length, 2);
    const empty = f.actors.find(a => !a._descriptor.splitter);
    const splitter = f.actors.find(a => a._descriptor.splitter);
    assert.equal(empty.reactive, false); assert.equal(splitter.reactive, true);
    assert.ok(f.stack.indexOf(empty) < f.stack.indexOf(f.tiled));
    assert.ok(f.stack.indexOf(splitter) > f.stack.indexOf(f.tiled));
    splitter.emit('button-press-event', f.event(0));
    splitter.emit('event', f.event(3, 20));
    splitter.emit('event', f.event(2, 20));
    assert.equal(f.children[1].weight, 1.2);
});

test('only splitters register stage input regions and remove them on update and destroy', async () => {
    const f = await fixture();
    assert.deepEqual([...f.tracked], [f.actors[0]]);
    f.overlay.update([{node: f.children[0], rect: f.descriptor.rect}]);
    assert.equal(f.tracked.size, 0);
    f.overlay.update([f.descriptor]);
    assert.equal(f.tracked.size, 1);
    f.overlay.destroy();
    assert.equal(f.tracked.size, 0);
});

test('many motions only move a clamped preview; release commits the latest position once', async () => {
    const f = await fixture();
    const actor = f.actors[0];
    actor.emit('button-press-event', f.event(0));
    for (let x = 1; x <= 1000; x++) actor.emit('event', f.event(3, x));
    assert.ok(f.children.every(c => c.weight === 1));
    assert.equal(f.updates(), 0);
    assert.equal(f.overlay._drag.preview.x, 68);
    actor.emit('event', f.event(2, 60));
    assert.equal(f.children[1].weight, 1.6);
    assert.equal(f.children[2].weight, 0.4);
    assert.equal(f.updates(), 1);
    assert.equal(f.actors.length, 1);
});

test('permanent grey separator occupies one pixel inside the six-pixel input target', async () => {
    const f = await fixture();
    const actor = f.actors[0];
    assert.equal(actor._border.style_class, 'layout-separator');
    assert.equal(actor._border.reactive, false);
    assert.equal(actor._border.width, 1);
    assert.equal(actor._border.height, 300);
    assert.equal(actor._border.x, 3);
    f.overlay.update([{...f.descriptor, splitter: {...f.descriptor.splitter, horizontal: false},
        rect: {x: 0, y: 100, width: 300, height: 6}}]);
    assert.equal(actor._border.width, 300);
    assert.equal(actor._border.height, 1);
    assert.equal(actor._border.y, 103);
});

test('release clears highlight and synthetic re-entry cannot leave the splitter blue', async () => {
    const f = await fixture();
    const actor = f.actors[0];
    actor.emit('motion-event', f.event(3));
    assert.equal(actor.highlight, 'highlight');
    actor.emit('button-press-event', f.event(0));
    assert.equal(actor.highlight, null);
    actor.emit('event', f.event(3, 40));
    actor.emit('event', f.event(2, 40));
    actor.emit('enter-event');
    f.overlay.update([f.descriptor]);
    assert.equal(actor.highlight, null);
    assert.equal(f.overlay._drag, null);
    assert.equal(f.actors.length, 1);
    actor.emit('motion-event', f.event(3));
    assert.equal(actor.highlight, 'highlight');
    actor.emit('leave-event');
    assert.equal(actor.highlight, null);
});
