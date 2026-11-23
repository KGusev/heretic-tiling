# Heretic Tiling

Heretic Tiling adds automatic window tiling, i3-style shortcuts, and configurable
window rules to GNOME Shell. Resize tiles by dragging their borders, switch
workspaces with Super+number, and assign apps to workspaces through a JSON config.

Declares support for **GNOME Shell 46–48**. Runtime smoke testing is documented for
GNOME 46; broader validation is still needed. See [validation notes](CONTRIBUTING.md#development-and-validation).

## Installation

Clone or download this repository, then run from its root:

```sh
make install
```

This requires `make` and `glib-compile-schemas`. It copies the extension into
`${XDG_DATA_HOME:-~/.local/share}/gnome-shell/extensions` and compiles its schemas.
For development, use `make dev` instead: it compiles schemas in the checkout and
symlinks the extension into the same directory. Both commands replace the existing
installation of this extension. Override the destination with `EXTENSIONS_DIR=/path`.

Log out and back in so GNOME Shell discovers the extension, then enable it:

```sh
gnome-extensions enable heretic-tiling@kgusev-on-github
```

## Everyday use

The extension uses ten fixed workspaces by default and tiles windows horizontally
on each managed monitor. A single tiled window maximizes. Right-click a workspace
indicator to change its layout; drag a border between tiles to resize them.

| Shortcut | Action |
|---|---|
| `Super+1` … `Super+0` | Switch to workspace 1–10; press again to toggle back |
| `Super+Shift+1` … `Super+Shift+0` | Move the focused window to workspace 1–10 |
| `Super+Arrow` | Focus the tile in that direction |
| `Super+Shift+Arrow` | Swap tiles; resize instead when Resize mode is active |
| `Super+R` / `Escape` | Toggle Resize mode / leave Resize mode |
| `Super+H` / `Super+V` | Rebuild an equal-width / equal-height layout |
| `Super+Shift+Space` | Toggle floating |
| `Super+Space` | Switch focus between tiled and floating windows |
| `Super+F` | Toggle fullscreen |
| `Super+W` | Close the focused window |
| `Super+D` | Toggle the app grid |
| `Super+I` | Inspect the focused window and its matching rules |

Workspace toggle history follows numbered shortcuts only. See the
[usage guide](docs/usage.md) for details, resize controls, and inspector behavior.

## Configuration

On first launch, the extension copies its defaults to
`~/.config/heretic-tiling/config.json`. Edits reload automatically.

For example, this configuration sends Slack windows to workspace 3:

```json
{
  "rules": [
    {
      "match": { "wm_class": "Slack" },
      "actions": { "move_to_workspace": 3 }
    }
  ]
}
```

To keep your existing rules, add the example rule to their array. Use `Super+I`
to find a window's class and title. Rules can also control floating, placement,
sticky windows, opacity, and focus. Tiled geometry takes priority over rule-based
placement and maximization.

Open preferences through the Extensions app or run:

```sh
gnome-extensions prefs heretic-tiling@kgusev-on-github
```

Preferences include workspace count, default layout, saved splitter sizes,
focus behavior, dimming, and rule validation. Workspace count and default layout
changes require an extension reload.

## Guides

- [Window rules](docs/window-rules.md): matching, actions, priorities, and examples.
- [Layouts](docs/layouts.md): named presets, slots, per-workspace defaults, and saved sizes.
- [Workspace-entry actions](docs/workspace-actions.md): targeted application clicks on X11; skipped on Wayland.
- [Usage and troubleshooting](docs/usage.md): full shortcut reference, preferences, inspector, and logging.
- [Contributing](CONTRIBUTING.md): repository conventions, automated checks, and real-Shell tests.
- [Requirements](requirements.md): implementation status and planned features.

## Troubleshooting

Use **Preferences → Rules → Validate** to check configuration and `Super+I` to
inspect matching rules. Enable debug logging in Preferences, then watch the log:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

Invalid JSON keeps the previous configuration active. Some layout changes and
client minimum-size restrictions need checking in a real GNOME session; see the
[validation notes](CONTRIBUTING.md#development-and-validation).

## License

[MIT](LICENSE)
