#!/usr/bin/env python3
"""Run explicitly: python3 tests/gnome-layout-smoke.py.

Requires GNOME Shell, GJS/GTK4, D-Bus and a usable headless renderer.
Copies the extension into a temporary XDG profile and uses a private bus.
Never enables/disables the extension in the caller's desktop session.
A hard timeout keeps regressions from trapping the test compositor.
"""

import os, pathlib, shutil, subprocess, tempfile, signal, sys

root = pathlib.Path(tempfile.mkdtemp(prefix='heretic-freeze-'))
for n in ['data', 'config', 'cache', 'runtime']:
    (root / n).mkdir(mode=0o700)
ext = root / 'data/gnome-shell/extensions/heretic-tiling@kgusev-on-github'
shutil.copytree(
    pathlib.Path(__file__).resolve().parents[1] / 'heretic-tiling@kgusev-on-github', ext
)
client = root / 'client.js'
client.write_text("""import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';
const app=new Gtk.Application({application_id:'org.example.HereticFreezeTest'});
function later(ms,fn){GLib.timeout_add(0,ms,()=>{fn();return false;});}
app.connect('activate',()=>{
 const a=new Gtk.ApplicationWindow({application:app,title:'Freeze A',default_width:300,default_height:200});a.present();
 let b;
 later(2000,()=>{print('CHECK one maximized '+a.is_maximized());b=new Gtk.ApplicationWindow({application:app,title:'Freeze B',default_width:300,default_height:200});b.present();print('CHECK second presented');});
 later(5000,()=>{print('CHECK two '+a.is_maximized()+' '+b.is_maximized()+' sizes '+a.get_width()+' '+b.get_width());print('CHECK two full height '+(a.get_height()>700 && b.get_height()>700));b.close();});
 later(7000,()=>{print('CHECK remaining maximized '+a.is_maximized());a.close();app.quit();});
});app.run([]);
""")
env = {k: os.environ[k] for k in ['HOME', 'USER', 'LOGNAME', 'LANG'] if k in os.environ}
env.update(
    PATH='/usr/bin:/bin',
    XDG_DATA_DIRS='/usr/local/share:/usr/share',
    XDG_DATA_HOME=str(root / 'data'),
    XDG_CONFIG_HOME=str(root / 'config'),
    XDG_CACHE_HOME=str(root / 'cache'),
    XDG_RUNTIME_DIR=str(root / 'runtime'),
    LIBGL_ALWAYS_SOFTWARE='1',
    WAYLAND_DISPLAY='wayland-0',
)
script = """gsettings set org.gnome.shell enabled-extensions "['heretic-tiling@kgusev-on-github']"
gsettings set org.gnome.shell disable-user-extensions false
gsettings --schemadir "$3/schemas" set org.gnome.shell.extensions.heretic-tiling dim-unfocused-windows true
timeout -k 2s 20s gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 --sm-disable &
shell_pid=$!
for attempt in $(seq 1 50); do
    if grep -q 'Extension: enabled' "$2"; then break; fi
    sleep 0.1
done
gjs -m "$1" &
sleep 10
gsettings set org.gnome.shell enabled-extensions "[]"
sleep 0.5
gsettings set org.gnome.shell enabled-extensions "['heretic-tiling@kgusev-on-github']"
sleep 0.5
gsettings set org.gnome.shell enabled-extensions "[]"
wait "$shell_pid"
"""
with (root / 'shell.log').open('w') as out:
    p = subprocess.Popen(
        [
            'dbus-run-session',
            '--',
            'bash',
            '-c',
            script,
            'smoke',
            str(client),
            str(root / 'shell.log'),
            str(ext),
        ],
        env=env,
        stdout=out,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        p.wait(timeout=26)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.wait()
print(root)
log = (root / 'shell.log').read_text()
for line in log.splitlines():
    if any(k in line for k in ['TRACE', 'CHECK', 'HereticTiling', 'JS ERROR', 'CRITICAL']):
        print(line)

required = [
    'CHECK one maximized true',
    'CHECK two false false sizes 640 640',
    'CHECK remaining maximized true',
    'CHECK two full height true',
]
passed = (
    all(line in log for line in required)
    and log.count('Extension: enabled') == 2
    and log.count('Extension: disabled') == 2
    and 'JS ERROR' not in log
    and 'Gjs-CRITICAL' not in log
)
print('PASS: Wayland maximize/tile transitions and lifecycle' if passed else 'FAIL: see shell.log')
sys.exit(0 if passed else 1)
