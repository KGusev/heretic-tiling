# Heretic Tiling

A GNOME Shell extension that adds i3wm-style workspace keybindings and a
JSON-driven window rule engine and automatic workspace layouts. Declares support
for GNOME Shell 46, 47, 48 and 50; see the validation notes below.

---

## Installation

1. Clone or download the repository.
2. Copy the extension to your GNOME Shell extensions folder:
   ```sh
   cp -r heretic-tiling@kgusev-on-github \
       ~/.local/share/gnome-shell/extensions/
   ```
3. Compile the GSettings schema:
   ```sh
   glib-compile-schemas \
       ~/.local/share/gnome-shell/extensions/heretic-tiling@kgusev-on-github/schemas/
   ```
4. Enable the extension:
   ```sh
   gnome-extensions enable heretic-tiling@kgusev-on-github
   ```
   Or use the **Extensions** app / **GNOME Tweaks**.

---

## Features

- **Automatic layouts** — horizontal tiling by default, independently on each monitor;
  nested presets, named slots, draggable splitters, and single-window maximize.

- **Fixed workspaces** — disables dynamic workspaces; keeps a configurable
  fixed count (default 10, range 2–20).
- **i3-style keybindings** — `Super+N` to switch to workspace N or toggle back,
  `Super+Shift+N` to move the focused window there.
- **Window rules** — a `config.json` file lets you automatically place, resize,
  maximize, minimize, float, stick, or change the opacity of any window
  when it opens.
- **Live rule reload** — save `config.json` and rules apply immediately,
  no extension restart needed.
- **Title-aware matching** — rules re-apply whenever a window title changes
  (browsers, terminals, IDEs).
- **Sticky windows** — keep utility windows visible on every workspace,
  always on top, without stealing focus after a workspace switch.
- **Focus guard for overlays** — the `no_focus` action hands focus back to the
  previously focused window when an overlay window (e.g. Zoom's annotation
  toolbar) grabs it.
- **App grid shortcut** — `Super+D` toggles the GNOME app grid.
- **Close shortcut** — `Super+W` closes the focused window.
- **Scroll to switch workspace** — scroll the mouse wheel over the custom
  workspace indicator to switch to the previous/next workspace (toggleable in
  Preferences).
- **Workspace context menu** — right-click a workspace button to open a menu
  with *Switch to workspace*.
- **Ubuntu Dock auto-disable** — suppresses the Ubuntu dock while active;
  restores it on disable.

---

## Keybindings

| Shortcut | Action |
|----------|--------|
| `Super+1` … `Super+0` | Switch to workspace 1–10, or toggle back if already there |
| `Super+Shift+1` … `Super+Shift+0` | Move focused window to workspace 1–10 |
| `Super+D` | Toggle app grid / overview |
| `Super+W` | Close focused window |
| `Super+Left/Right/Up/Down` | Focus the tiled window in that direction |
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


---

## Window Rules

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
| `float` | `true` | Make always-above without cross-workspace sticking |
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

---

## Workspace-entry actions

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
are excluded.

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

---

## Assign workspaces to monitors

Enable **Preferences → Workspaces → Assign workspaces to monitors** and reload
the extension. Each workspace number belongs to one monitor. Right-click a
workspace number and select **Assign to monitor** to move its windows and
saved layout to another display. By default, workspace 2 is assigned to the
first secondary monitor when one is connected.

In this mode, `Super+number` activates the assigned workspace and focuses its
monitor. The other displays keep showing their current workspaces.
`Super+Shift+number` moves the focused window to the selected workspace.
With **Remember layouts and splitter sizes** enabled, the chosen layout and
adjusted split proportions are restored after signing in again.

## Layouts

By default, every workspace starts with a horizontal layout (`hbox`). Right-click its indicator
button and choose **Layout** to select None, Horizontal, Vertical, or a named preset.
The selection applies independently to each monitor, without moving windows between
monitors. With GNOME's primary-only workspace setting, secondary monitors remain
unmanaged. `Super+H` and `Super+V` rebuild equal-weight boxes. By default, selections and splitter
weights last until the extension reloads or a split resets; `default-layout` sets the startup
choice unless overridden by `workspace_layouts`.

Enable **Preferences → Layout → Remember layouts and splitter sizes** to persist
workspace selections and the last explicitly adjusted splitter proportions. Changes
are saved after selecting a layout, committing a splitter drag, or resizing with
the keyboard. Enabling the option saves the current layouts immediately. Turning
it off stops saving and restoring; it leaves the current layout and saved data intact.

Saved proportions are restored after reload or monitor topology changes when the
same tree shape (including dynamic slot count) is available. Windows themselves and
manual window ordering are not saved. Displays are identified by connector and
hardware identity, so monitor index changes do not exchange their sizes. Moving a
display to a different connector creates a new identity; if display identity lookup
is unavailable, the fallback is its position and dimensions. A live transition to
one window still resets its split, while the saved last explicit proportions remain
available for the next reload. Changed preset definitions, global defaults, or
workspace mappings invalidate incompatible saved state.

Right-click a workspace indicator and choose **Layout → Reset layout** to restore
that workspace's configured default and clear its saved proportions on all monitors,
including disconnected displays. Saved state lives in the `saved-layouts` GSettings
key, separately from `config.json`.

Add named presets alongside `rules` in `~/.config/heretic-tiling/config.json`:

```json
{
  "layouts": {
    "code": {
      "type": "hbox",
      "children": [
        { "type": "placeholder", "name": "editor", "weight": 2 },
        { "type": "vbox", "children": [
          { "type": "placeholder", "name": "terminal" },
          { "type": "placeholder", "name": "preview", "skipIfEmpty": true }
        ] }
      ]
    }
  },
  "rules": [
    { "match": { "wm_class": "code" }, "actions": { "layout_placeholder": "editor" } }
  ]
}
```

`hbox` arranges children left to right; `vbox` arranges them top to bottom. Weights
are positive numbers, defaulting to 1. Placeholder names must be unique within a
preset. A placeholder may be the root. The built-in names `none`, `hbox`, and `vbox`
are reserved. Presets cannot reference other presets.

A `constraint` container positions placeholder children using `x`, `y`, `width`,
and `height` fractions within its rectangle. Rectangles must remain inside the
container; overlap is allowed. This is fixed fractional positioning, not an
edge-constraint solver.

Built-in boxes add a slot for each eligible window. Named presets without a dynamic container keep fixed slots;
excess windows remain unmanaged and refill vacancies in MRU order. A named assignment
moves the previous occupant to the first free slot, or leaves it unmanaged if full.
Repeated identical assignments do not displace windows again. Unknown names fall
back to ordinary assignment. Empty slots are dimmed; `skipIfEmpty` collapses them.

To give workspace 1 a browser column occupying 70% of the width, merge these
entries into the existing configuration (keep your other rules):

```json
{
  "workspace_layouts": { "1": "browser-main" },
  "layouts": {
    "browser-main": {
      "type": "hbox",
      "children": [
        { "type": "placeholder", "name": "browser", "weight": 70, "skipIfEmpty": true },
        { "type": "vbox", "weight": 30, "dynamic": true, "children": [] }
      ]
    }
  },
  "rules": [
    {
      "match": { "wm_class": "Yandex-browser", "workspace": 1 },
      "actions": { "layout_placeholder": "browser" }
    }
  ]
}
```

Workspace keys are positive, one-based numbers; values are built-in or named
preset names. Unlisted workspaces use `default-layout`. Each monitor uses its own
tree. A named preset may contain one empty `hbox` or `vbox` with `dynamic: true`:
it automatically adds slots for windows beyond the fixed slots, removes closed
windows, and collapses when empty. In this example, the browser is on the left
regardless of opening order; additional windows stack vertically in the right 30%.
A lone window maximizes. Manual resizing persists while the split exists; returning
to one window restores configured weights for the next split. If several browser
windows match, the latest assignment takes the browser slot and displaces the
previous browser into the secondary column. The rule does not move browsers from
other workspaces. Without a browser, ordinary windows may occupy the primary slot.

Drag a splitter to preview the divider position; release to resize its adjacent pair.
Windows retain their sizes during the drag, avoiding repeated application redraws. Hold Shift **before pressing** to
resize the groups on both sides, retaining their internal proportions. Escape
cancels a drag. Windows meet with no gaps or outer margin. An invisible six-logical-pixel
drag target straddles each shared edge and highlights on hover. A permanent
one-pixel grey line marks each shared edge above the splitter highlight and drag
preview. Blue highlights clear on release or cancellation and return on pointer
motion over an edge. Compositor window shadows are suppressed
while the extension is enabled and restored when it is disabled. GTK/application
shadows and Kitty decorations are controlled by their own user settings. Manual window
move/resize snaps back on release; moving to another workspace or monitor transfers
membership. Splitters do not appear in overview, on the lock screen, or under
fullscreen coverage. Splitters sit above tiled windows’ invisible input margins;
always-above floating windows cover them. Splitters register their input regions
with Shell so X11 delivers clicks to them. Empty-slot visuals remain behind windows.

A box with one assigned window truly maximizes it; a second window restores tiling.
When a built-in horizontal or vertical layout has only one surviving tile, its
weight resets so the next window starts a 50/50 split.
Constraint and placeholder roots retain explicit geometry. Client minimum-size
restrictions may prevent exact tiling; the extension avoids repeated resize loops.

Saving the configuration reloads rules and layouts and reapplies rules to existing
windows. Invalid JSON preserves the last configuration. Invalid layouts preserve
the last valid catalog and workspace mapping while valid rules reload. Invalid
workspace mappings are rejected together with their catalog. Changed presets preserve named
assignments; unchanged presets preserve weights. Removed presets fall back to
Horizontal. Changing a workspace mapping selects its configured preset immediately;
removing a mapping restores the global default. An unchanged mapping preserves
manual preset selections and weights. Reopen Preferences to refresh its preset list after editing the file.
Disabling releases extension-owned maximization and leaves final rectangles in place.

## Development and validation

```sh
node --experimental-vm-modules --test tests/*.test.mjs
python3 tests/window-click.test.py
glib-compile-schemas --strict heretic-tiling@kgusev-on-github/schemas
```

A separate real-Shell regression test runs in a temporary XDG profile/private D-Bus
session (requires GNOME Shell, GTK4/GJS, and headless rendering):

```sh
python3 tests/gnome-layout-smoke.py
python3 tests/gnome-kitty-smoke.py /path/to/kitty
python3 tests/gnome-kitty-smoke.py /path/to/kitty --resize
python3 tests/gnome-kitty-smoke.py /path/to/kitty --resize --x11
```

GNOME 46 Wayland smoke testing verifies startup, one → two → one window transitions,
and repeated enable/disable. The Kitty test checks three windows on workspace 4,
including their frame heights and gaps. Its `--resize` mode sends real pointer and
keyboard events to check normal/Shift dragging, Escape cancellation, vertical
resizing, stacking changes, and floating-window input priority. Add `--x11` to run
in a separate Xephyr server using xdotool (requires an existing X display, Xephyr,
and xdotool). `tests/layout-native-rectangle.js` also tests
real GJS/Mutter boxed rectangles (run with `gjs -m` and your installed Mutter
`GI_TYPELIB_PATH`/`LD_LIBRARY_PATH`). Native work-area fields are copied explicitly;
object spread does not copy them and previously lost window heights.
The freeze regression checks that maximizing a window
does not remove it from tiling: Mutter's `allows_resize()` changes with maximization,
so eligibility uses the stable `resizeable` capability instead. Layout events are
batched with a 16 ms timeout and unmaximize waits for state notifications.

Automated tests cover layout geometry, assignment, splitter calculations, rules,
reloads, lifecycle, and mocked monitor/window events. Interactive mixed-scale,
hotplug, drag, and client-size behavior still requires validation on GNOME 46–48,
with Wayland and X11 where available. The separate edge-constraint solver remains
planned.

---

## License

[MIT](LICENSE)

Directional focus stays on the active workspace, can cross monitors, and prefers
windows aligned with the current tile. Enable **Focus → Center cursor on focused window**
in preferences to move the cursor to the center of the newly focused window on any
focus change (including mouse clicks, Alt+Tab, workspace switches, and newly opened
windows). This option is disabled by default and changes apply immediately.
Directional focus stops at the layout edge without wrapping;
floating windows are excluded. Native Win+Arrow tile/maximize bindings are restored
when the extension is disabled. Test actual keyboard dispatch with
`python3 tests/gnome-kitty-smoke.py /path/to/kitty --navigate` (add `--x11` for X11).

In Resize mode, keyboard resizing adjusts the nearest enclosing box on the requested axis,
using the next sibling or the previous sibling for the last tile. Nested sibling
groups resize together. Minimum sizes match splitter dragging; a lone tile or
a layout with no split on that axis is unchanged. Native monitor/workspace move
shortcuts using Win+Shift+Arrow are restored when the extension is disabled.

Normal is the default mode. A “Resize” panel label appears while Resize mode is
active. Win+R toggles the mode; Escape returns to Normal and is only intercepted
in Resize mode. Changing workspaces resets to Normal. Win+Arrow always navigates.
Normal-mode movement swaps occupied tiles on the same monitor, preserving layout
weights and focus on the moved window; it stops at the edge.

Keyboard resize grid spacing is configurable in Preferences → Layout → Resize grid step (%), from 1% to 50%, and applies immediately. Sizes snap to multiples of the step (for example 45%, 50%, 55%) of the enclosing layout box. Window minimum sizes still apply.
