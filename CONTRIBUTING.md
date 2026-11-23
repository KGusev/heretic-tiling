# Contributing

Keep changes focused and document changes to shortcuts, configuration, and visible
behavior in the README or the relevant guide in `docs/`.

Commit source files, not Python bytecode or compiled GSettings schemas. Compile
schemas locally when installing or testing the extension.

Run the checks below for relevant code changes. Use the real-Shell smoke tests for
changes that need compositor validation. Report which GNOME version and session
type you tested; declared compatibility does not imply runtime verification.

Keep user-facing instructions in the README and `docs/`, test instructions here,
and implementation status in [requirements.md](requirements.md). Update status
claims when behavior changes, and keep planned features clearly marked.

## Local development

Run `make dev` to compile schemas and symlink the checkout into your GNOME Shell
extensions directory. Reload your GNOME session after code changes; run `make dev`
again after schema changes. Use `make install` to switch back to a copied installation.
Both commands replace the existing installation of this extension.

## Formatting

`make style` formats extension JavaScript, JSON, CSS, JavaScript tests, and Python
helpers/tests in place using Prettier and Ruff. Configuration lives in
`.prettierrc.json` and `ruff.toml`. It preserves the project's four-space indentation
and preference for single quotes. Markdown, XML, and the Makefile are not formatted.

Install the tools locally and run:

```sh
npm install --no-save --package-lock=false prettier@3.4.2
python3 -m venv .venv
.venv/bin/pip install ruff==0.9.10
make style PRETTIER=./node_modules/.bin/prettier RUFF=./.venv/bin/ruff
```

With both tools on `PATH`, just run `make style`. The target checks that both tools
exist before modifying files and reports success or failure in color.

## Development and validation

```sh
make test
```

This runs the Node and Python suites, strict schema validation, both native GJS
checks, and GNOME/Kitty smoke tests. Kitty runs in Wayland and X11 with basic,
undecorated, resize, navigation, and workspace-layout scenarios. Failures are
collected across suites and cause a nonzero exit; missing dependencies are failures,
not silent skips. Allow several minutes for the compositor tests.

Requirements include Node.js, Python 3, GLib tools, GJS, GTK4, GNOME Shell, D-Bus,
Kitty, Xephyr, xdotool, a usable headless renderer, and an existing X display for
X11 tests. Set `KITTY=/path/to/kitty` if needed. Native checks require your installed
Mutter directory in `GI_TYPELIB_PATH` and `LD_LIBRARY_PATH`, for example:

```sh
GI_TYPELIB_PATH=/usr/lib/x86_64-linux-gnu/mutter-14 \
LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu/mutter-14 make test
```

Adjust these paths for your GNOME version and distribution. For a narrower run,
use `make test-unit`, `make test-native`, or `make test-smoke`.


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
