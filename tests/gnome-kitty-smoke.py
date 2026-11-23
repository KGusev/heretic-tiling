#!/usr/bin/env python3
"""Test three real Kitty windows on workspace 4 in an isolated GNOME session (Wayland or nested X11).

Run explicitly with: python3 tests/gnome-kitty-smoke.py [/path/to/kitty]
Only the temporary extension copy contains the frame inspection probe.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import select
import signal
import subprocess
import sys
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('kitty', nargs='?', default=shutil.which('kitty'))
parser.add_argument('--x11', action='store_true', help='Run in an isolated nested Xephyr X11 session')
parser.add_argument('--undecorated', action='store_true', help='Test Kitty without OS decorations')
parser.add_argument('--navigate', action='store_true', help='Test Win+Arrow focus navigation')
parser.add_argument('--resize', action='store_true', help='Test real splitter pointer and keyboard gestures')
parser.add_argument('--workspace-layout', action='store_true', help='Test workspace 70/30 dynamic layout and reset')
args = parser.parse_args()
args.resize = args.resize or args.navigate
if args.x11 and (not shutil.which('Xephyr') or not shutil.which('xdotool') or not os.environ.get('DISPLAY')):
    sys.exit('--x11 requires Xephyr, xdotool, and an existing X display.')
kitty = args.kitty
if not kitty:
    sys.exit('Kitty is required; provide its executable path.')
root = Path(tempfile.mkdtemp(prefix='heretic-kitty-smoke-'))
for name in ['data', 'config', 'cache', 'runtime']:
    (root / name).mkdir(mode=0o700)
extension = root / 'data/gnome-shell/extensions/heretic-tiling@kgusev-on-github'
shutil.copytree(Path(__file__).resolve().parents[1] / 'heretic-tiling@kgusev-on-github', extension)
config_dir = root / 'config/heretic-tiling'
config_dir.mkdir()
(config_dir / 'config.json').write_text(json.dumps({'rules': [{
    'match': {'wm_class': 'org.example.HereticKittySmoke'},
    'actions': {'move_to_workspace': 4},
}]}))
if args.workspace_layout:
    config = json.loads((config_dir / 'config.json').read_text())
    config['workspace_layouts'] = {'4': 'browser-main'}
    config['layouts'] = {'browser-main': {'type': 'hbox', 'children': [
        {'type': 'placeholder', 'name': 'browser', 'weight': 70, 'skipIfEmpty': True},
        {'type': 'vbox', 'weight': 30, 'dynamic': True, 'children': []}]}}
    config['rules'].append({'match': {'wm_title': 'Layout-Kitty-1'}, 'actions': {'layout_placeholder': 'browser'}})
    (config_dir / 'config.json').write_text(json.dumps(config))
entrypoint = extension / 'extension.js'
probe = '''
        this._sources.timeout(1500, () => global.workspace_manager.get_workspace_by_index(3).activate(global.get_current_time()));
        this._sources.timeout(8000, () => {
            const ws = global.workspace_manager.get_workspace_by_index(3);
            const windows = ws.list_windows().filter(w => w.get_wm_class() === 'org.example.HereticKittySmoke');
            const area = ws.get_work_area_for_monitor(Main.layoutManager.primaryIndex);
            const rects = windows.map(w => {
                const r = w.get_frame_rect();
                return {x:r.x, y:r.y, width:r.width, height:r.height};
            });
            const sorted = rects.sort((a,b) => a.x-b.x);
            const valid = sorted.length === 3 && sorted.every(r =>
                Number.isFinite(r.width) && r.width > area.width/4 && r.width < area.width/2 &&
                r.height >= area.height-2 && Math.abs(r.y-area.y) <= 2) &&
                sorted.slice(1).every((r,i) => Math.abs(r.x-(sorted[i].x+sorted[i].width)) <= 2);
            console.log('KITTY-SMOKE ' + (valid ? 'PASS' : 'FAIL') + ' workspace=4 area=' +
                area.width+'x'+area.height+' frames='+JSON.stringify(rects));
        });
'''
if args.resize:
    probe = (Path(__file__).resolve().parent / ('fixtures/navigation.js' if args.navigate else 'fixtures/splitter-drag.js')).read_text()
    if args.x11:
        probe = probe.replace('const seat = Clutter.get_default_backend().get_default_seat();', '''const run = (...args) => GLib.spawn_command_line_sync('xdotool ' + args.join(' '));
    const seat = {create_virtual_device: () => ({
        notify_absolute_motion: (_, x, y) => run('mousemove', Math.round(x), Math.round(y)),
        notify_button: (_, button, state) => run(state === Clutter.ButtonState.PRESSED ? 'mousedown' : 'mouseup', button),
        notify_keyval: (_, symbol, state) => run(state === Clutter.KeyState.PRESSED ? 'keydown' : 'keyup', ({[Clutter.KEY_r]: 'r', [Clutter.KEY_Escape]: 'Escape', [Clutter.KEY_Shift_L]: 'Shift_L', [Clutter.KEY_Super_L]: 'Super_L', [Clutter.KEY_Left]: 'Left', [Clutter.KEY_Right]: 'Right', [Clutter.KEY_Up]: 'Up', [Clutter.KEY_Down]: 'Down'})[symbol]),
    })};''')
    entrypoint.write_text(entrypoint.read_text().replace("import Gio", "import Clutter from 'gi://Clutter';\nimport Gio"))
if args.workspace_layout:
    probe = (Path(__file__).resolve().parent / 'fixtures/workspace-layout.js').read_text()
entrypoint.write_text(entrypoint.read_text().replace("        this._log.info('enabled');", probe + "\n        this._log.info('enabled');"))
env = {k: os.environ[k] for k in ['HOME', 'USER', 'LOGNAME', 'LANG'] if k in os.environ}
env.update(PATH='/usr/bin:/bin', XDG_DATA_DIRS='/usr/local/share:/usr/share',
           XDG_DATA_HOME=str(root / 'data'), XDG_CONFIG_HOME=str(root / 'config'),
           XDG_CACHE_HOME=str(root / 'cache'), XDG_RUNTIME_DIR=str(root / 'runtime'),
           LIBGL_ALWAYS_SOFTWARE='1', WAYLAND_DISPLAY='wayland-0')
script = '''
gsettings set org.gnome.shell enabled-extensions "['heretic-tiling@kgusev-on-github']"
gsettings set org.gnome.shell disable-user-extensions false
timeout -k 2s 18s gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 --sm-disable &
shell_pid=$!
for attempt in $(seq 1 50); do
    if grep -q 'Extension: enabled' "$2"; then break; fi
    sleep 0.1
done
for number in 1 2 3; do
    timeout -k 1s 12s "$1" --config NONE -o linux_display_server=wayland --class org.example.HereticKittySmoke --title "Layout-Kitty-$number" /bin/sh -c 'sleep 11' &
    sleep 1
done
sleep 7
gsettings set org.gnome.shell enabled-extensions "[]"
wait "$shell_pid"
'''
if args.resize or args.workspace_layout:
    script = script.replace('18s gnome-shell', '22s gnome-shell').replace('12s "$1"', '18s "$1"').replace('sleep 11', 'sleep 17').replace('sleep 7', 'sleep 12')
if args.workspace_layout:
    script = script.replace('for number in 1 2 3; do', '''
(sleep 9; timeout -k 1s 8s "$1" --config NONE -o linux_display_server=wayland --class org.example.HereticKittySmoke --title Layout-Kitty-4 /bin/sh -c 'sleep 7') &
for number in 1 2 3; do''')
xephyr = None
if args.x11:
    read_fd, write_fd = os.pipe()
    xephyr_env = dict(env, DISPLAY=os.environ['DISPLAY'])
    if 'XAUTHORITY' in os.environ:
        xephyr_env['XAUTHORITY'] = os.environ['XAUTHORITY']
    xephyr = subprocess.Popen(['Xephyr', '-displayfd', str(write_fd), '-screen', '1280x800', '-ac', '-nolisten', 'tcp'],
                              env=xephyr_env, pass_fds=(write_fd,), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.close(write_fd)
    if not select.select([read_fd], [], [], 10)[0]:
        xephyr.terminate()
        sys.exit('Xephyr did not start')
    with os.fdopen(read_fd) as display_pipe:
        env['DISPLAY'] = ':' + display_pipe.readline().strip()
    env.pop('WAYLAND_DISPLAY')
    script = script.replace('--headless --wayland --no-x11 --virtual-monitor 1280x800', '--x11')
    script = script.replace('linux_display_server=wayland', 'linux_display_server=x11')
if args.workspace_layout:
    script = script.replace('--config NONE', '--config NONE -o confirm_os_window_close=0')
if args.undecorated:
    script = script.replace('--config NONE', '--config NONE -o hide_window_decorations=yes')
log_path = root / 'shell.log'
with log_path.open('w') as output:
    proc = subprocess.Popen(['dbus-run-session', '--', 'bash', '-c', script, 'smoke', kitty, str(log_path)],
                            env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        proc.wait(timeout=28)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
if xephyr:
    xephyr.terminate()
    try:
        xephyr.wait(timeout=5)
    except subprocess.TimeoutExpired:
        xephyr.kill()
        xephyr.wait()
log = log_path.read_text()
print(f'Log: {log_path}')
for line in log.splitlines():
    if any(marker in line for marker in ['WORKSPACE-SMOKE', 'NAVIGATION-SMOKE', 'SPLITTER-SMOKE', 'KITTY-SMOKE', 'HereticTiling', 'JS ERROR', 'CRITICAL']):
        print(line)
markers = ([f'SPLITTER-SMOKE {name} PASS' for name in ['cleared', 'borders', 'hit-target', 'grab', 'preview', 'adjacent', 'shift', 'escape', 'vertical', 'floating']]
           if args.resize else ['KITTY-SMOKE PASS'])
if args.navigate:
    markers = ['NAVIGATION-SMOKE PASS']
if args.workspace_layout:
    markers = [f'WORKSPACE-SMOKE {step} PASS' for step in ['stack', 'resize', 'alone', 'reset']]
passed = all(marker in log for marker in markers) and 'FAIL' not in log and 'JS ERROR' not in log and 'Gjs-CRITICAL' not in log
sys.exit(0 if passed else 1)
