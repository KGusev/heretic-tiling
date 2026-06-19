"""Generic, pointer-preserving X11 window click backend."""
import ctypes as C
import sys
import json
import time


class Button(C.Structure):
    _fields_ = [
        ('type', C.c_int), ('serial', C.c_ulong), ('send_event', C.c_int),
        ('display', C.c_void_p), ('window', C.c_ulong), ('root', C.c_ulong),
        ('subwindow', C.c_ulong), ('time', C.c_ulong), ('x', C.c_int),
        ('y', C.c_int), ('x_root', C.c_int), ('y_root', C.c_int),
        ('state', C.c_uint), ('button', C.c_uint), ('same_screen', C.c_int),
    ]


class Event(C.Union):
    _fields_ = [('button', Button), ('pad', C.c_long * 24)]


class X11:
    def __init__(self):
        self.lib = C.CDLL('libX11.so.6')
        declarations = {
            'XOpenDisplay': ([C.c_char_p], C.c_void_p),
            'XDefaultRootWindow': ([C.c_void_p], C.c_ulong),
            'XInternAtom': ([C.c_void_p, C.c_char_p, C.c_int], C.c_ulong),
            'XGetWindowProperty': ([C.c_void_p, C.c_ulong, C.c_ulong,
                C.c_long, C.c_long, C.c_int, C.c_ulong,
                C.POINTER(C.c_ulong), C.POINTER(C.c_int),
                C.POINTER(C.c_ulong), C.POINTER(C.c_ulong),
                C.POINTER(C.c_void_p)], C.c_int),
            'XGetGeometry': ([C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong),
                C.POINTER(C.c_int), C.POINTER(C.c_int),
                C.POINTER(C.c_uint), C.POINTER(C.c_uint),
                C.POINTER(C.c_uint), C.POINTER(C.c_uint)], C.c_int),
            'XSendEvent': ([C.c_void_p, C.c_ulong, C.c_int, C.c_long,
                C.POINTER(Event)], C.c_int),
            'XFree': ([C.c_void_p], C.c_int),
            'XFlush': ([C.c_void_p], C.c_int),
            'XCloseDisplay': ([C.c_void_p], C.c_int),
        }
        for name, (args, result) in declarations.items():
            fn = getattr(self.lib, name)
            fn.argtypes, fn.restype = args, result
        self.display = self.lib.XOpenDisplay(None)
        if not self.display:
            raise RuntimeError('Cannot open X display')
        self.root = self.lib.XDefaultRootWindow(self.display)

    def property(self, window, name):
        atom = self.lib.XInternAtom(self.display, name.encode(), True)
        if not atom:
            return None
        actual, count, remaining = C.c_ulong(), C.c_ulong(), C.c_ulong()
        fmt, data = C.c_int(), C.c_void_p()
        status = self.lib.XGetWindowProperty(self.display, window, atom, 0,
            4096, False, 0, C.byref(actual), C.byref(fmt), C.byref(count),
            C.byref(remaining), C.byref(data))
        try:
            if status or not data or remaining.value:
                return None
            if fmt.value == 8:
                return C.string_at(data, count.value)
            if fmt.value == 32:
                return list(C.cast(data, C.POINTER(C.c_ulong))[:count.value])
            return None
        finally:
            if data:
                self.lib.XFree(data)

    def size(self, window):
        root, x, y = C.c_ulong(), C.c_int(), C.c_int()
        width, height, border, depth = (C.c_uint() for _ in range(4))
        if not self.lib.XGetGeometry(self.display, window, C.byref(root),
                C.byref(x), C.byref(y), C.byref(width), C.byref(height),
                C.byref(border), C.byref(depth)):
            return None
        return width.value, height.value

    def click(self, window, action):
        for kind, mask, state in [(4, 4, 0), (5, 8, 1 << (7 + action.get("button", 1)))]:
            event = Event()
            event.button = Button(type=kind, display=self.display,
                window=window, root=self.root, x=action["x"], y=action["y"],
                button=action.get("button", 1), same_screen=1, state=state)
            if not self.lib.XSendEvent(self.display, window, False, mask,
                    C.byref(event)):
                raise RuntimeError('Could not send window click')
        self.lib.XFlush(self.display)

    def close(self):
        self.lib.XCloseDisplay(self.display)


def matching_windows(x11, match):
    for window in x11.property(x11.root, '_NET_CLIENT_LIST') or []:
        parts = (x11.property(window, 'WM_CLASS') or b'').split(b'\0')
        props = {
            'wm_class_instance': parts[0].decode('utf-8', 'replace'),
            'wm_class': parts[1].decode('utf-8', 'replace') if len(parts) > 1 else '',
            'wm_title': (x11.property(window, '_NET_WM_NAME') or
                         x11.property(window, 'WM_NAME') or b'').decode('utf-8', 'replace'),
        }
        if all(props[key].casefold() == value.casefold() for key, value in match.items()):
            yield window


def resolve_click(click, size):
    """Resolve against the current client size; never clamp an off-window click."""
    if not size:
        return None
    width, height = size
    anchor = click.get('anchor')
    if anchor is None or 'width' in click or 'height' in click:
        if size != (click.get('width'), click.get('height')):
            return None
    x, y = click['x'], click['y']
    if anchor is not None:
        if anchor not in ('top-left', 'top-right', 'bottom-left', 'bottom-right'):
            return None
        if anchor.endswith('right'):
            x += width
        if anchor.startswith('bottom'):
            y += height
    if not (0 <= x < width and 0 <= y < height):
        return None
    return {**click, 'x': x, 'y': y}


def run_action(x11, job, sleep=time.sleep):
    """Snapshot targets after the delay; retries never retarget new windows."""
    workspace = job['workspace'] - 1
    click = job['click']
    sleep(job.get('delay_ms', 0) / 1000)
    targets = None
    for attempt in range(job.get('attempts', 1)):
        if x11.property(x11.root, '_NET_CURRENT_DESKTOP') != [workspace]:
            return
        matches = set(matching_windows(x11, job['match']))
        targets = matches if targets is None else targets & matches
        if not targets:
            return
        for window in sorted(targets):
            resolved = resolve_click(click, x11.size(window))
            if resolved is None:
                continue
            if x11.property(x11.root, '_NET_CURRENT_DESKTOP') != [workspace]:
                return
            x11.click(window, resolved)
        if attempt + 1 < job.get('attempts', 1):
            sleep(job.get('interval_ms', 250) / 1000)


if __name__ == '__main__':
    # Invoked with a validated JSON job by WorkspaceActions, never through a shell.
    job = json.loads(sys.argv[1])
    x11 = X11()
    try:
        run_action(x11, job)
    finally:
        x11.close()
