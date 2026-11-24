/** Versioned, window-free layout preferences. Save only explicit user changes. */
export function weightSnapshot(node) {
    return {
        type: node.type,
        weight: node.weight ?? 1,
        children: (node.children ?? []).map(weightSnapshot),
    };
}

export function restoreWeights(node, saved) {
    const valid = (n, s, depth = 0) =>
        depth <= 64 &&
        s &&
        n.type === s.type &&
        Number.isFinite(s.weight) &&
        s.weight > 0 &&
        Array.isArray(s.children) &&
        s.children.length === (n.children ?? []).length &&
        (n.children ?? []).every((c, i) => valid(c, s.children[i], depth + 1));
    if (!valid(node, saved)) return false;
    const apply = (n, s) => {
        n.weight = s.weight;
        (n.children ?? []).forEach((c, i) => apply(c, s.children[i]));
    };
    apply(node, saved);
    return true;
}

export class LayoutPersistence {
    constructor(settings) {
        this.settings = settings;
        this.data = {version: 1, workspaces: {}};
        try {
            const parsed = JSON.parse(settings.get_string('saved-layouts'));
            if (
                parsed?.version === 1 &&
                parsed.workspaces &&
                typeof parsed.workspaces === 'object' &&
                !Array.isArray(parsed.workspaces)
            )
                this.data = parsed;
        } catch (_) {
            /* Ignore corrupt or unsupported saved state. */
        }
    }
    get enabled() {
        return this.settings.get_boolean('persist-layouts');
    }
    _key(workspace) {
        return workspace.layoutKey ?? String(workspace.index() + 1);
    }
    has(workspace) {
        return Object.hasOwn(this.data.workspaces, this._key(workspace));
    }
    get(workspace, defaults, definitions) {
        if (!this.enabled) return null;
        const entry = this.data.workspaces[this._key(workspace)];
        if (
            !entry ||
            entry.defaults !== defaults ||
            !Object.hasOwn(definitions, entry.preset) ||
            entry.definition !== JSON.stringify(definitions[entry.preset])
        )
            return null;
        return entry;
    }
    save(workspace, defaults, preset, definition, trees) {
        if (!this.enabled) return;
        const key = this._key(workspace);
        const old = this.data.workspaces[key];
        const fingerprint = JSON.stringify(definition);
        const monitors =
            old?.preset === preset && old?.definition === fingerprint && old?.defaults === defaults
                ? {...old.monitors}
                : {};
        for (const [monitor, tree] of trees) monitors[monitor] = weightSnapshot(tree.root);
        this.data.workspaces[key] = {defaults, preset, definition: fingerprint, monitors};
        this.flush();
    }
    copy(workspace, defaults, source, monitor, weights) {
        this.data.workspaces[this._key(workspace)] = {
            defaults,
            preset: source.preset,
            definition: source.definition,
            monitors: weights ? {[monitor]: weights} : {},
        };
        this.flush();
    }
    clear(workspace) {
        delete this.data.workspaces[this._key(workspace)];
        this.flush();
    }
    flush() {
        const value = JSON.stringify(this.data);
        if (value !== this.settings.get_string('saved-layouts'))
            this.settings.set_string('saved-layouts', value);
    }
}
