this._settings.set_boolean('center-cursor-on-focus', true);
this._sources.timeout(1500, () => {
    global.workspace_manager.get_workspace_by_index(3).activate(global.get_current_time());
    Main.overview.hide();
});
this._sources.timeout(6000, () => {
    const ws = global.workspace_manager.get_workspace_by_index(3);
    const windows = ws
        .list_windows()
        .filter((w) => w.get_wm_class() === 'org.example.HereticKittySmoke')
        .sort((a, b) => a.get_frame_rect().x - b.get_frame_rect().x);
    if (windows.length !== 3) {
        console.log('NAVIGATION-SMOKE FAIL setup');
        return;
    }
    const seat = Clutter.get_default_backend().get_default_seat();
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    const later = (ms, fn) => this._sources.timeout(ms, fn);
    const press = (symbol, shift = false, superKey = true) => {
        const key = (symbol, state) =>
            keyboard.notify_keyval(GLib.get_monotonic_time(), symbol, state);
        if (superKey) key(Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
        if (shift) key(Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
        key(symbol, Clutter.KeyState.PRESSED);
        key(symbol, Clutter.KeyState.RELEASED);
        if (shift) key(Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
        if (superKey) key(Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
    };
    let passed = true,
        width = 0,
        height = 0;
    const sizeCheck = (dimension, expected) => {
        passed &&=
            Math.abs(windows[0].get_frame_rect()[dimension] - expected) <= 1 &&
            windows[0].get_workspace() === ws;
        check(windows[0]);
    };
    const check = (target) => {
        passed &&= global.display.focus_window === target && !target.get_maximized();
    };
    const checkPointer = (target) => {
        check(target);
        const rect = target.get_frame_rect();
        const [x, y] = global.get_pointer();
        const centered =
            Math.abs(x - (rect.x + rect.width / 2)) <= 1 &&
            Math.abs(y - (rect.y + rect.height / 2)) <= 1;
        passed &&= centered;
        console.log(`NAVIGATION-POINTER ${centered ? 'PASS' : 'FAIL'} x=${x} y=${y}`);
    };
    const steps = [
        () => windows[0].activate(global.get_current_time()),
        () => press(Clutter.KEY_Right, true),
        () => {
            check(windows[0]);
            passed &&= windows[0].get_frame_rect().x > windows[1].get_frame_rect().x;
            press(Clutter.KEY_Left, true);
        },
        () => {
            passed &&= windows[0].get_frame_rect().x < windows[1].get_frame_rect().x;
            press(Clutter.KEY_r);
        },
        () => {
            passed &&= this._shortcuts.mode === 'resize' && this._shortcuts._modeLabel.visible;
        },
        () => {
            width = windows[0].get_frame_rect().width;
            press(Clutter.KEY_Right, true);
        },
        () => {
            sizeCheck('width', width + 32);
            press(Clutter.KEY_Left, true);
        },
        () => {
            sizeCheck('width', width);
            press(Clutter.KEY_Right);
        },
        () => {
            checkPointer(windows[1]);
            press(Clutter.KEY_Right);
        },
        () => {
            checkPointer(windows[2]);
            press(Clutter.KEY_Right);
        },
        () => {
            checkPointer(windows[2]);
            press(Clutter.KEY_Left);
        },
        () => {
            checkPointer(windows[1]);
            this._layouts.applyPreset(ws, 'vbox');
        },
        () => {
            windows.sort((a, b) => a.get_frame_rect().y - b.get_frame_rect().y);
            windows[0].activate(global.get_current_time());
        },
        () => {
            height = windows[0].get_frame_rect().height;
            press(Clutter.KEY_Down, true);
        },
        () => {
            sizeCheck('height', height + 32);
            press(Clutter.KEY_Up, true);
        },
        () => {
            sizeCheck('height', height);
            press(Clutter.KEY_Down);
        },
        () => {
            checkPointer(windows[1]);
            press(Clutter.KEY_Up);
        },
        () => {
            checkPointer(windows[0]);
            press(Clutter.KEY_Up);
        },
        () => {
            checkPointer(windows[0]);
            press(Clutter.KEY_Escape, false, false);
        },
        () => {
            passed &&= this._shortcuts.mode === 'normal';
            press(Clutter.KEY_r);
        },
        () => {
            passed &&= this._shortcuts.mode === 'resize';
            press(Clutter.KEY_r);
        },
        () => {
            passed &&= this._shortcuts.mode === 'normal';
            press(Clutter.KEY_r);
        },
        () => {
            passed &&= this._shortcuts.mode === 'resize';
            global.workspace_manager.get_workspace_by_index(2).activate(global.get_current_time());
        },
        () => {
            passed &&= this._shortcuts.mode === 'normal' && !this._shortcuts._modeLabel.visible;
            console.log('NAVIGATION-SMOKE ' + (passed ? 'PASS' : 'FAIL'));
        },
    ];
    steps.forEach((step, i) => later(250 * (i + 1), step));
});
