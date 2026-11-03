import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createSignedInUser, ridePayload, constantSamples, PASSWORD, signIn, sendOtp, verifyOtp, Client } from './helpers.js';

describe('GET/PUT /api/me', () => {
    it('returns the user and an empty profile for a new account', async () => {
        const { client, email } = await createSignedInUser();
        const res = await client.json('/api/me');
        expect(res.status).toBe(200);
        expect(res.data.user).toMatchObject({ email, name: 'Test Rider', emailVerified: true });
        expect(res.data.user.id).toBeTruthy();
        expect(res.data.profile).toEqual({ riderName: null, ftp: null, hrConsentAt: null });
        expect(res.data.user.password).toBeUndefined();
    });

    it('updates riderName, ftp and consent independently', async () => {
        const { client } = await createSignedInUser();
        const a = await client.json('/api/me', { method: 'PUT', body: { riderName: '  Alex  ', ftp: 250 } });
        expect(a.status).toBe(200);
        expect(a.data.profile).toMatchObject({ riderName: 'Alex', ftp: 250, hrConsentAt: null });
        const b = await client.json('/api/me', { method: 'PUT', body: { hrConsent: true } });
        expect(b.data.profile.riderName).toBe('Alex');
        expect(b.data.profile.hrConsentAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
        const c = await client.json('/api/me', { method: 'PUT', body: { ftp: 300 } });
        expect(c.data.profile).toMatchObject({ riderName: 'Alex', ftp: 300 });
        expect(c.data.profile.hrConsentAt).toBe(b.data.profile.hrConsentAt);
        expect((await client.json('/api/me')).data.profile).toEqual(c.data.profile);
    });

    it('validates input', async () => {
        const { client } = await createSignedInUser();
        for (const body of [
            { riderName: '' }, { riderName: '   ' }, { riderName: 'x'.repeat(41) }, { riderName: 5 }, { riderName: null },
            { ftp: 49 }, { ftp: 501 }, { ftp: 250.5 }, { ftp: '250' }, { hrConsent: 'yes' }, [1], 'text'
        ]) {
            const res = await client.json('/api/me', { method: 'PUT', body });
            expect(res.status, JSON.stringify(body)).toBe(400);
        }
        expect((await client.json('/api/me', { method: 'PUT', body: { riderName: 'x'.repeat(40), ftp: 500 } })).status).toBe(200);
        expect((await client.json('/api/me', { method: 'PUT', body: { ftp: 50 } })).status).toBe(200);
    });

    it('profiles are per user', async () => {
        const a = await createSignedInUser();
        const b = await createSignedInUser();
        await a.client.json('/api/me', { method: 'PUT', body: { riderName: 'Alice', ftp: 310 } });
        expect((await b.client.json('/api/me')).data.profile.riderName).toBeNull();
    });
});

describe('GET /api/me/export', () => {
    it('downloads user, profile and all rides with samples', async () => {
        const { client, email } = await createSignedInUser({ hrConsent: true });
        await client.json('/api/me', { method: 'PUT', body: { riderName: 'Alex', ftp: 250 } });
        const rides = [];
        for (let i = 0; i < 27; i++) {
            const p = ridePayload({ startedAt: `2026-09-${String(1 + i).padStart(2, '0')}T08:00:00.000Z`, samples: constantSamples(40, 150 + i, 130) });
            rides.push(p);
            expect((await client.json('/api/rides', { method: 'POST', body: p })).status).toBe(201);
        }
        const res = await client.request('/api/me/export');
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="cadence-export.json"');
        const data = JSON.parse(await res.text());
        expect(data.exportedAt).toMatch(/Z$/);
        expect(data.user).toMatchObject({ email, emailVerified: true });
        expect(data.profile).toMatchObject({ riderName: 'Alex', ftp: 250 });
        expect(data.rides).toHaveLength(27); // more than one internal page of 25
        expect(new Set(data.rides.map((r) => r.id)).size).toBe(27);
        expect(data.rides[0].startedAt).toBe('2026-09-27T08:00:00.000Z'); // newest first
        expect(data.rides[0].samples).toHaveLength(40);
        expect(data.user.password).toBeUndefined();
    });

    it('works for an account without rides', async () => {
        const { client } = await createSignedInUser();
        const res = await client.json('/api/me/export');
        expect(res.data.rides).toEqual([]);
    });
});

describe('DELETE /api/me', () => {
    it('needs the password: missing is 400, wrong is 403 and nothing is deleted', async () => {
        const { client, email } = await createSignedInUser();
        expect((await client.json('/api/me', { method: 'DELETE', body: {} })).status).toBe(400);
        const wrong = await client.json('/api/me', { method: 'DELETE', body: { password: 'not the password' } });
        expect(wrong.status).toBe(403);
        expect(wrong.data.error).toBe('forbidden');
        expect((await client.json('/api/me')).status).toBe(200);
        const row = await env.DB.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first();
        expect(row).toBeTruthy();
    });

    it('limits password attempts (5 per 15 minutes)', async () => {
        const { client } = await createSignedInUser();
        const statuses = [];
        for (let i = 0; i < 6; i++) statuses.push((await client.json('/api/me', { method: 'DELETE', body: { password: 'guess number ' + i } })).status);
        expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
        // even the right password is refused while limited
        expect((await client.json('/api/me', { method: 'DELETE', body: { password: PASSWORD } })).status).toBe(429);
    });

    it('deletes user, sessions, account, profile and all rides (cascade); other users are untouched', async () => {
        const doomed = await createSignedInUser({ hrConsent: true });
        const other = await createSignedInUser();
        await doomed.client.json('/api/me', { method: 'PUT', body: { riderName: 'Gone', ftp: 200 } });
        const p1 = ridePayload({ samples: constantSamples(60, 200, 140) });
        const p2 = ridePayload();
        for (const p of [p1, p2]) expect((await doomed.client.json('/api/rides', { method: 'POST', body: p })).status).toBe(201);
        const kept = ridePayload();
        await other.client.json('/api/rides', { method: 'POST', body: kept });
        // a trusted device creates a verification row that points at the user
        await doomed.client.json('/api/auth/sign-out', { method: 'POST', body: {} });
        await signIn(doomed.client, doomed.email);
        const { code } = await sendOtp(doomed.client, doomed.email);
        await verifyOtp(doomed.client, code, true);

        const userId = doomed.user.id;
        const count = async (sql) => (await env.DB.prepare(sql).bind(userId).first()).n;
        expect(await count('SELECT COUNT(*) AS n FROM ride WHERE user_id = ?')).toBe(2);
        expect(await count('SELECT COUNT(*) AS n FROM verification WHERE value = ?')).toBeGreaterThan(0);

        const del = await doomed.client.json('/api/me', { method: 'DELETE', body: { password: PASSWORD } });
        expect(del.status).toBe(200);
        expect(del.headers.get('Set-Cookie')).toMatch(/Max-Age=0/);

        expect(await count('SELECT COUNT(*) AS n FROM "user" WHERE id = ?')).toBe(0);
        expect(await count('SELECT COUNT(*) AS n FROM session WHERE userId = ?')).toBe(0);
        expect(await count('SELECT COUNT(*) AS n FROM account WHERE userId = ?')).toBe(0);
        expect(await count('SELECT COUNT(*) AS n FROM twoFactor WHERE userId = ?')).toBe(0);
        expect(await count('SELECT COUNT(*) AS n FROM profile WHERE user_id = ?')).toBe(0);
        expect(await count('SELECT COUNT(*) AS n FROM ride WHERE user_id = ?')).toBe(0);
        expect(await count('SELECT COUNT(*) AS n FROM verification WHERE value = ?')).toBe(0);
        expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM ride WHERE id IN (?, ?)').bind(p1.id, p2.id).first()).n).toBe(0);

        // the old session is gone and the account cannot sign in again
        expect((await doomed.client.json('/api/me')).status).toBe(401);
        expect((await signIn(new Client(), doomed.email)).status).toBe(401);
        // the other user is untouched
        expect((await other.client.json(`/api/rides/${kept.id}`)).status).toBe(200);
    });

    it('foreign keys are enforced by the database (cascade does not rely on application code)', async () => {
        const row = await env.DB.prepare('PRAGMA foreign_keys').first();
        expect(row.foreign_keys).toBe(1);
        await expect(
            env.DB.prepare("INSERT INTO profile (user_id, rider_name) VALUES ('no-such-user', 'x')").run()
        ).rejects.toThrow();
    });
});
