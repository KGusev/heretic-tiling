// Run with the same GJS/Mutter environment as layout-native-rectangle.js.
import Meta from 'gi://Meta';
import {WindowShadows} from '../heretic-tiling@kgusev-on-github/lib/windowShadows.js';
const factory = Meta.ShadowFactory.get_default();
const fields = ['radius', 'top_fade', 'x_offset', 'y_offset', 'opacity'];
const before = [false, true].map(f => fields.map(k => factory.get_params('normal', f)[k]));
const shadows = new WindowShadows();
for (const focused of [false, true]) {
    if (factory.get_params('normal', focused).opacity !== 0) throw new Error('Shadow still visible');
}
shadows.destroy();
for (const [i, focused] of [false, true].entries()) {
    if (fields.some((k, j) => factory.get_params('normal', focused)[k] !== before[i][j]))
        throw new Error('Original parameters not restored');
}
print('PASS: compositor shadows disabled and restored');
