/** Choose a spatial neighbour, preferring windows aligned with the source. */
export function directionalNeighbour(source, candidates, direction) {
    if (!['left', 'right', 'up', 'down'].includes(direction)) return null;
    const horizontal = direction === 'left' || direction === 'right';
    const axis = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height';
    const cross = horizontal ? 'y' : 'x', span = horizontal ? 'height' : 'width';
    const sign = direction === 'left' || direction === 'up' ? -1 : 1;
    const centre = source[axis] + source[size] / 2;
    let best = null, bestScore = null;
    for (const candidate of candidates) {
        const r = candidate.rect;
        const distance = sign * (r[axis] + r[size] / 2 - centre);
        if (distance <= 0) continue;
        const overlap = Math.min(source[cross] + source[span], r[cross] + r[span]) -
            Math.max(source[cross], r[cross]);
        const gap = Math.max(0, sign > 0 ? r[axis] - source[axis] - source[size] :
            source[axis] - r[axis] - r[size]);
        const offset = Math.abs(r[cross] + r[span] / 2 - source[cross] - source[span] / 2);
        const score = [overlap > 0 ? 0 : 1, gap, offset, distance];
        const firstDifference = bestScore ? score.findIndex((v, i) => v !== bestScore[i]) : -1;
        if (!bestScore || (firstDifference >= 0 && score[firstDifference] < bestScore[firstDifference])) {
            best = candidate.window;
            bestScore = score;
        }
    }
    return best;
}
