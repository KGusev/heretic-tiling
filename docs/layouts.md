# Layouts

[Back to README](../README.md)

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
