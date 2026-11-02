import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createSignedInUser, ridePayload, constantSamples, newRideId, Client } from './helpers.js';

const post = (client, body) => client.json('/api/rides', { method: 'POST', body });

describe('authentication', () => {
    it('every rides route needs a session', async () => {
        const anon = new Client();
        const id = newRideId();
        for (const [method, path] of [
            ['GET', '/api/rides'], ['POST', '/api/rides'], ['GET', `/api/rides/${id}`],
            ['DELETE', `/api/rides/${id}`], ['GET', `/api/rides/${id}/tcx`], ['GET', '/api/stats'], ['GET', '/api/me/export']
        ]) {
            const res = await anon.json(path, { method, body: method === 'POST' ? ridePayload() : undefined });
            expect(res.status, `${method} ${path}`).toBe(401);
            expect(res.data.error).toBe('unauthenticated');
        }
    });
});

describe('upload', () => {
    it('stores a ride (201) and computes the statistics on the server', async () => {
        const { client } = await createSignedInUser();
        const payload = ridePayload({
            samples: constantSamples(3600, 200, 0, 90),
            // client-sent statistics are ignored
            avgPower: 9999, np: 1, tss: 1
        });
        const res = await post(client, payload);
        expect(res.status).toBe(201);
        expect(res.data).toMatchObject({
            id: payload.id,
            startedAt: '2026-11-02T07:30:00.000Z',
            durationS: 3599,
            workoutName: 'Test ride',
            ftp: 250,
            avgPower: 200, maxPower: 200,
            avgHr: null, maxHr: null,
            avgCadence: 90,
            workKj: 720,
            np: 200,
            groupSession: false
        });
        // TSS: 3599 s * 200 * (200/250) / (250 * 3600) * 100 = 63.98 -> 64.0
        expect(res.data.tss).toBe(64);
        expect(res.data.createdAt).toMatch(/Z$/);
    });

    it('is idempotent: re-sending the same id returns 200 and changes nothing', async () => {
        const { client } = await createSignedInUser();
        const payload = ridePayload();
        expect((await post(client, payload)).status).toBe(201);
        const again = await post(client, { ...payload, workoutName: 'Changed', samples: constantSamples(120, 999) });
        expect(again.status).toBe(200);
        expect(again.data.workoutName).toBe('Test ride');
        const list = await client.json('/api/rides');
        expect(list.data.rides).toHaveLength(1);
    });

    it('answers 409 when the id belongs to another user, and does not reveal or change it', async () => {
        const a = await createSignedInUser();
        const b = await createSignedInUser();
        const payload = ridePayload();
        expect((await post(a.client, payload)).status).toBe(201);
        const clash = await post(b.client, payload);
        expect(clash.status).toBe(409);
        expect(clash.data.error).toBe('conflict');
        expect(clash.data.workoutName).toBeUndefined();
        const original = await a.client.json(`/api/rides/${payload.id}`);
        expect(original.status).toBe(200);
    });

    it('stores samples gzip-compressed and returns them unchanged', async () => {
        const { client } = await createSignedInUser({ hrConsent: true });
        const samples = Array.from({ length: 300 }, (_, i) => [i, 100 + (i % 50), 120 + (i % 30), 80 + (i % 10)]);
        const payload = ridePayload({ samples });
        await post(client, payload);
        const row = await env.DB.prepare('SELECT samples_gz FROM ride WHERE id = ?').bind(payload.id).first();
        const bytes = row.samples_gz instanceof ArrayBuffer ? new Uint8Array(row.samples_gz) : Uint8Array.from(row.samples_gz);
        expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]); // gzip magic
        expect(bytes.length).toBeLessThan(JSON.stringify(samples).length);
        const detail = await client.json(`/api/rides/${payload.id}`);
        expect(detail.status).toBe(200);
        expect(detail.data.samples).toEqual(samples);
        expect(detail.data.avgHr).toBeGreaterThan(0);
    });

    describe('validation', () => {
        const cases = {
            'id not a UUID v4': { id: 'not-a-uuid' },
            'startedAt not a date': { startedAt: 'yesterday' },
            'startedAt without time zone': { startedAt: '2026-11-02T07:30:00' },
            'workoutName too long': { workoutName: 'x'.repeat(101) },
            'workoutName not a string': { workoutName: 5 },
            'ftp below 50': { ftp: 49 },
            'ftp above 500': { ftp: 501 },
            'ftp not an integer': { ftp: 250.5 },
            'groupSession not a boolean': { groupSession: 'yes' },
            'no samples': { samples: [] },
            'samples not an array': { samples: 'abc' },
            'sample with 3 fields': { samples: [[0, 100, 0]] },
            'power above 3000': { samples: [[0, 3001, 0, 0]] },
            'negative power': { samples: [[0, -1, 0, 0]] },
            'heart rate above 250': { samples: [[0, 100, 251, 0]] },
            'cadence above 250': { samples: [[0, 100, 0, 251]] },
            'fractional elapsed seconds': { samples: [[0.5, 100, 0, 0]] },
            'unsorted samples': { samples: [[5, 100, 0, 0], [3, 100, 0, 0]] },
            'more than one sample per second': { samples: [[1, 100, 0, 0], [1, 100, 0, 0]] },
            'non-numeric value': { samples: [[0, '100', 0, 0]] }
        };
        for (const [name, override] of Object.entries(cases)) {
            it(`rejects: ${name}`, async () => {
                const { client } = await createSignedInUser();
                const res = await post(client, ridePayload(override));
                expect(res.status).toBe(400);
                expect(res.data.error).toBe('invalid_request');
            });
        }

        it('accepts the limits: 43,200 samples, ftp 50 and 500, power 3000, hr 250, cadence 250', async () => {
            const { client } = await createSignedInUser({ hrConsent: true });
            const big = Array.from({ length: 43200 }, (_, i) => [i, 3000, 250, 250]);
            const res = await post(client, ridePayload({ samples: big, ftp: 500 }));
            expect(res.status).toBe(201);
            expect(res.data.durationS).toBe(43199);
            expect((await post(client, ridePayload({ ftp: 50 }))).status).toBe(201);
            expect((await post(client, ridePayload({ workoutName: 'x'.repeat(100) }))).status).toBe(201);
        });

        it('rejects 43,201 samples', async () => {
            const { client } = await createSignedInUser();
            const res = await post(client, ridePayload({ samples: constantSamples(43201) }));
            expect(res.status).toBe(400);
        });

        it('rejects a body above 2 MB with 413 (declared and streamed)', async () => {
            const { client } = await createSignedInUser();
            const huge = JSON.stringify({ ...ridePayload(), pad: 'x'.repeat(2 * 1024 * 1024) });
            const res = await client.json('/api/rides', { method: 'POST', raw: huge, headers: { 'Content-Type': 'application/json' } });
            expect(res.status).toBe(413);
            expect(res.data.error).toBe('payload_too_large');
        });

        it('rejects invalid JSON', async () => {
            const { client } = await createSignedInUser();
            const res = await client.json('/api/rides', { method: 'POST', raw: '{nope', headers: { 'Content-Type': 'application/json' } });
            expect(res.status).toBe(400);
        });
    });

    describe('heart-rate consent', () => {
        it('answers 428 hr_consent_required, stores nothing, then accepts after consent', async () => {
            const { client } = await createSignedInUser();
            const payload = ridePayload({ samples: constantSamples(60, 200, 140) });
            const refused = await post(client, payload);
            expect(refused.status).toBe(428);
            expect(refused.data.error).toBe('hr_consent_required');
            expect((await client.json('/api/rides')).data.rides).toHaveLength(0);

            const consent = await client.json('/api/me', { method: 'PUT', body: { hrConsent: true } });
            expect(consent.data.profile.hrConsentAt).toMatch(/Z$/);
            const accepted = await post(client, payload);
            expect(accepted.status).toBe(201);
            expect(accepted.data.avgHr).toBe(140);
            expect(accepted.data.maxHr).toBe(140);
        });

        it('needs no consent without heart-rate data', async () => {
            const { client } = await createSignedInUser();
            expect((await post(client, ridePayload({ samples: constantSamples(60, 200, 0) }))).status).toBe(201);
        });

        it('withdrawing consent blocks new heart-rate uploads but keeps stored rides', async () => {
            const { client } = await createSignedInUser({ hrConsent: true });
            const stored = ridePayload({ samples: constantSamples(60, 200, 150) });
            expect((await post(client, stored)).status).toBe(201);
            const off = await client.json('/api/me', { method: 'PUT', body: { hrConsent: false } });
            expect(off.data.profile.hrConsentAt).toBeNull();
            expect((await post(client, ridePayload({ samples: constantSamples(60, 200, 150) }))).status).toBe(428);
            expect((await client.json(`/api/rides/${stored.id}`)).status).toBe(200);
            // re-sending the stored ride is still the idempotent 200
            expect((await post(client, stored)).status).toBe(200);
        });
    });
});

describe('list, detail, delete', () => {
    it('lists newest first with an opaque cursor and no overlap or gap across pages', async () => {
        const { client } = await createSignedInUser();
        const ids = [];
        for (let i = 0; i < 7; i++) {
            const day = String(10 + i).padStart(2, '0');
            const p = ridePayload({ startedAt: `2026-10-${day}T08:00:00.000Z`, workoutName: `Ride ${i}` });
            ids.push(p.id);
            expect((await post(client, p)).status).toBe(201);
        }
        // two rides with the identical start time: ordered by id, none skipped at the page boundary
        const t1 = ridePayload({ startedAt: '2026-10-20T08:00:00.000Z' });
        const t2 = ridePayload({ startedAt: '2026-10-20T08:00:00.000Z' });
        await post(client, t1);
        await post(client, t2);
        const all = [t1.id, t2.id, ...ids].length;

        const seen = [];
        let cursor = null;
        let pages = 0;
        do {
            const res = await client.json(`/api/rides?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
            expect(res.status).toBe(200);
            expect(res.data.rides.length).toBeLessThanOrEqual(3);
            seen.push(...res.data.rides.map((r) => r.id));
            cursor = res.data.nextCursor;
            pages++;
            expect(pages).toBeLessThan(10);
        } while (cursor);
        expect(pages).toBe(3);
        expect(seen).toHaveLength(all);
        expect(new Set(seen).size).toBe(all);
        const starts = seen.map((id) => (id === t1.id || id === t2.id ? '2026-10-20T08:00:00.000Z' : null));
        expect(starts.filter(Boolean)).toHaveLength(2);
        // newest first: the two 10-20 rides, then 10-16 ... 10-10
        expect(seen.slice(2)).toEqual([...ids].reverse());
        const first = await client.json('/api/rides?limit=100');
        expect(first.data.nextCursor).toBeNull();
        expect(first.data.rides).toHaveLength(all);
        // summaries carry no samples
        expect(first.data.rides[0].samples).toBeUndefined();
    });

    it('validates limit and cursor', async () => {
        const { client } = await createSignedInUser();
        for (const q of ['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'cursor=!!!', 'cursor=' + btoa('"x"')]) {
            const res = await client.json(`/api/rides?${q}`);
            expect(res.status, q).toBe(400);
        }
        expect((await client.json('/api/rides?limit=100')).status).toBe(200);
        expect((await client.json('/api/rides?limit=1')).status).toBe(200);
    });

    it('returns detail with samples, 404 for unknown ids', async () => {
        const { client } = await createSignedInUser();
        const p = ridePayload();
        await post(client, p);
        const ok = await client.json(`/api/rides/${p.id}`);
        expect(ok.status).toBe(200);
        expect(ok.data.samples).toHaveLength(60);
        expect(ok.data.id).toBe(p.id);
        const missing = await client.json(`/api/rides/${newRideId()}`);
        expect(missing.status).toBe(404);
        expect(missing.data.error).toBe('not_found');
    });

    it('deletes a ride (204) and then answers 404', async () => {
        const { client } = await createSignedInUser();
        const p = ridePayload();
        await post(client, p);
        const del = await client.request(`/api/rides/${p.id}`, { method: 'DELETE' });
        expect(del.status).toBe(204);
        expect(await del.text()).toBe('');
        expect((await client.json(`/api/rides/${p.id}`)).status).toBe(404);
        expect((await client.json(`/api/rides/${p.id}`, { method: 'DELETE' })).status).toBe(404);
        expect((await client.json('/api/rides')).data.rides).toHaveLength(0);
    });

    it('refuses writes without a matching Origin', async () => {
        const { client } = await createSignedInUser();
        const p = ridePayload();
        const foreign = await client.json('/api/rides', { method: 'POST', body: p, origin: 'https://evil.example' });
        expect(foreign.status).toBe(403);
        const none = await client.json('/api/rides', { method: 'POST', body: p, origin: null });
        expect(none.status).toBe(403);
        expect((await client.json('/api/rides')).data.rides).toHaveLength(0);
        // reads are not subject to the check
        expect((await client.json('/api/rides', { origin: 'https://evil.example' })).status).toBe(200);
        // deleting needs it too
        expect((await client.json(`/api/rides/${p.id}`, { method: 'DELETE', origin: 'https://evil.example' })).status).toBe(403);
    });

    it('rejects unsupported methods with 405 and unknown routes with 404', async () => {
        const { client } = await createSignedInUser();
        expect((await client.json('/api/rides', { method: 'PUT', body: {} })).status).toBe(405);
        expect((await client.json(`/api/rides/${newRideId()}`, { method: 'POST', body: {} })).status).toBe(405);
        expect((await client.json('/api/nope')).status).toBe(404);
    });
});

describe('TCX export', () => {
    it('produces the same structure as WorkoutRecorder.exportTCX()', async () => {
        const { client } = await createSignedInUser({ hrConsent: true });
        const samples = [[0, 150, 120, 85], [1, 0, 0, 0], [2, 160, 125, 86]];
        const p = ridePayload({ samples, workoutName: 'Tom & "Jerry" <1>' });
        await post(client, p);
        const res = await client.request(`/api/rides/${p.id}/tcx`);
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/vnd.garmin.tcx+xml');
        expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="cadence-2026-11-02.tcx"');
        const xml = await res.text();
        expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
        expect(xml).toContain('<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">');
        expect(xml).toContain('<Activity Sport="Biking">');
        expect(xml).toContain('<Id>2026-11-02T07:30:00.000Z</Id>');
        expect(xml).toContain('<Lap StartTime="2026-11-02T07:30:00.000Z">');
        expect(xml).toContain('<TotalTimeSeconds>2</TotalTimeSeconds>');
        expect(xml.match(/<Trackpoint>/g)).toHaveLength(3);
        expect(xml).toContain('<Time>2026-11-02T07:30:02.000Z</Time>');
        expect(xml).toContain('<Cadence>85</Cadence>');
        expect(xml.match(/<HeartRateBpm>/g)).toHaveLength(2); // none for the zero sample
        expect(xml.match(/<Watts>/g)).toHaveLength(2);
        expect(xml).toContain('<Watts>160</Watts>');
        expect(xml).toContain('<AvgWatts>155</AvgWatts>');
        expect(xml).toContain('<MaxWatts>160</MaxWatts>');
        expect(xml).toContain('<Notes>Tom &amp; &quot;Jerry&quot; &lt;1&gt;</Notes>');
        expect(xml.trim().endsWith('</TrainingCenterDatabase>')).toBe(true);
    });

    it('404 for unknown ride', async () => {
        const { client } = await createSignedInUser();
        expect((await client.json(`/api/rides/${newRideId()}/tcx`)).status).toBe(404);
    });
});

describe('user isolation', () => {
    it("user B cannot read, export, delete or list user A's rides", async () => {
        const a = await createSignedInUser({ hrConsent: true });
        const b = await createSignedInUser();
        const p = ridePayload({ samples: constantSamples(60, 180, 130) });
        expect((await post(a.client, p)).status).toBe(201);

        expect((await b.client.json(`/api/rides/${p.id}`)).status).toBe(404);
        expect((await b.client.json(`/api/rides/${p.id}/tcx`)).status).toBe(404);
        expect((await b.client.json(`/api/rides/${p.id}`, { method: 'DELETE' })).status).toBe(404);
        expect((await b.client.json('/api/rides')).data.rides).toEqual([]);
        const stats = await b.client.json('/api/stats');
        expect(stats.data.thisWeek.rides + stats.data.thisMonth.rides).toBe(0);
        const exp = await b.client.json('/api/me/export');
        expect(exp.data.rides).toEqual([]);
        expect(exp.text).not.toContain(p.id);

        // A's ride survived B's delete attempt
        expect((await a.client.json(`/api/rides/${p.id}`)).status).toBe(200);
    });
});
