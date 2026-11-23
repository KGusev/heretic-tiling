import importlib.util
from pathlib import Path
import unittest
import sys

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location(
    'window_click',
    Path(__file__).resolve().parents[1] / 'heretic-tiling@kgusev-on-github/helpers/window-click.py',
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Display:
    root = 1

    def __init__(self):
        self.desktop = [5]
        self.props = {
            (1, '_NET_CLIENT_LIST'): [2, 3],
            (2, 'WM_CLASS'): b'code\0code\0',
            (3, 'WM_CLASS'): b'example\0Example\0',
            (3, '_NET_WM_NAME'): b'Floating panel',
        }
        self.dimensions = (280, 158)
        self.clicks = []
        self.switch_on_size = False

    def property(self, window, name):
        if name == '_NET_CURRENT_DESKTOP':
            return self.desktop
        return self.props.get((window, name))

    def size(self, window):
        if self.switch_on_size:
            self.desktop = [1]
        return self.dimensions

    def click(self, window, action):
        self.last_action = action
        self.clicks.append(window)


JOB = {
    'workspace': 6,
    'match': {'wm_class': 'example', 'wm_title': 'Floating panel'},
    'click': {'x': 260, 'y': 138, 'width': 280, 'height': 158},
    'delay_ms': 200,
    'attempts': 5,
    'interval_ms': 250,
}


class WindowClickTests(unittest.TestCase):
    def test_all_corner_anchors(self):
        for anchor, x, y, expected in [
            ('top-left', 20, 10, (20, 10)),
            ('top-right', -20, 10, (380, 10)),
            ('bottom-left', 20, -10, (20, 290)),
            ('bottom-right', -20, -10, (380, 290)),
        ]:
            resolved = module.resolve_click({'anchor': anchor, 'x': x, 'y': y}, (400, 300))
            self.assertEqual((resolved['x'], resolved['y']), expected)

    def test_anchor_recomputed_after_resize_between_retries(self):
        display = Display()
        click = {'anchor': 'bottom-right', 'x': -20, 'y': -20, 'button': 3}

        def resize(_):
            if display.clicks:
                self.assertEqual((display.last_action['x'], display.last_action['y']), (260, 138))
                display.dimensions = (400, 300)

        module.run_action(display, {**JOB, 'click': click, 'attempts': 2}, resize)
        self.assertEqual(display.clicks, [3, 3])
        self.assertEqual((display.last_action['x'], display.last_action['y']), (380, 280))
        self.assertEqual(display.last_action['button'], 3)
        self.assertEqual(click['x'], -20)

    def test_anchor_size_guards_and_out_of_bounds(self):
        click = {'anchor': 'bottom-right', 'x': -20, 'y': -20}
        for size in [None, (10, 10), (0, 0)]:
            self.assertIsNone(module.resolve_click(click, size))
        self.assertIsNone(module.resolve_click({**click, 'x': 0}, (280, 158)))
        self.assertIsNone(module.resolve_click({**click, 'anchor': 'invalid'}, (280, 158)))
        guarded = {**click, 'width': 280, 'height': 158}
        self.assertIsNotNone(module.resolve_click(guarded, (280, 158)))
        self.assertIsNone(module.resolve_click(guarded, (400, 300)))

    def test_configurable_coordinates_button_and_workspace(self):
        display = Display()
        display.desktop = [2]
        display.dimensions = (100, 70)
        click = {'x': 12, 'y': 25, 'width': 100, 'height': 70, 'button': 3}
        module.run_action(
            display, {**JOB, 'workspace': 3, 'click': click, 'attempts': 1}, lambda _: None
        )
        self.assertEqual(display.clicks, [3])
        self.assertEqual(display.last_action, click)

    def test_retry_does_not_retarget_new_matching_windows(self):
        display = Display()

        def replace(_):
            if display.clicks:
                display.props[(1, '_NET_CLIENT_LIST')] = [4]
                display.props[(4, 'WM_CLASS')] = b'example\0Example\0'
                display.props[(4, '_NET_WM_NAME')] = b'Floating panel'

        module.run_action(display, JOB, replace)
        self.assertEqual(display.clicks, [3])

    def test_retry_until_application_accepts_click_then_stop(self):
        display = Display()
        waits = []

        def settle(delay):
            waits.append(delay)
            # Simulate application ignoring the first click during its transition.
            if len(display.clicks) == 2:
                display.props[(1, '_NET_CLIENT_LIST')] = [2]

        module.run_action(display, JOB, settle)
        self.assertEqual(display.clicks, [3, 3])
        self.assertEqual(waits, [0.2, 0.25, 0.25])

    def test_retries_are_bounded(self):
        display = Display()
        module.run_action(display, JOB, lambda _: None)
        self.assertEqual(len(display.clicks), 5)

    def test_switch_away_cancels_retry(self):
        display = Display()

        def switch_away(_):
            if display.clicks:
                display.desktop = [4]

        module.run_action(display, JOB, switch_away)
        self.assertEqual(display.clicks, [3])

    def test_match_case_insensitive_identity(self):
        display = Display()
        module.run_action(display, {**JOB, 'attempts': 1}, lambda _: None)
        self.assertEqual(display.clicks, [3])

    def test_ignore_other_workspace_or_changed_workspace(self):
        for switched in (False, True):
            display = Display()
            display.switch_on_size = switched
            if not switched:
                display.desktop = [1]
            module.run_action(display, {**JOB, 'attempts': 1}, lambda _: None)
            self.assertEqual(display.clicks, [])

    def test_ignore_other_windows_unknown_sizes_and_missing_properties(self):
        for change in ('title', 'class', 'size', 'missing'):
            display = Display()
            if change == 'title':
                display.props[(3, '_NET_WM_NAME')] = b'Meeting'
            elif change == 'class':
                display.props[(3, 'WM_CLASS')] = b'other\0other\0'
            elif change == 'size':
                display.dimensions = (400, 300)
            else:
                display.props.clear()
            module.run_action(display, {**JOB, 'attempts': 1}, lambda _: None)
            self.assertEqual(display.clicks, [])


if __name__ == '__main__':
    unittest.main()
