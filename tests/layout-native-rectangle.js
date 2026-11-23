// Run with GJS and the installed Mutter typelib/library paths (see README).
import Mtk from 'gi://Mtk';
import {geometry} from '../heretic-tiling@kgusev-on-github/lib/layouts/model.js';
const area = new Mtk.Rectangle({x: 100, y: 30, width: 1280, height: 770});
for (const type of ['hbox', 'vbox']) {
    const root = {type, children: Array.from({length: 3}, () => ({type: 'placeholder'}))};
    const result = geometry(root, area);
    for (const {rect} of [...result.leaves, ...result.splitters]) {
        if (
            !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(rect[k])) ||
            rect.width <= 0 ||
            rect.height <= 0
        )
            throw new Error(`${type}: invalid rectangle ${JSON.stringify(rect)}`);
        if (type === 'hbox' && (rect.height !== 770 || rect.y !== 30))
            throw new Error('Lost height/y');
        if (type === 'vbox' && (rect.width !== 1280 || rect.x !== 100))
            throw new Error('Lost width/x');
    }
}
print('PASS: real native rectangle preserves both axes');
