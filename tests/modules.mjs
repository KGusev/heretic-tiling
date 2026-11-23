import {readFileSync} from 'node:fs';
import vm from 'node:vm';

export function loader(mocks = {}, globals = {}) {
    const context = vm.createContext({console, TextDecoder, TextEncoder, ...globals});
    const cache = new Map();
    async function load(url) {
        const key = String(url);
        if (cache.has(key)) return cache.get(key);
        const module = new vm.SourceTextModule(readFileSync(url, 'utf8'), {
            context,
            identifier: key,
        });
        cache.set(key, module);
        await module.link(async (specifier, parent) => {
            if (specifier in mocks) {
                const exports = mocks[specifier];
                return new vm.SyntheticModule(
                    Object.keys(exports),
                    function () {
                        for (const [key, value] of Object.entries(exports))
                            this.setExport(key, value);
                    },
                    {context},
                );
            }
            return load(new URL(specifier, parent.identifier));
        });
        return module;
    }
    return async (path) => {
        const module = await load(
            new URL(`../heretic-tiling@kgusev-on-github/${path}`, import.meta.url),
        );
        await module.evaluate();
        return module.namespace;
    };
}
export class Emitter {
    constructor() {
        this.handlers = new Map();
        this.next = 0;
    }
    connect(name, fn) {
        const id = ++this.next;
        this.handlers.set(id, {name, fn});
        return id;
    }
    disconnect(id) {
        this.handlers.delete(id);
    }
    emit(name, ...args) {
        for (const h of [...this.handlers.values()]) if (h.name === name) h.fn(this, ...args);
    }
}
export function scheduler() {
    const tasks = new Map();
    let id = 0;
    const glib = {
        idle_add: (_, fn) => {
            tasks.set(++id, fn);
            return id;
        },
        timeout_add: (_, __, fn) => {
            tasks.set(++id, fn);
            return id;
        },
        source_remove: (id) => tasks.delete(id),
        PRIORITY_DEFAULT: 0,
        PRIORITY_DEFAULT_IDLE: 0,
        SOURCE_REMOVE: false,
    };
    return {
        glib,
        tasks,
        flush() {
            let iterations = 0;
            while (tasks.size) {
                if (++iterations > 100) throw new Error('Unbounded idle/resize loop');
                const pending = [...tasks.values()];
                tasks.clear();
                for (const fn of pending) fn();
            }
        },
    };
}
