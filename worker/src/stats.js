// Ride statistics, computed server-side from the samples (see docs/api.md, "Ride summary").
// Sample format: [elapsedSeconds, power, heartRate, cadence], at most one per second.

const NP_WINDOW = 30;

function mean(values) {
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function positive(samples, index) {
    return samples.map((s) => s[index]).filter((v) => v > 0);
}

/**
 * Normalized power: 4th root of the mean of (30-sample rolling mean of power)^4.
 * Zeros count. Only full windows are used. Returns null below 30 samples.
 */
export function normalizedPower(powers) {
    if (powers.length < NP_WINDOW) return null;
    let windowSum = 0;
    let sumFourth = 0;
    let windows = 0;
    for (let i = 0; i < powers.length; i++) {
        windowSum += powers[i];
        if (i >= NP_WINDOW) windowSum -= powers[i - NP_WINDOW];
        if (i >= NP_WINDOW - 1) {
            sumFourth += (windowSum / NP_WINDOW) ** 4;
            windows++;
        }
    }
    return (sumFourth / windows) ** 0.25;
}

/** TSS = durationS * np * IF / (ftp * 3600) * 100 with IF = np / ftp, one decimal. */
export function trainingStressScore(durationS, np, ftp) {
    if (np == null || !ftp) return null;
    const intensityFactor = np / ftp;
    return Math.round(((durationS * np * intensityFactor) / (ftp * 3600)) * 100 * 10) / 10;
}

/** Summary fields for a validated sample list. NP is rounded first; TSS is computed from the rounded NP. */
export function computeRideStats(samples, ftp) {
    const powers = samples.map((s) => s[1]);
    const power = positive(samples, 1);
    const hr = positive(samples, 2);
    const cadence = positive(samples, 3);
    const durationS = samples[samples.length - 1][0];
    const npRaw = normalizedPower(powers);
    const np = npRaw == null ? null : Math.round(npRaw);
    return {
        durationS,
        avgPower: power.length ? Math.round(mean(power)) : 0,
        maxPower: power.length ? Math.max(...power) : 0,
        avgHr: hr.length ? Math.round(mean(hr)) : null,
        maxHr: hr.length ? Math.max(...hr) : null,
        avgCadence: cadence.length ? Math.round(mean(cadence)) : null,
        workKj: Math.round(powers.reduce((a, b) => a + b, 0) / 1000),
        np,
        tss: trainingStressScore(durationS, np, ftp)
    };
}

// ---- weekly / monthly totals ----

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday 00:00 UTC of the ISO week containing `date`. */
export function isoWeekStart(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const daysSinceMonday = (d.getUTCDay() + 6) % 7;
    return new Date(d.getTime() - daysSinceMonday * DAY_MS);
}

function emptyBucket() {
    return { rides: 0, durationS: 0, workKj: 0, tss: 0 };
}

function add(bucket, row) {
    bucket.rides += 1;
    bucket.durationS += row.duration_s || 0;
    bucket.workKj += row.work_kj || 0;
    bucket.tss += row.tss || 0;
}

function finish(bucket) {
    return { ...bucket, tss: Math.round(bucket.tss * 10) / 10 };
}

export const WEEKS_BACK = 12;

/** Start (ISO string, inclusive) of the 12-week window: the oldest week returned by buildStats. */
export function statsWindowStart(now = new Date()) {
    return new Date(isoWeekStart(now).getTime() - (WEEKS_BACK - 1) * 7 * DAY_MS).toISOString();
}

/**
 * rows: [{started_at, duration_s, work_kj, tss}] of ONE user.
 * Returns {thisWeek, thisMonth, weeks[12 oldest first, including empty weeks]}.
 */
export function buildStats(rows, now = new Date()) {
    const currentWeek = isoWeekStart(now);
    const weekStarts = [];
    for (let i = WEEKS_BACK - 1; i >= 0; i--) weekStarts.push(new Date(currentWeek.getTime() - i * 7 * DAY_MS));
    const weeks = new Map(weekStarts.map((d) => [d.toISOString().slice(0, 10), emptyBucket()]));
    const monthKey = now.toISOString().slice(0, 7);
    const month = emptyBucket();

    for (const row of rows) {
        const started = new Date(row.started_at);
        if (Number.isNaN(started.getTime())) continue;
        const bucket = weeks.get(isoWeekStart(started).toISOString().slice(0, 10));
        if (bucket) add(bucket, row);
        if (started.toISOString().slice(0, 7) === monthKey) add(month, row);
    }

    const weekList = weekStarts.map((d) => {
        const key = d.toISOString().slice(0, 10);
        return { weekStart: key, ...finish(weeks.get(key)) };
    });
    return {
        thisWeek: finish(weeks.get(currentWeek.toISOString().slice(0, 10))),
        thisMonth: finish(month),
        weeks: weekList
    };
}
