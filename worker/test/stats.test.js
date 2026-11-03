import { describe, it, expect } from 'vitest';
import { normalizedPower, trainingStressScore, computeRideStats, isoWeekStart, buildStats } from '../src/stats.js';
import { createSignedInUser, ridePayload, constantSamples } from './helpers.js';

describe('normalized power', () => {
    it('is null below 30 samples', () => {
        expect(normalizedPower(new Array(29).fill(200))).toBeNull();
        expect(normalizedPower(new Array(30).fill(200))).toBe(200);
    });

    it('equals the constant for constant power', () => {
        expect(normalizedPower(new Array(600).fill(250))).toBeCloseTo(250, 9);
    });

    it('weights variability: 30 s at 0 W then 30 s at 400 W', () => {
        // 31 full windows (index 29..59). Window i (i>=29) holds 400 W for max(0, i-29) seconds:
        // mean = 400 * k / 30 for k = 0..30, k = i - 29.
        const powers = [...new Array(30).fill(0), ...new Array(30).fill(400)];
        let sum = 0;
        for (let k = 0; k <= 30; k++) sum += ((400 * k) / 30) ** 4;
        expect(normalizedPower(powers)).toBeCloseTo((sum / 31) ** 0.25, 9);
    });

    it('counts zeros', () => {
        const withZeros = normalizedPower([...new Array(60).fill(300), ...new Array(60).fill(0)]);
        const without = normalizedPower(new Array(60).fill(300));
        expect(withZeros).toBeLessThan(without);
    });

    it('known input: alternating 100 W / 300 W minute blocks', () => {
        const powers = [];
        for (let block = 0; block < 6; block++) for (let s = 0; s < 60; s++) powers.push(block % 2 ? 300 : 100);
        const np = normalizedPower(powers);
        // independent brute-force reference: mean of every full 30-sample window, ^4, mean, 4th root
        let sum = 0;
        let n = 0;
        for (let end = 30; end <= powers.length; end++) {
            const w = powers.slice(end - 30, end).reduce((a, b) => a + b, 0) / 30;
            sum += w ** 4;
            n++;
        }
        expect(np).toBeCloseTo((sum / n) ** 0.25, 9);
        expect(np).toBeGreaterThan(200); // above the 200 W average
    });
});

describe('training stress score', () => {
    it('matches the example in docs/api.md (1 h, NP 205, FTP 250 -> 67.2)', () => {
        expect(trainingStressScore(3600, 205, 250)).toBe(67.2);
    });

    it('is 100 for one hour at FTP', () => {
        expect(trainingStressScore(3600, 250, 250)).toBe(100);
    });

    it('is null without ftp or np', () => {
        expect(trainingStressScore(3600, 205, null)).toBeNull();
        expect(trainingStressScore(3600, null, 250)).toBeNull();
    });
});

describe('computeRideStats', () => {
    it('ignores zeros in averages and reports null when there are no values', () => {
        const samples = [[0, 100, 0, 0], [1, 0, 0, 0], [2, 200, 0, 80], [3, 0, 0, 100]];
        const s = computeRideStats(samples, 250);
        expect(s.avgPower).toBe(150);
        expect(s.maxPower).toBe(200);
        expect(s.avgHr).toBeNull();
        expect(s.maxHr).toBeNull();
        expect(s.avgCadence).toBe(90);
        expect(s.durationS).toBe(3);
        expect(s.workKj).toBe(0); // 300 J
        expect(s.np).toBeNull(); // < 30 samples
        expect(s.tss).toBeNull();
    });

    it('workKj sums the power of the 1-second samples', () => {
        const s = computeRideStats(constantSamples(1000, 250), null);
        expect(s.workKj).toBe(250);
        expect(s.tss).toBeNull(); // no ftp
    });

    it('all-zero power gives 0 averages', () => {
        const s = computeRideStats(constantSamples(40, 0), 250);
        expect(s.avgPower).toBe(0);
        expect(s.np).toBe(0);
        expect(s.tss).toBe(0);
    });
});

describe('weekly and monthly totals (pure)', () => {
    const now = new Date('2026-11-04T12:00:00.000Z'); // a Wednesday

    it('isoWeekStart returns Monday 00:00 UTC', () => {
        expect(isoWeekStart(now).toISOString()).toBe('2026-11-02T00:00:00.000Z');
        expect(isoWeekStart(new Date('2026-11-01T23:59:59.999Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z'); // Sunday
        expect(isoWeekStart(new Date('2026-11-02T00:00:00.000Z')).toISOString()).toBe('2026-11-02T00:00:00.000Z');
    });

    it('returns 12 weeks, oldest first, empty weeks included', () => {
        const stats = buildStats([], now);
        expect(stats.weeks).toHaveLength(12);
        expect(stats.weeks[0].weekStart).toBe('2026-08-17');
        expect(stats.weeks[11].weekStart).toBe('2026-11-02');
        for (const w of stats.weeks) expect(w).toMatchObject({ rides: 0, durationS: 0, workKj: 0, tss: 0 });
        expect(stats.thisWeek).toEqual({ rides: 0, durationS: 0, workKj: 0, tss: 0 });
        expect(stats.thisMonth).toEqual({ rides: 0, durationS: 0, workKj: 0, tss: 0 });
    });

    it('sums rides into their week and month; ignores rides outside the 12 weeks', () => {
        const rows = [
            { started_at: '2026-11-02T06:00:00.000Z', duration_s: 3600, work_kj: 700, tss: 60.04 }, // this week (Mon)
            { started_at: '2026-11-03T06:00:00.000Z', duration_s: 1800, work_kj: 300, tss: 20.06 }, // this week
            { started_at: '2026-11-01T23:00:00.000Z', duration_s: 600, work_kj: 100, tss: null },  // Sunday = last week, still November
            { started_at: '2026-10-31T10:00:00.000Z', duration_s: 900, work_kj: 150, tss: 10 },     // October
            { started_at: '2026-08-17T00:00:00.000Z', duration_s: 100, work_kj: 10, tss: 1 },       // first week of the window
            { started_at: '2026-08-16T23:59:59.000Z', duration_s: 100, work_kj: 10, tss: 1 }        // just before the window
        ];
        const stats = buildStats(rows, now);
        expect(stats.thisWeek).toEqual({ rides: 2, durationS: 5400, workKj: 1000, tss: 80.1 });
        expect(stats.thisMonth).toEqual({ rides: 3, durationS: 6000, workKj: 1100, tss: 80.1 });
        expect(stats.weeks[11]).toEqual({ weekStart: '2026-11-02', rides: 2, durationS: 5400, workKj: 1000, tss: 80.1 });
        expect(stats.weeks[10]).toEqual({ weekStart: '2026-10-26', rides: 2, durationS: 1500, workKj: 250, tss: 10 });
        expect(stats.weeks[0]).toEqual({ weekStart: '2026-08-17', rides: 1, durationS: 100, workKj: 10, tss: 1 });
        expect(stats.weeks.reduce((n, w) => n + w.rides, 0)).toBe(5);
    });

    it('handles week and year boundaries', () => {
        const stats = buildStats([], new Date('2027-01-01T10:00:00.000Z')); // Friday
        expect(stats.weeks[11].weekStart).toBe('2026-12-28');
        expect(stats.weeks[0].weekStart).toBe('2026-10-12');
    });
});

describe('GET /api/stats', () => {
    it('is all zeros with 12 empty weeks for a user without rides', async () => {
        const { client } = await createSignedInUser();
        const res = await client.json('/api/stats');
        expect(res.status).toBe(200);
        expect(res.data.weeks).toHaveLength(12);
        expect(res.data.thisWeek).toEqual({ rides: 0, durationS: 0, workKj: 0, tss: 0 });
        expect(res.data.thisMonth.rides).toBe(0);
    });

    it('counts uploaded rides in the current week, month and the last week bucket', async () => {
        const { client } = await createSignedInUser();
        const now = new Date();
        const iso = (d) => d.toISOString();
        for (const startedAt of [iso(now), iso(new Date(now.getTime() - 15 * 24 * 3600 * 1000))]) {
            await client.json('/api/rides', { method: 'POST', body: ridePayload({ startedAt, samples: constantSamples(120, 200) }) });
        }
        const res = await client.json('/api/stats');
        expect(res.data.thisWeek.rides).toBe(1);
        expect(res.data.thisWeek.durationS).toBe(119);
        expect(res.data.weeks).toHaveLength(12);
        expect(res.data.weeks[11].rides).toBe(1);
        expect(res.data.weeks.reduce((n, w) => n + w.rides, 0)).toBe(2);
        expect(res.data.weeks.filter((w) => w.rides === 0).length).toBe(10);
    });
});
