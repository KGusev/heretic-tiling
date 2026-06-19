# Shortcuts, preferences and troubleshooting

[Back to README](../README.md)

## Keybindings

| Shortcut | Action |
|----------|--------|
| `Super+1` … `Super+0` | Switch to workspace 1–10, or toggle back if already there |
| `Super+Shift+1` … `Super+Shift+0` | Move focused window to workspace 1–10 |
| `Super+D` | Toggle app grid / overview |
| `Super+W` | Close focused window |
| `Super+H` / `Super+V` | Rebuild equal-width / equal-height layouts |
| `Super+I` | Inspect the focused window and matching rules |
| `Super+F` | Toggle fullscreen for the focused window |
| `Super+Left/Right/Up/Down` | Focus the tiled window in that direction |
| `Super+Shift+Space` | Toggle floating; restore the previous tile or floating geometry |
| `Super+Space` | Switch focus between tiled and floating windows |
| `Super+R` | Toggle Normal / Resize mode |
| `Escape` in Resize mode | Return to Normal mode |
| `Super+Shift+Arrow` in Normal mode | Swap the focused window with the neighbouring tile |
| `Super+Shift+Left/Right` in Resize mode | Snap width to the next percentage grid point (default 5%) |
| `Super+Shift+Up/Down` in Resize mode | Snap height to the next percentage grid point (default 5%) |

> Workspace 10 is reached with `Super+0`, matching i3wm convention.

Pressing the same shortcut repeatedly toggles between two workspaces: from
workspace 2, `Super+5` produces 2 → 5 → 2 → 5. All number shortcuts share one
previous-workspace value, updated only after a successful `Super+number` switch.
Mouse, scroll, window rules, and other shortcuts do not update it. With no valid
previous workspace, pressing the active workspace's shortcut does nothing.
History resets when the extension reloads. `Super+Shift+N` keeps its existing
window-movement behavior. Number shortcuts cover the first ten workspaces;
additional workspaces remain accessible through the indicator and other navigation.

## Preferences

Open via the **Extensions** app or:

```sh
gnome-extensions prefs heretic-tiling@kgusev-on-github
```

| Section | Setting |
|---------|---------|
| Workspaces | Fixed workspace count (2–20; takes effect after extension reload) |
| Focus | Focus front-placed window on close; center cursor whenever window focus changes (disabled by default; changes apply immediately) |
| Rules | Path to `config.json`; **Open** in default editor; **Reload now**; **Validate** |
| Layout | Default layout: None, Horizontal, Vertical, or a named preset; takes effect after extension reload |
| Developer | Debug logging toggle |
| Keybindings | Quick-reference card |
| Rule Schema Reference | Inline documentation |

---

Enable **Preferences → Focus → Dim unfocused windows** to darken inactive
application windows. **Dimming strength (%)** controls the brightness reduction
(default 20%, range 0–80%). The option is off by default; both settings apply
immediately. Dimming is suspended in overview, preserves window opacity rules,
and is removed when the extension is disabled. Desktop, dock, and popup windows
are excluded. Dimming is also suspended when no window has focus, or when the
focused window is an excluded type or matches `no_focus: true` (for example,
an annotation toolbar). Rule reloads update this behavior immediately.

## Window inspector

Focus a window and press **Win+I** (`Super+I`) to open the Inspector panel indicator.
Its popup shows window identity, workspace (1-based), monitor (0-based), matching
rules in evaluation order, and final merged actions. `stop: true` ends the trace.
The report also identifies tiled windows, whose geometry overrides rule placement.
This is a read-only snapshot of current rule matching, not a history of previously
applied actions. Use **Copy report** to copy it. Clicking outside closes the popup;
the indicator reopens the same snapshot. Press Win+I again or choose **Close inspector**
to remove it, then focus another window and reopen to take a fresh snapshot.
The shortcut is configurable through the `inspect-window-shortcut` GSettings key.

## Debug Logging

Enable in Preferences or via dconf:

```sh
gsettings set org.gnome.shell.extensions.heretic-tiling debug true
```

Watch the log:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```
