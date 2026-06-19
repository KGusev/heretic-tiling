# Workspace-entry actions

[Back to README](../README.md)

Use the optional `workspace_actions` array in `config.json` for application UI
controls that ordinary window-manager actions cannot invoke. Each entry runs when
its one-based `workspace` becomes active, through any navigation method. No actions
run on extension startup or merely from saving configuration. This is independent
of ordinary window rules and their priority/merge/stop logic.

For example, this restores Zoom's meeting from its mini-window on workspace 6:

```json
{
  "workspace_actions": [
    {
      "workspace": 6,
      "match": {
        "wm_class": "zoom",
        "wm_class_instance": "zoom",
        "wm_title": "zoom_linux_float_video_window"
      },
      "click": { "anchor": "bottom-right", "x": -20, "y": -20 },
      "delay_ms": 200,
      "attempts": 5,
      "interval_ms": 250
    }
  ],
  "rules": []
}
```

Merge `workspace_actions` into your existing configuration, retaining your window
rules. The example's names, coordinates, dimensions, workspace, and timing are
entirely configurable; there is no application-specific behavior in the extension.
Keep ordinary rules to make the mini-window sticky and maximize the main meeting.

- `match`: at least one of `wm_class`, `wm_class_instance`, `wm_title`. All supplied
  fields must match; these are case-insensitive exact strings (no regex).
- `click`: coordinates `x` and `y`, measured in X11 client-window pixels.
  Without `anchor`, these are absolute coordinates; `width` and `height` are
  required exact-size guards, as before.
  With `anchor` (`top-left`, `top-right`, `bottom-left`, or `bottom-right`),
  offsets are relative to that corner of the current window. Left/top offsets
  are nonnegative; right/bottom offsets are negative. For example, `bottom-right`
  with `x: -20, y: -20` resolves to `(width - 20, height - 20)`.
  Anchored clicks adapt to resizing; optional `width` and `height` must be supplied
  together if you still want an exact-size guard. The position is recomputed on
  every retry. Points outside the window are skipped, never clamped.
  Optional `button`: 1 (left, default), 2 (middle), or 3 (right). The pointer does
  not move. Anchors assume the control stays the same pixel distance from its
  corner; they do not detect buttons or adapt offsets to UI scaling.
- `delay_ms`: initial delay, 0–5000 (default 0).
- `attempts`: 1–10 (default 1). Repeat only while the original matching windows
  remain. Retries recheck identity and dimensions and never target new windows.
- `interval_ms`: delay between attempts, 50–2000 (default 250).
- `comment`: optional label.

The backend currently supports targeted clicks on **X11**, using Python 3 and
libX11. Wayland sessions skip these actions. Applications may ignore synthetic
clicks, and UI changes require adjusting the configuration. Every matching window
is targeted; narrow the match if only one should receive the action. Multiple
entries execute independently and may overlap, so avoid overlapping matches for
conflicting actions. Retries stop when you leave the workspace; config reload or
extension disable cancels pending helpers. Removing the section disables all
workspace actions. Invalid entries retain the previous valid section and report
validation errors in Preferences and the session log.

After upgrading from the former Zoom-specific implementation, reload GNOME Shell
once. The old `zoom-restore-workspace` setting is no longer used. Subsequent edits
to `workspace_actions` reload automatically.
