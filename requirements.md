# Heretic Tiling — Requirements

This document is the single source of truth for the **Heretic Tiling** GNOME Shell
extension. It consolidates the implemented behaviour (see `README.md`) and the
planned features (see the design plans in `.agents/`).

Each requirement is tagged with a **status**:

- **Implemented** — present and wired into the plugin code.
- **Partial** — present, but some specified behaviour is missing or defective.
- **Unverified** — declared support that has not been validated at runtime.
- **Planned** — designed in `.agents/` but not yet implemented.
- **Proposed** — an idea listed in the README "Todo" section, not yet designed.

Implementation status was reviewed against the repository code on **2026-10-31**.
The Node test suites, strict GSettings schema check, and validation of all
eight bundled rules passed. A real GNOME 46 Wayland headless smoke test verified
startup, one/two/one-window transitions with full-height GTK windows, repeated
enable/disable, and three real Kitty windows on workspace 4 at full work-area height.
**Implemented** does not imply verification on every supported Shell version.
Planned sections describe intended behaviour, not currently available features.

---

## 1. Overview

Heretic Tiling is a GNOME Shell extension that adds i3wm-style workspace
keybindings and a JSON-driven window rule engine. Automatic tiling is implemented; the separate edge-constraint
solver remains planned. The extension declares support
for GNOME Shell **46, 47 and 48** in `metadata.json`.

### 1.1 Goals

- Provide i3wm-style workspace switching and window movement via keybindings.
- Let users declaratively control window placement, sizing, and state through a
  `config.json` rule engine.
- Add automatic tiling of windows into resizable per-workspace layout trees.
- Keep configuration live-reloadable and validated.

### 1.2 Non-goals

- A full Cassowary-style constraint solver (fixed-point iteration is planned instead).
- Replacing GNOME's window manager; the extension works within Mutter's APIs.

---

## 2. Workspaces

### 2.1 Fixed workspaces — **Implemented**

- Dynamic workspaces are disabled; a configurable fixed count is kept.
- Default count is **10**, valid range **2–20**.
- The count takes effect after an extension reload.

### 2.2 Workspace keybindings — **Implemented**

| Shortcut | Action |
|----------|--------|
| `Super+1` … `Super+0` | Switch to workspace 1–10 |
| `Super+Shift+1` … `Super+Shift+0` | Move focused window to workspace 1–10 |

- Workspace 10 is reached with `Super+0`, matching i3wm convention.
- `Super` is the default prefix and is **not** exposed in Preferences. Switch
  shortcuts are stored in GSettings; move shortcuts are assigned in code.
- Only the first `min(configured workspace count, 10)` numbered shortcuts are registered.

### 2.3 Toggle back to previous workspace — **Implemented**

- Make `Super+N` behave like i3wm's `workspace N` toggle:
  - If the current workspace is **not** N, switch to workspace N.
  - If it **is** N, switch back to the workspace left by the last successful `Super+number` switch.
- One history value is shared by all number shortcuts; mouse, scroll, rules,
  and other shortcuts do not update it.
- With no valid previous workspace, targeting the active workspace does nothing.
- History resets on extension reload. Number shortcuts cover workspaces 1–10.
- `Super+Shift+N` (move window to workspace N) stays unchanged.

### 2.4 Scroll to switch workspace — **Implemented**

- Scrolling the mouse wheel over the custom workspace indicator switches to the
  previous/next workspace, wrapping around at the first/last workspace.
- Toggleable in Preferences.

### 2.5 Workspace context menu — **Implemented**

- Right-clicking a workspace button opens a menu with:
  - *Switch to workspace*.
  - *Move all windows here* when eligible (see §2.6).
- *Layout* preset selection is implemented (see §5.10).

### 2.6 Move all windows to workspace — **Implemented**

- Right-clicking a workspace button (the target) opens a menu that includes
  *Move all windows here*.
- The item is shown **only when**:
  - the target workspace is empty (no non-sticky windows), **and**
  - the current active workspace has at least one movable (non-sticky) window,
    **and**
  - the target is not the current workspace.
- Clicking it moves **all** non-sticky windows from the current workspace into
  the target and switches to the target workspace.
- Sticky windows are excluded: they appear on every workspace, so they neither
  occupy the target nor are moved.

### 2.7 Middle-click to move focused window — **Implemented**

- Middle-clicking a workspace button in the custom workspace indicator moves the
  **currently focused window** to that workspace and switches to it.
- This mirrors the `Super+Shift+N` keybinding as a mouse gesture.
- The action is a **no-op** when:
  - there is no focused window,
  - the focused window is sticky (appears on every workspace),
  - the target workspace is the current one.
- Toggleable in Preferences (*Middle-click to move window*).

### 2.8 Indicator appearance — **Implemented**

- A numbered custom workspace indicator can replace the default Activities button.
- The active workspace is highlighted; urgent windows highlight their workspace.
- Empty workspaces can be dimmed; sticky windows do not make a workspace occupied.
- Custom-indicator and empty-workspace highlighting settings take effect on reload.
- Scroll switching and middle-click movement settings update live, with independently owned signal lifetimes.

---

## 3. Window Rules

### 3.1 Configuration file — **Implemented**

- User config lives at `~/.config/heretic-tiling/config.json`, copied from bundled defaults on first enable.
- Directory monitoring supports atomic editor saves. Reloads reapply rules to existing windows and support adding the first title rule live.
- Invalid JSON retains the last configuration. Invalid layout definitions retain the previous catalog while valid rules reload; invalid rules are skipped individually.
- Runtime and Preferences share rule and layout validation. Top-level constraints remain unsupported.

### 3.2 Schema — **Implemented**

`config.json` is a JSON **object** with a `rules` array:

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

### 3.3 Match criteria — **Implemented**

All criteria are optional. An empty (or absent) `match` block matches every window.
However, the action dispatcher processes only NORMAL windows unless a matching
rule explicitly includes `window_type`. `wm_name` is also supported as a legacy
alias for `wm_class_instance`; using both in one rule is rejected.

| Key | Type | Description |
|-----|------|-------------|
| `wm_class` | string or `{ "regex": "…", "flags": "i" }` | Window class — plain string = case-insensitive exact match |
| `wm_class_instance` | string or regex object | Window instance name |
| `wm_title` | string or regex object | Window title; rules reapply after live reload |
| `workspace` | integer (1-based) | Workspace the window is currently on |
| `monitor` | integer (0-based) | Monitor index |
| `primary_monitor` | boolean | `true` if window is on the primary monitor |
| `window_type` | `"normal"` `"dialog"` `"utility"` `"splash"` `"tooltip"` | Window type |
| `is_above` | boolean | `_NET_WM_STATE_ABOVE` flag |

### 3.4 Actions — **Implemented**

| Key | Value | Description |
|-----|-------|-------------|
| `move_to_workspace` | integer (1-based) | Move window to that workspace |
| `move_to_monitor` | integer (0-based) or `"primary"` | Move window to that monitor |
| `maximize` | `true` / `false` | Maximize or unmaximize |
| `minimize` | `true` | Minimize |
| `float` | `true` | Make always-above without cross-workspace sticking |
| `sticky` | `true` / `false` | Stick to all workspaces + always-above / remove sticky |
| `place` | preset string or `{ "x", "y", "width", "height" }` | Position and resize within the monitor work area |
| `opacity` | `0.0` – `1.0` | Compositor opacity |
| `focus` | `true` | Activate the window after all other actions, switching to its workspace (overrides the previous-workspace restore of `move_to_workspace`) |
| `no_focus` | `true` | If the window grabbed focus, hand it back to the previously focused window (for overlay windows that must not steal focus) |

`layout_placeholder` is an implemented nonempty string action targeting a named slot
on the window's destination workspace/current monitor. Layout geometry takes priority
over `place` and `maximize` for assigned windows. Other windows retain rule geometry.

### 3.5 Place presets — **Implemented**

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

### 3.6 Priority and merging — **Implemented**

- Rules are sorted by `priority` ascending; array index is the default.
- All matching rules are **merged** in order — later rules win on conflicts.
- Add `"stop": true` to halt processing after a match.

---

## 4. Sticky Windows — **Implemented**

- Keep utility windows visible on every workspace, always on top.
- Sticky windows do **not** steal focus after a workspace switch.

---

## 5. Layout System — **Implemented; interactive compatibility unverified**

The implementation supersedes the older drafts in `.agents/plan-layout-system.md`,
`.agents/plan-layout-and-constraints.md`, `.agents/plan-auto-maximize-single-window.md`,
and `.agents/plan-disable-manual-resize.md` (layout and resize portions only; §6 remains planned).

### 5.1 Core model and monitors

Each workspace selects one layout, with independent instances on each monitor.
Windows stay on their current monitor. In GNOME primary-only workspace mode,
secondary-monitor windows remain unmanaged. Monitor topology changes rebuild trees.
Only normal, resizable, non-transient windows are eligible; sticky, above/floating,
minimized, and fullscreen windows are excluded and reevaluated on state changes.

### 5.2 Nodes

- `hbox`: horizontal children; `vbox`: vertical children, nested arbitrarily up to 64 levels.
- `constraint`: placeholder children with finite positive fractional rectangles contained in their parent; overlap allowed, no splitters.
- `placeholder`: optional unique nonempty name and boolean `skipIfEmpty`; permitted as root.
- Child weights are finite positive numbers, default 1. Empty skipped slots and recursively empty containers collapse; other empty slots are dimmed and nonreactive.

### 5.3 Presets and defaults

`layouts` maps names to root definitions in config.json. Preset references are unsupported.
Built-ins `none`, `hbox`, and `vbox` are reserved. Built-in boxes grow/shrink; named
presets retain fixed capacity. `default-layout` defaults to `hbox` and applies on
enable. Workspace selections and splitter weights are optionally persisted through the
`persist-layouts` preference (off by default). Explicit changes save a versioned,
window-free snapshot in `saved-layouts`, keyed by workspace number and display
identity. Restoration waits for a compatible tree shape. Changed configuration
invalidates incompatible snapshots. Layout → Reset layout restores the workspace's
configured default and removes its saved proportions for all monitors.

### 5.4 Assignment

Seed in MRU order with stable sequence tie-breaking; preserve existing assignments.
Fill slots in depth-first order. A named request displaces its occupant to the first
free slot, otherwise leaves it unmanaged. Identical requests are idempotent. Unknown
names log a debug diagnostic and use ordinary assignment. Excess windows remain
unmanaged and refill vacancies deterministically in MRU order.

### 5.5 Rules and reload

Apply movement and exclusion actions before layout assignment. Assigned windows
ignore rule `place`/`maximize`; deferred placement is guarded against newer assignment.
Changed presets preserve assignments by name; unchanged trees retain weights. Removed
or unknown preset selections fall back to `hbox`. Rules reload alongside layouts.

### 5.6 Splitters

No gaps or outer margin. Six-logical-pixel splitter input targets straddle shared
window edges without reserving layout space. A non-reactive one-pixel grey border
marks each shared edge continuously, above splitter highlights and drag previews. Blue highlights clear explicitly
on release/cancellation; synthetic enter events after relayout do not re-enable them. Compositor window shadows are disabled while
the extension is enabled, with previous parameters restored on disable. Hover highlights the splitter and changes
the cursor. Dragging moves a non-interactive highlighted divider preview without
changing window sizes or queuing layout passes. Release commits weights and queues
one layout update; Escape or lifecycle cancellation discards the preview.
Normal drag resizes adjacent children only. Shift at press time resizes
groups on both sides, preserving each group's internal proportions. Clamp motion to
available size hints (32 logical pixel fallback on older Mutter versions). Client
restrictions remain authoritative. Escape cancels; release commits. Workspace,
monitor, overview, session, and lifecycle changes cancel active drags.
Empty-slot visuals stay below application windows. Splitters sit above tiled-window
input/shadow extents and below always-above floating windows, including after native
restacking. Splitters register with Shell chrome input-region tracking for X11
event delivery, without reserving work-area struts; removal unregisters them.
Drags use Shell’s modal grab lifecycle. Escape hides the preview immediately but
retains the grab through button release to avoid disrupting the next X11 drag.
While grabbed, motion/release/Escape are handled on the splitter actor
itself. All widgets hide in overview, lock screen, and fullscreen coverage. Geometry updates use one 16 ms batch across dirty workspaces.
Native work-area rectangles are converted to explicit x/y/width/height records
before splitting; native fields are not enumerable JavaScript properties.
Eligibility uses the stable `resizeable` capability, not `allows_resize()` (which
becomes false when maximized). Unmaximize waits for notifications rather than polling.

### 5.7 Single-window maximize

Box roots with one assigned eligible window truly maximize it independently per
monitor. Adding a second restores tiling; returning to one re-maximizes. Constraint
and placeholder roots retain explicit geometry. Disable releases extension-owned
maximization and leaves final rectangles in place.

### 5.8 Shortcuts

`Super+H` / `Super+V` rebuild the active workspace as equal-weight horizontal/vertical
boxes across its monitors. Shortcut settings are `create-hbox-shortcut` and
`create-vbox-shortcut`; conflicting stock Super+H/V shortcuts are restored on disable.

### 5.9 Preferences

Layout group selects the default from None, Horizontal, Vertical, and valid named
presets. Reopen Preferences to refresh the catalog after editing config.json.

### 5.10 Workspace menu

The Layout submenu lists built-ins and named presets, with a checkmark for the
current selection. Selection updates every monitor instance of the target workspace.

---

## 6. Constraint Engine — **Planned**

None of §6.1–6.6 is implemented. Top-level `constraints` is ignored, including
invalid values; a successful current validation does not validate constraints.

### 6.1 Overview — **Planned**

A declarative layer on top of the layout system that lets users express edge
relationships between windows (e.g. "A.right == B.left") in `config.json`, so that
resizing one window automatically adjusts the other to maintain the constraint.

The constraint engine is **optional** — if no `"constraints"` section exists in
`config.json`, the layout system works standalone.

### 6.2 Constraint model — **Planned**

A constraint is an **edge-equality** between two named placeholders:

```
A.right == B.left
```

Supported edge references:

| Edge | Meaning |
|------|---------|
| `left` | Left x-coordinate of the placeholder's rectangle |
| `right` | Right x-coordinate |
| `top` | Top y-coordinate |
| `bottom` | Bottom y-coordinate |

### 6.3 Config schema — `"constraints"` section — **Planned**

**Unresolved design issue:** the draft below repeats the JSON key `"of"`.
`JSON.parse()` retains only the second value, losing the first placeholder name.
Distinct endpoint fields must be designed before this schema or §6.6 can be
implemented. This example is retained as an unresolved draft, not a usable schema.

Proposed top-level key in `config.json`, separate from `"rules"` and `"layouts"`:

```json
{
  "constraints": [
    { "edge": "right", "of": "left", "equals": "left", "of": "right" },
    { "edge": "bottom", "of": "top", "equals": "top", "of": "bottom" }
  ]
}
```

**Schema:**

- `"constraints"` is an array of constraint objects.
- Each constraint object has:
  - `"edge"`: one of `"left"`, `"right"`, `"top"`, `"bottom"`.
  - `"of"`: the name of the first placeholder.
  - `"equals"`: one of `"left"`, `"right"`, `"top"`, `"bottom"` — the edge of the second placeholder.
  - `"of"` (second): the name of the second placeholder.
- Both placeholders must exist in the active workspace's layout (by name).
- Constraints are **per-workspace**: they apply to the layout of the workspace where
  both named placeholders exist. If a workspace's layout doesn't have both named
  placeholders, the constraint is silently skipped for that workspace.

### 6.4 Resolution algorithm — **Planned**

- After the `LayoutManager` applies geometry, the constraint engine runs a
  **resolution pass**:
  1. Read the current pixel rectangles of all named placeholders.
  2. For each constraint, check if the two edges are equal (within a 1px tolerance).
  3. If not equal, adjust the geometry of the dependent placeholder to satisfy the
     constraint, then re-apply via `move_resize_frame()`.
- Constraints form a graph; a **fixed-point iteration** (default 3 passes) propagates
  chained constraints (e.g. `A.right == B.left` and `B.right == C.left`).
- If constraints conflict (cannot be satisfied), log a warning and keep the last
  computed geometry.
- A full Cassowary-style solver is out of scope for the initial implementation, but
  the architecture isolates the resolution algorithm so it can be swapped in later.

### 6.5 Interaction with splitters and window events — **Planned**

- When a splitter is dragged, the `LayoutManager` updates weights, applies geometry,
  then notifies the `ConstraintEngine` via `onGeometryChanged(workspace)`.
- The constraint engine runs the resolution pass and re-applies geometry if any
  placeholder changed.
- On `window-created` / `window-removed`, `notify::workspace`, and
  `monitors-changed`, the affected workspaces are relayouted and constraint-resolved.

### 6.6 Validation — **Planned**

- `"constraints"` is an array.
- Each entry has `edge`, `of`, `equals`, `of` (second).
- `edge` and `equals` are valid edge names.
- `of` values are non-empty strings.
- Warn (not error) if a referenced placeholder name doesn't exist in any preset — the
  constraint may still be valid for a different layout.

---

## 7. Focus on Kill — **Partial**

The intended behaviour is:

- When a workspace has two or more windows and the user kills the active (focused)
  window, focus moves to the **front-placed** window — the remaining window that is
  topmost in the stacking (z) order.
- Only acts when the killed window was focused; background-window destruction leaves
  focus untouched.
- Only acts when a candidate remains; if the killed window was the last one, Mutter's
  default behaviour applies.
- Sticky and minimized windows are skipped as focus candidates.
- The focus replacement is deferred via an idle callback so Mutter finishes the
  unmanage sequence first.

**Current implementation and limitations:**

- Enabled by default, but toggleable in Preferences through `focus-next-on-close`.
- Existing and new windows are registered and initial focus is captured.
- Close detection uses `unmanaging` before focus is cleared; deferred candidate selection explicitly sorts by stacking order, retains an already-focused topmost survivor, and stays on the original workspace.
- Focus manager owns its signals and pending callbacks independently; toggling it no longer disconnects extension or layout listeners.

Evidence: `lib/focusManager.js`, `extension.js` (`_updateFocusManager`).

---

## 7.1 Focus Guard for Overlay Windows — **Implemented**

- The `no_focus` action performs a deferred focus check each time rules apply.
- It does **not** install a continuous focus listener; later focus grabs without
  another rule application are not intercepted.
- When a matched window grabs focus, the extension hands focus back to the
  **most-recently-used** other NORMAL, non-minimized, non-sticky window on the
  active workspace.
- The refocus is deferred via an idle callback so Mutter finishes the focus
  sequence for the newly created window first.
- It is a **no-op** when the window did not actually take focus (e.g. it was
  created on a background workspace), so it never switches the user away from
  the active workspace.
- Primary use case: Zoom's `annotate_toolbar` overlay, which is created
  full-screen and always-on-top and would otherwise steal focus from the window
  the user is working in.

---

## 8. Manual Move/Resize Snap-back — **Implemented**

Managed windows snap back to computed geometry at `grab-op-end`. A workspace or
monitor change transfers membership before geometry is reapplied. Manual movement
does not reorder or detach slots. Floating, sticky, fullscreen, and other unmanaged
windows retain normal behavior. Extension splitter drags use their own stage grab.

---

## 9. Other Shortcuts — **Implemented**

| Shortcut | Action |
|----------|--------|
| `Super+D` | Toggle app grid / overview |
| `Super+W` | Close focused window |

---

## 10. Ubuntu Dock Auto-disable — **Partial**

- Suppresses the Ubuntu dock while the extension is active.
- On disable, restores membership in `enabled-extensions` if previously enabled.
- **Known defect:** it unconditionally removes the dock from `disabled-extensions`,
  even if the dock was already disabled before this extension started. Exact
  restoration of the previous state is not implemented.

Evidence: `lib/dockManager.js`.

---

## 11. Preferences — **Implemented**

Open via the **Extensions** app or:

```sh
gnome-extensions prefs heretic-tiling@kgusev-on-github
```

| Section | Setting |
|---------|---------|
| Workspaces | Fixed workspace count (2–20), custom indicator, empty-workspace dimming (take effect after reload); scroll switching and middle-click movement toggles |
| Focus | Focus front-placed window on close toggle (see §7 limitations) |
| Rules | Path to `config.json`; **Open** in default editor; **Reload now**; **Validate** |
| Layout | Default layout preset; applies after extension reload |
| Developer | Debug logging toggle |
| Keybindings | Quick-reference card |
| Rule Schema Reference | Inline documentation |

---

## 12. Debug Logging — **Implemented**

- Enable in Preferences or via dconf:
  ```sh
  gsettings set org.gnome.shell.extensions.heretic-tiling debug true
  ```
- Watch the log:
  ```sh
  journalctl -f -o cat /usr/bin/gnome-shell
  ```

---

## 13. Non-functional Requirements

- **Lifecycle safety — Partial:** source/signal tracking and disable cleanup exist.
  Layout and focus managers own independent signals/sources; interactive lifecycle verification remains pending.
- **Validation — Implemented for rules and layouts:** pure-JS schema and validator are shared
  between Preferences and runtime. Constraints are not validated.
- **Compatibility — Unverified:** `metadata.json` declares GNOME Shell 46, 47 and
  48. GNOME 46 Wayland passed the headless transition/lifecycle smoke test;
  interactive drag, multi-monitor, X11, and GNOME 47–48 remain unverified.
- **No monkey-patching — Implemented:** the extension registers/removes keybindings
  through `Main.wm` without overriding its methods.

---

## 14. Status Summary

| Feature | Status |
|---------|--------|
| Fixed workspaces | Implemented |
| Workspace keybindings | Implemented |
| Toggle back to previous workspace | Implemented |
| Scroll to switch workspace | Implemented |
| Workspace context menu | Implemented |
| Move all windows to workspace | Implemented |
| Middle-click to move focused window | Implemented |
| Indicator appearance and toggles | Implemented |
| Window rules matching, actions, merging | Implemented — includes `layout_placeholder` |
| Config reload and title tracking | Implemented — existing windows reapplied on reload |
| Sticky windows | Implemented |
| Layout system (vbox/hbox/constraint) | Implemented |
| Interactive splitters | Implemented; interactive verification pending |
| Single-window auto-maximize | Implemented |
| Layout placeholder action, shortcuts, default and preset selection | Implemented |
| Constraint engine | Planned — draft schema needs correction |
| Focus on kill | Partial — stacking-order selection unverified (§7) |
| Focus guard for overlay windows (`no_focus`) | Implemented |
| Manual move/resize snap-back | Implemented |
| App grid / close shortcuts | Implemented |
| Ubuntu Dock auto-disable | Partial — previous disabled state not preserved |
| Preferences | Implemented |
| Debug logging | Implemented |
| Lifecycle safety | Partial — interactive lifecycle verification pending |
| Shared rule validation | Implemented |
| GNOME Shell 46–48 compatibility | Unverified — declared in metadata |
| No monkey-patching | Implemented |

Directional tiled-window navigation: Super+Left/Right/Up/Down focuses the spatial
neighbour on the active workspace, including across managed monitors. Prefer
overlapping perpendicular spans, then nearest edge and centre; do not wrap.
Unmanaged, minimized, fullscreen, sticky, and always-above windows are excluded.
Native conflicting maximize/unmaximize and tile bindings are saved and restored.

In Resize mode, Super+Shift+Arrow resizes the focused managed tile on a configurable percentage grid (default 5%, Preferences range 1–50%, applied live):
Right/Down grow width/height, Left/Up shrink them. Choose the nearest ancestor
box on that axis and resize against the next sibling (previous for the last child).
Snap the focused child’s share of that box to the next grid multiple in the requested direction, including after a freeform drag. Reuse splitter minimum sizes and clamping. Queue only the affected workspace.
Save and restore conflicting native monitor/workspace movement accelerators.

Modes: Normal by default; Super+R toggles Resize, Escape exits Resize, and any
workspace switch resets to Normal. Show a Resize panel label while active.
Super+Arrow navigates in both modes. In Normal mode Super+Shift+Arrow swaps the
focused window with its spatial neighbour on the same monitor without changing
weights or focus. Escape is registered only during Resize mode. Disable removes
the mode indicator, Escape binding, toggle binding, and workspace listener.
