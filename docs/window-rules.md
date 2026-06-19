# Window rules

[Back to README](../README.md)

Rules are stored in:

```
~/.config/heretic-tiling/config.json
```

The file is created automatically on first launch by copying the bundled
defaults. Edit it with any text editor — it reloads automatically on save.

### Schema

`config.json` is a JSON **object** with a `rules` array of rule objects:

```json
{
  "rules": [
    {
      "comment":  "human-readable label (optional)",
      "priority": 10,
      "stop":     false,
      "match":    { },
      "actions":  { }
    }
  ]
}
```

### match criteria

All criteria are optional. An empty (or absent) `match` block matches every window.

| Key | Type | Description |
|-----|------|-------------|
| `wm_class` | string or `{ "regex": "…", "flags": "i" }` | Window class — plain string = case-insensitive exact match |
| `wm_class_instance` | string or regex object | Window instance name |
| `wm_title` | string or regex object | Window title; rules re-run on every title change |
| `workspace` | integer (1-based) | Workspace the window is currently on |
| `monitor` | integer (0-based) | Monitor index |
| `primary_monitor` | boolean | `true` if window is on the primary monitor |
| `window_type` | `"normal"` `"dialog"` `"utility"` `"splash"` `"tooltip"` | Window type |
| `is_above` | boolean | `_NET_WM_STATE_ABOVE` flag |

### actions

| Key | Value | Description |
|-----|-------|-------------|
| `move_to_workspace` | integer (1-based) | Move window to that workspace |
| `move_to_monitor` | integer (0-based) or `"primary"` | Move window to that monitor |
| `maximize` | `true` / `false` | Maximize or unmaximize |
| `minimize` | `true` | Minimize |
| `float` | `true` / `false` | Enable / disable floating independently of always-on-top |
| `sticky` | `true` / `false` | Stick to all workspaces + always-above / remove sticky |
| `layout_placeholder` | nonempty string | Assign to a named slot on the destination workspace and current monitor |
| `place` | preset string or `{ "x", "y", "width", "height" }` | Position and resize within the monitor work area |
| `opacity` | `0.0` – `1.0` | Compositor opacity |
| `focus` | `true` | Activate the window after all other actions, switching to its workspace (overrides the previous-workspace restore of `move_to_workspace`) |
| `no_focus` | `true` | If the window grabbed focus, hand it back to the previously focused window (for overlay windows that must not steal focus) |

For tiled windows, layout geometry takes priority over `place` and `maximize`.
Floating, sticky, fullscreen, minimized, transient, and non-resizable windows are
excluded. Excess windows in a fixed preset remain unmanaged and use ordinary rules.

### Place presets

| Preset | Coverage |
|--------|----------|
| `left-half` | Left 50 % |
| `right-half` | Right 50 % |
| `top-half` | Top 50 % |
| `bottom-half` | Bottom 50 % |
| `top-left` | Top-left quarter |
| `top-right` | Top-right quarter |
| `bottom-left` | Bottom-left quarter |
| `bottom-right` | Bottom-right quarter |
| `center` | Centred 80 % × 80 % |
| `left-third` | Left third |
| `center-third` | Centre third |
| `right-third` | Right third |

For precise placement use fractions of the monitor work area:

```json
{ "x": 0.0, "y": 0.0, "width": 0.333, "height": 1.0 }
```

### Priority and merging

- Rules are sorted by `priority` ascending; array index is the default.
- All matching rules are **merged** in order — later rules win on conflicts.
- Add `"stop": true` to halt processing after a match.

### Examples

```json
{
  "rules": [
    {
      "comment": "Send Slack to workspace 3",
      "match":   { "wm_class": "Slack" },
      "actions": { "move_to_workspace": 3 }
    },
    {
      "comment": "Maximise Firefox on workspace 1",
      "match":   { "wm_class": "firefox", "workspace": 1 },
      "actions": { "maximize": true }
    },
    {
      "comment": "Sticky Picture-in-Picture, bottom-right, slightly transparent",
      "match":   { "wm_title": { "regex": "Picture.in.Picture", "flags": "i" } },
      "actions": { "sticky": true, "place": "bottom-right", "opacity": 0.85 }
    },
    {
      "comment": "Move any dialog to the primary monitor",
      "match":   { "window_type": "dialog" },
      "actions": { "move_to_monitor": "primary" }
    }
  ]
}
```
