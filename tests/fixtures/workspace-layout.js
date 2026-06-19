this._sources.timeout(1500, () => {
    global.workspace_manager.get_workspace_by_index(3).activate(global.get_current_time());
    Main.overview.hide();
});
this._sources.timeout(6000, () => {
    const ws = global.workspace_manager.get_workspace_by_index(3);
    const windows = () => ws.list_windows().filter(w => w.get_wm_class() === 'org.example.HereticKittySmoke');
    const browser = windows().find(w => w.get_title() === 'Layout-Kitty-1');
    const area = ws.get_work_area_for_monitor(Main.layoutManager.primaryIndex);
    const check = (name, pass) => console.log(`WORKSPACE-SMOKE ${name} ${pass ? 'PASS' : 'FAIL'}`);
    if (!browser || windows().length !== 3) { check('stack', false); return; }
    const near = (a, b) => Math.abs(a - b) <= 2;
    check('stack', near(browser.get_frame_rect().width, area.width * .7) &&
        windows().filter(w => w !== browser).every(w => near(w.get_frame_rect().width, area.width * .3) &&
            near(w.get_frame_rect().height, area.height / 2)));
    browser.activate(global.get_current_time());
    this._sources.timeout(250, () => this._layouts.resizeDirection('right'));
    this._sources.timeout(750, () => {
        check('resize', near(browser.get_frame_rect().width, area.width * .7 + 32));
        for (const w of windows()) if (w !== browser) w.delete(global.get_current_time());
    });
    this._sources.timeout(1800, () => check('alone', windows().length === 1 && Boolean(browser.get_maximized())));
    this._sources.timeout(7000, () => check('reset', windows().length === 2 &&
        near(browser.get_frame_rect().width, area.width * .7) && !browser.get_maximized()));
});
