// Injected only into the temporary extension by gnome-kitty-smoke.py --resize.
// Exercises actual Clutter pointer/keyboard dispatch, not direct handler calls.
this._sources.timeout(1500, () => {
    global.workspace_manager.get_workspace_by_index(3).activate(global.get_current_time());
    Main.overview.hide();
});
this._sources.timeout(6000, () => {
    const ws = global.workspace_manager.get_workspace_by_index(3);
    const windows = ws.list_windows().filter(w => w.get_wm_class() === 'org.example.HereticKittySmoke')
        .sort((a, b) => a.get_frame_rect().x - b.get_frame_rect().x);
    if (windows.length !== 3) { console.log('SPLITTER-SMOKE setup FAIL'); return; }
    const overlay = this._layouts._overlay;
    const seat = Clutter.get_default_backend().get_default_seat();
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const later = (ms, fn) => this._sources.timeout(ms, fn);
    const widths = () => windows.map(w => w.get_frame_rect().width);
    const heights = () => windows.map(w => w.get_frame_rect().height);
    const close = (a, b) => Math.abs(a - b) <= 2;
    const report = (name, passed) => console.log(`SPLITTER-SMOKE ${name} ${passed ? 'PASS' : 'FAIL'} widths=${widths()} heights=${heights()}`);
    const key = (symbol, state) => keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, state);
    const button = state => pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, state);
    const drag = (index, delta, shift = false, escape = false) => {
        const actor = [...overlay._actors.values()].find(a => a._descriptor.splitter?.index === index);
        if (!actor) { report('missing-actor', false); return; }
        const {rect, splitter} = actor._descriptor;
        const before = windows.map(w => {
            const r = w.get_frame_rect();
            return [r.x, r.y, r.width, r.height].join(',');
        });
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
        report('hit-target', global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y) === actor);
        pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        if (shift) key(Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
        later(100, () => button(Clutter.ButtonState.PRESSED));
        later(250, () => {
            report('grab', Boolean(overlay._drag) && overlay._drag.shift === shift);
            pointer.notify_absolute_motion(GLib.get_monotonic_time(),
                x + (splitter.horizontal ? delta : 0), y + (splitter.horizontal ? 0 : delta));
        });
        later(400, () => {
            const unchanged = windows.every((w, i) => {
                const r = w.get_frame_rect();
                return [r.x, r.y, r.width, r.height].join(',') === before[i];
            });
            const preview = overlay._drag?.preview;
            report('preview', unchanged && Boolean(preview) &&
                close(splitter.horizontal ? preview.x - rect.x : preview.y - rect.y, delta));
        });
        if (escape) later(450, () => {
            key(Clutter.KEY_Escape, Clutter.KeyState.PRESSED);
            key(Clutter.KEY_Escape, Clutter.KeyState.RELEASED);
        });
        later(800, () => report('cleared', !overlay._drag &&
            [...overlay._actors.values()].filter(a => a._descriptor.splitter).every(a =>
                a.get_theme_node().get_background_color().alpha === 0)));
        later(600, () => {
            button(Clutter.ButtonState.RELEASED);
            if (shift) key(Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
        });
    };
    report('borders', [...overlay._actors.values()].filter(a => a._descriptor.splitter).every(a => {
        const border = a._border;
        const color = border?.get_theme_node().get_background_color();
        return border?.mapped && color.red === 128 && color.green === 128 && color.blue === 128 && color.alpha === 255;
    }));
    const initial = widths();
    windows[0].raise(); // Native restacking must not bury the splitter again.
    later(100, () => drag(0, 120));
    later(1000, () => {
        const actual = widths();
        report('adjacent', close(actual[0], initial[0] + 120) && close(actual[1], initial[1] - 120) &&
            close(actual[2], initial[2]) && !overlay._drag);
        const beforeShift = widths();
        drag(1, 100, true);
        later(1000, () => {
            const afterShift = widths();
            report('shift', close(afterShift[2], beforeShift[2] - 100) &&
                Math.abs(afterShift[0] / afterShift[1] - beforeShift[0] / beforeShift[1]) < 0.02 && !overlay._drag);
            drag(0, 80, false, true);
            later(1000, () => {
                report('escape', widths().every((v, i) => close(v, afterShift[i])) && !overlay._drag);
                this._layouts.applyPreset(ws, 'vbox');
                later(250, () => {
                    windows.sort((a, b) => a.get_frame_rect().y - b.get_frame_rect().y);
                    const vertical = heights();
                    drag(0, 80);
                    later(1000, () => {
                        const actualHeight = heights();
                        report('vertical', close(actualHeight[0], vertical[0] + 80) &&
                            close(actualHeight[1], vertical[1] - 80) && close(actualHeight[2], vertical[2]) && !overlay._drag);
                        const floating = windows[2];
                        floating.make_above();
                        later(250, () => {
                            const actor = [...overlay._actors.values()].find(a => a._descriptor.splitter);
                            if (!actor) { report('floating', false); return; }
                            const r = actor._descriptor.rect;
                            const x = r.x + r.width / 2, y = r.y + r.height / 2;
                            floating.move_resize_frame(false, Math.round(x - 150), Math.round(y - 100), 300, 300);
                            later(250, () => report('floating', floating.get_compositor_private().contains(
                                global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y))));
                        });
                    });
                });
            });
        });
    });
});
