import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

test('shipped compiled schema contains every declared setting', () => {
    const directory = fileURLToPath(
        new URL('../heretic-tiling@kgusev-on-github/schemas/', import.meta.url),
    );
    const schema = 'org.gnome.shell.extensions.heretic-tiling';
    const xml = readFileSync(`${directory}${schema}.gschema.xml`, 'utf8');
    const declared = [...xml.matchAll(/<key name="([^"]+)"/g)].map((match) => match[1]).sort();
    const compiled = execFileSync('gsettings', ['--schemadir', directory, 'list-keys', schema], {
        encoding: 'utf8',
        env: {...process.env, GSETTINGS_BACKEND: 'memory'},
    })
        .trim()
        .split('\n')
        .sort();
    assert.deepEqual(compiled, declared, 'Rebuild gschemas.compiled with glib-compile-schemas');
});
