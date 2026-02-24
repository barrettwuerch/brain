// Shared Level-1 dataset parsing + computations (CPI)
export function parseCpi(csv) {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    const header = lines.shift();
    if (!header)
        throw new Error('missing header');
    const out = [];
    for (const line of lines) {
        const [date, val] = line.split(',');
        if (!date || !val)
            continue;
        const v = Number(val);
        if (!Number.isFinite(v))
            continue;
        out.push({ date, value: v });
    }
    return out;
}
export function maxRow(rows) {
    return rows.reduce((best, r) => (r.value > best.value ? r : best), rows[0]);
}
export function maxMoM(rows) {
    let best = { date: rows[1].date, delta: rows[1].value - rows[0].value };
    for (let i = 1; i < rows.length; i++) {
        const delta = rows[i].value - rows[i - 1].value;
        if (delta > best.delta)
            best = { date: rows[i].date, delta };
    }
    return best;
}
export function trendLastN(rows, n) {
    const slice = rows.slice(-n);
    const first = slice[0].value;
    const last = slice[slice.length - 1].value;
    const diff = last - first;
    const eps = 1e-9;
    if (diff > eps)
        return 'up';
    if (diff < -eps)
        return 'down';
    return 'flat';
}
export function grade(expected, actual) {
    // Simple exact-match grading for Phase 2.
    // Returns 1 for exact match, else 0. Can be made fuzzy later.
    const e = JSON.stringify(expected);
    const a = JSON.stringify(actual);
    return e === a ? 1 : 0;
}
