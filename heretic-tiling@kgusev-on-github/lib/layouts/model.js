/** Pure layout model. Coordinates are logical stage pixels; no Shell imports. */
export const BUILTINS = ['none', 'hbox', 'vbox'];
export const GAP = 0;
export const SPLITTER_WIDTH = 6;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateLayouts(layouts = {}) {
    const errors = [];
    if (!object(layouts)) return ['layouts must be an object'];
    for (const [name, root] of Object.entries(layouts)) {
        if (!name.trim() || BUILTINS.includes(name))
            errors.push(`layouts.${name}: reserved or empty name`);
        const names = new Set();
        let dynamicCount = 0;
        const visit = (node, path, depth = 0) => {
            if (depth > 64) {
                errors.push(`${path}: nesting exceeds 64`);
                return;
            }
            if (!object(node)) {
                errors.push(`${path}: must be an object`);
                return;
            }
            const allowed = new Set([
                'type',
                'weight',
                'children',
                'name',
                'skipIfEmpty',
                'x',
                'y',
                'width',
                'height',
                'dynamic',
            ]);
            for (const key of Object.keys(node))
                if (!allowed.has(key)) errors.push(`${path}: unknown key ${key}`);
            if ('dynamic' in node) {
                if (
                    node.dynamic !== true ||
                    !['hbox', 'vbox'].includes(node.type) ||
                    !Array.isArray(node.children) ||
                    node.children.length
                )
                    errors.push(`${path}: dynamic must be true on an empty hbox or vbox`);
                if (++dynamicCount > 1)
                    errors.push(`${path}: only one dynamic container is allowed`);
            }
            if ('weight' in node && (!Number.isFinite(node.weight) || node.weight <= 0))
                errors.push(`${path}: weight must be finite and positive`);
            if (node.type === 'placeholder') {
                if ('name' in node) {
                    if (typeof node.name !== 'string' || !node.name.trim() || names.has(node.name))
                        errors.push(`${path}: placeholder name must be nonempty and unique`);
                    names.add(node.name);
                }
                if ('skipIfEmpty' in node && typeof node.skipIfEmpty !== 'boolean')
                    errors.push(`${path}: skipIfEmpty must be boolean`);
                if ('children' in node) errors.push(`${path}: placeholder cannot have children`);
            } else if (['hbox', 'vbox', 'constraint'].includes(node.type)) {
                if (!Array.isArray(node.children)) {
                    errors.push(`${path}: children must be an array`);
                    return;
                }
                node.children.forEach((child, i) => {
                    const childPath = `${path}.children[${i}]`;
                    visit(child, childPath, depth + 1);
                    if (node.type === 'constraint') {
                        if (child?.type !== 'placeholder')
                            errors.push(`${childPath}: constraint children must be placeholders`);
                        if (
                            !['x', 'y', 'width', 'height'].every((k) =>
                                Number.isFinite(child?.[k]),
                            ) ||
                            child.x < 0 ||
                            child.y < 0 ||
                            child.width <= 0 ||
                            child.height <= 0 ||
                            child.x + child.width > 1 ||
                            child.y + child.height > 1
                        )
                            errors.push(
                                `${childPath}: rectangle must be positive and contained in 0..1`,
                            );
                    }
                });
            } else errors.push(`${path}: unknown node type`);
        };
        visit(root, `layouts.${name}`);
    }
    return errors;
}

/** Workspace numbers in JSON are one-based, including workspaces not yet created. */
export function validateWorkspaceLayouts(mapping = {}, layouts = {}) {
    if (!object(mapping)) return ['workspace_layouts must be an object'];
    return Object.entries(mapping).flatMap(([number, preset]) => {
        if (!/^[1-9]\d*$/.test(number) || !Number.isSafeInteger(Number(number)))
            return [`workspace_layouts.${number}: workspace must be a positive integer`];
        if (
            typeof preset !== 'string' ||
            !(BUILTINS.includes(preset) || Object.hasOwn(layouts ?? {}, preset))
        )
            return [`workspace_layouts.${number}: unknown layout ${preset}`];
        return [];
    });
}

export function slots(node) {
    return node.type === 'placeholder' ? [node] : (node.children ?? []).flatMap(slots);
}
export function visible(node) {
    return node.type === 'placeholder'
        ? Boolean(node.window) || !node.skipIfEmpty
        : node.children.some(visible);
}

export class LayoutTree {
    constructor(preset, definition) {
        this.dynamic = preset === 'hbox' || preset === 'vbox';
        this.root = this.dynamic
            ? {type: preset, dynamic: true, children: []}
            : JSON.parse(JSON.stringify(definition));
        this.requests = new Map();
        this.defaults = new Map();
        this.overflow = null;
        const visit = (node) => {
            this.defaults.set(node, node.weight ?? 1);
            if (node.dynamic) this.overflow = node;
            for (const child of node.children ?? []) visit(child);
        };
        visit(this.root);
    }
    has(window) {
        return slots(this.root).some((s) => s.window === window);
    }
    remember(window) {
        const slot = slots(this.root).find((s) => s.window === window);
        return slot
            ? {slot, index: this.overflow?.children.indexOf(slot) ?? -1, weight: slot.weight}
            : null;
    }
    restore(window, bookmark) {
        if (!bookmark) return;
        const current = slots(this.root).find((s) => s.window === window);
        if (!current) return;
        const {slot, index, weight} = bookmark;
        if (index >= 0 && this.overflow) {
            this.overflow.children = this.overflow.children.filter(
                (s) => s !== current && s !== slot,
            );
            delete current.window;
            slot.window = window;
            slot.weight = weight;
            this.overflow.children.splice(Math.min(index, this.overflow.children.length), 0, slot);
        } else if (slots(this.root).includes(slot) && slot !== current) {
            current.window = slot.window;
            slot.window = window;
        }
    }
    reconcile(windows) {
        const eligible = new Set(windows);
        for (const slot of slots(this.root)) if (!eligible.has(slot.window)) delete slot.window;
        for (const window of this.requests.keys())
            if (!eligible.has(window)) this.requests.delete(window);
        if (this.overflow) {
            this.overflow.children = this.overflow.children.filter((s) => s.window);
            if (this.overflow.children.length === 1) this.overflow.children[0].weight = 1;
        }
        // Restore configured ratios when a split disappears, even when closing
        // and opening windows are reconciled in the same batch.
        if (slots(this.root).filter((s) => s.window).length <= 1)
            for (const [node, weight] of this.defaults) node.weight = weight;
        for (const window of windows) {
            if (this.has(window)) continue;
            const free = this._freeSlot();
            if (free) free.window = window;
        }
    }
    _freeSlot() {
        let free = slots(this.root).find((s) => !s.window);
        if (!free && this.overflow) {
            free = {type: 'placeholder', weight: 1};
            this.overflow.children.push(free);
        }
        return free;
    }
    /** Apply only changed explicit requests, preventing two matching apps from fighting. */
    assign(window, name) {
        if (this.requests.get(window) === name) return true;
        this.requests.set(window, name);
        if (!name) return true;
        const all = slots(this.root);
        const target = all.find((s) => s.name === name);
        if (!target) return false;
        const old = all.find((s) => s.window === window);
        if (old === target) return true;
        if (old) delete old.window;
        const displaced = target.window;
        target.window = window;
        if (displaced) {
            const free = this._freeSlot();
            if (free) free.window = displaced;
        }
        if (this.overflow) this.overflow.children = this.overflow.children.filter((s) => s.window);
        return true;
    }
}

/** Geometry includes slot rectangles and splitter descriptors referencing live nodes. */
export function geometry(root, area, gap = GAP) {
    const leaves = [],
        splitters = [];
    const visit = (node, rect) => {
        if (!visible(node)) return;
        if (node.type === 'placeholder') {
            leaves.push({node, rect});
            return;
        }
        const children = node.children.filter(visible);
        if (node.type === 'constraint') {
            for (const child of children) {
                const x = Math.round(rect.x + child.x * rect.width);
                const y = Math.round(rect.y + child.y * rect.height);
                visit(child, {
                    x,
                    y,
                    width: Math.round(rect.x + (child.x + child.width) * rect.width) - x,
                    height: Math.round(rect.y + (child.y + child.height) * rect.height) - y,
                });
            }
            return;
        }
        const horizontal = node.type === 'hbox';
        const axis = horizontal ? 'x' : 'y',
            size = horizontal ? 'width' : 'height';
        const actualGap = Math.min(gap, rect[size] / Math.max(1, children.length - 1));
        const available = Math.max(0, rect[size] - actualGap * (children.length - 1));
        const scale = Math.max(...children.map((c) => c.weight ?? 1));
        const total = children.reduce((n, c) => n + (c.weight ?? 1) / scale, 0);
        let cumulative = 0;
        children.forEach((child, i) => {
            const start = Math.round((cumulative / total) * available + i * actualGap);
            cumulative += (child.weight ?? 1) / scale;
            const end = Math.round((cumulative / total) * available + i * actualGap);
            visit(child, {...rect, [axis]: rect[axis] + start, [size]: end - start});
            if (i < children.length - 1) {
                // Input targets overlap the shared edge; they reserve no window space.
                const thickness = Math.min(SPLITTER_WIDTH, rect[size]);
                const position = Math.max(
                    0,
                    Math.min(rect[size] - thickness, end + actualGap / 2 - thickness / 2),
                );
                splitters.push({
                    node,
                    children,
                    index: i,
                    horizontal,
                    available,
                    rect: {...rect, [axis]: rect[axis] + Math.round(position), [size]: thickness},
                });
            }
        });
    };
    // Mutter supplies a boxed Mtk/Meta.Rectangle: its fields are getters, not
    // enumerable own properties. Spreading it loses the cross-axis dimensions.
    const rect = {x: area.x, y: area.y, width: area.width, height: area.height};
    if (Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0)
        visit(root, rect);
    return {leaves, splitters};
}

/** Split against a press-time snapshot, with per-child minimum lengths. */
export function resizeWeights(weights, index, delta, available, shift, minimums = []) {
    if (available <= 0) return [...weights];
    const total = weights.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total))
        return resizeWeights(
            weights.map((w) => w / Math.max(...weights)),
            index,
            delta,
            available,
            shift,
            minimums,
        );
    const sizes = weights.map((w) => (w / total) * available);
    const left = shift ? sizes.map((_, i) => i).slice(0, index + 1) : [index];
    const right = shift ? sizes.map((_, i) => i).slice(index + 1) : [index + 1];
    const sum = (ids) => ids.reduce((n, i) => n + sizes[i], 0);
    const a = sum(left),
        b = sum(right);
    if (!a || !b) return [...weights];
    const minGroup = (ids) =>
        Math.max(...ids.map((i) => (minimums[i] ?? 32) / sizes[i])) * sum(ids);
    const low = minGroup(left) - a,
        high = b - minGroup(right);
    if (low > high) return [...weights];
    delta = Math.max(low, Math.min(high, delta));
    for (const i of left) sizes[i] *= (a + delta) / a;
    for (const i of right) sizes[i] *= (b - delta) / b;
    return sizes.map((s) => (s / available) * total);
}

export function minimumSize(node, horizontal) {
    if (node.type === 'placeholder') {
        // Older Mutter releases do not expose client size hints to extensions.
        const hints = node.window?.get_min_size?.();
        return Math.max(32, hints?.[horizontal ? 0 : 1] ?? 32);
    }
    const values = node.children.filter(visible).map((c) => minimumSize(c, horizontal));
    if (!values.length) return 32;
    return node.type === (horizontal ? 'hbox' : 'vbox')
        ? values.reduce((a, b) => a + b, 0) + GAP * (values.length - 1)
        : Math.max(...values);
}

/** Resize the nearest enclosing box on the requested axis, preserving focus. */
export function resizeWindow(root, area, window, direction, gridStep = 5) {
    if (!['left', 'right', 'up', 'down'].includes(direction)) return false;
    if (!Number.isFinite(gridStep) || gridStep < 1 || gridStep > 50) return false;
    const horizontal = direction === 'left' || direction === 'right';
    const path = [];
    const locate = (node) => {
        if (node.type === 'placeholder') return node.window === window;
        for (const child of node.children.filter(visible)) {
            if (locate(child)) {
                path.push({node, child});
                return true;
            }
        }
        return false;
    };
    if (!locate(root)) return false;
    const splitters = geometry(root, area).splitters;
    for (const {node, child} of path) {
        if (node.type !== (horizontal ? 'hbox' : 'vbox')) continue;
        const children = node.children.filter(visible);
        if (children.length < 2) continue;
        const childIndex = children.indexOf(child);
        const index = Math.min(childIndex, children.length - 2);
        const splitter = splitters.find((s) => s.node === node && s.index === index);
        if (!splitter) continue;
        const grow = direction === 'right' || direction === 'down';
        const weights = children.map((c) => c.weight ?? 1);
        const scale = Math.max(...weights);
        const total = weights.reduce((sum, weight) => sum + weight / scale, 0);
        const percent = (weights[childIndex] / scale / total) * 100;
        // Snap the focused child's share of its enclosing box to the next grid
        // point. Use weights rather than rounded pixel geometry to avoid drift.
        const position = percent / gridStep;
        const nextPercent =
            (grow ? Math.floor(position + 1e-9) + 1 : Math.ceil(position - 1e-9) - 1) * gridStep;
        const delta =
            ((nextPercent - percent) / 100) * splitter.available * (childIndex === index ? 1 : -1);
        const next = resizeWeights(
            weights,
            index,
            delta,
            splitter.available,
            false,
            children.map((c) => minimumSize(c, horizontal)),
        );
        if (next.every((w, i) => w === weights[i])) return false;
        children.forEach((c, i) => {
            c.weight = next[i];
        });
        return true;
    }
    return false;
}
