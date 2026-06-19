/** Pure validation shared by preferences and the runtime config loader. */
export function validateWorkspaceActions(actions, opts = {}) {
    if (actions === undefined) return [];
    if (!Array.isArray(actions)) return ['workspace_actions must be an array'];
    const errors = [];
    const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    actions.forEach((job, index) => {
        const fail = message => errors.push(`workspace_actions[${index}]: ${message}`);
        if (!object(job)) { fail('must be an object'); return; }
        for (const key of Object.keys(job))
            if (!['comment', 'workspace', 'match', 'click', 'delay_ms', 'attempts', 'interval_ms'].includes(key))
                fail(`unknown key ${key}`);
        if ('comment' in job && typeof job.comment !== 'string') fail('comment must be a string');
        const integer = (value, min, max, label) => {
            if (!Number.isInteger(value) || value < min || value > max)
                fail(`${label} must be an integer ${min}..${max}`);
        };
        integer(job.workspace, 1, opts.numWorkspaces ?? 20, 'workspace');
        if (!object(job.match) || !Object.keys(job.match).length) {
            fail('match must contain at least one window identity field');
        } else {
            for (const [key, value] of Object.entries(job.match)) {
                if (!['wm_class', 'wm_class_instance', 'wm_title'].includes(key)) fail(`unknown match key ${key}`);
                if (typeof value !== 'string' || !value.trim()) fail(`match.${key} must be a nonempty exact string`);
            }
        }
        if (!object(job.click)) { fail('click must be an object'); } else {
            for (const key of Object.keys(job.click))
                if (!['anchor', 'x', 'y', 'width', 'height', 'button'].includes(key)) fail(`unknown click key ${key}`);
            const anchored = 'anchor' in job.click;
            if (anchored && !['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(job.click.anchor))
                fail('click.anchor must be top-left, top-right, bottom-left, or bottom-right');
            if (!anchored || 'width' in job.click || 'height' in job.click) {
                integer(job.click.width, 1, 32767, 'click.width');
                integer(job.click.height, 1, 32767, 'click.height');
            }
            if (anchored) {
                const right = ['top-right', 'bottom-right'].includes(job.click.anchor);
                const bottom = ['bottom-left', 'bottom-right'].includes(job.click.anchor);
                integer(job.click.x, right ? -32767 : 0, right ? -1 : 32766, 'click.x');
                integer(job.click.y, bottom ? -32767 : 0, bottom ? -1 : 32766, 'click.y');
            } else {
                integer(job.click.x, 0, (job.click.width ?? 0) - 1, 'click.x');
                integer(job.click.y, 0, (job.click.height ?? 0) - 1, 'click.y');
            }
            if ('button' in job.click) integer(job.click.button, 1, 3, 'click.button');
        }
        if ('delay_ms' in job) integer(job.delay_ms, 0, 5000, 'delay_ms');
        if ('attempts' in job) integer(job.attempts, 1, 10, 'attempts');
        if ('interval_ms' in job) integer(job.interval_ms, 50, 2000, 'interval_ms');
    });
    return errors;
}
