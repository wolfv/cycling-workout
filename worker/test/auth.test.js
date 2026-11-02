import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import {
    Client, PASSWORD, ORIGIN, uniqueEmail, signUp, signIn, verifyEmail, sendOtp, verifyOtp, lastEmail, createSignedInUser
} from './helpers.js';

async function registeredAndVerified() {
    const client = new Client();
    const email = uniqueEmail();
    expect((await signUp(client, email)).status).toBe(200);
    const verify = await verifyEmail(client, email);
    expect(verify.status).toBe(302);
    return { client, email };
}

describe('registration', () => {
    it('requires a captcha token', async () => {
        const client = new Client();
        const res = await client.json('/api/auth/sign-up/email', {
            method: 'POST',
            body: { email: uniqueEmail(), password: PASSWORD, name: 'x' }
        });
        expect(res.status).toBe(400);
        expect(res.data.error).toBe('invalid_request');
        expect(res.data.code).toBe('MISSING_RESPONSE');
    });

    it('rejects a captcha token that fails verification', async () => {
        const client = new Client();
        const res = await client.json('/api/auth/sign-up/email', {
            method: 'POST',
            captcha: 'nope',
            body: { email: uniqueEmail(), password: PASSWORD, name: 'x' }
        });
        expect(res.status).toBe(403);
        expect(res.data.error).toBe('forbidden');
    });

    it('enforces a password length of 10 to 128 characters', async () => {
        const client = new Client();
        const short = await signUp(client, uniqueEmail(), 'a'.repeat(9));
        expect(short.status).toBe(400);
        const long = await signUp(client, uniqueEmail(), 'a'.repeat(129));
        expect(long.status).toBe(400);
        const edge = await signUp(client, uniqueEmail(), 'a'.repeat(128));
        expect(edge.status).toBe(200);
    });

    it('sends a verification link and creates no session', async () => {
        const client = new Client();
        const email = uniqueEmail();
        const res = await signUp(client, email);
        expect(res.status).toBe(200);
        expect(res.data.token).toBeNull();
        expect(client.sessionCookie).toBeUndefined();
        const mail = lastEmail(email, 'Verify');
        expect(mail.text).toContain('/api/auth/verify-email?token=');
    });

    it('answers a duplicate sign-up like a new one (no account enumeration)', async () => {
        const { email } = await registeredAndVerified();
        const res = await signUp(new Client(), email);
        expect(res.status).toBe(200);
    });
});

describe('sign-in requires verified e-mail and the second factor', () => {
    it('refuses sign-in before the address is verified', async () => {
        const client = new Client();
        const email = uniqueEmail();
        await signUp(client, email);
        const res = await signIn(client, email);
        expect(res.status).toBe(403);
        expect(res.data.code).toBe('EMAIL_NOT_VERIFIED');
        expect(res.data.error).toBe('forbidden');
        expect(client.sessionCookie).toBeUndefined();
    });

    it('verification link redirects to the callback and does not sign the user in', async () => {
        const client = new Client();
        const email = uniqueEmail();
        await signUp(client, email);
        const res = await verifyEmail(client, email);
        expect(res.status).toBe(302);
        expect(res.headers.get('Location')).toContain('/?verified=1');
        expect(client.sessionCookie).toBeUndefined();
        const session = await client.json('/api/auth/get-session');
        expect(session.data).toBeNull();
    });

    it('every new user has twoFactorEnabled set by the create hook', async () => {
        const { email } = await registeredAndVerified();
        const row = await env.DB.prepare('SELECT twoFactorEnabled FROM "user" WHERE email = ?').bind(email).first();
        expect(row.twoFactorEnabled).toBe(1);
    });

    it('PASSWORD ALONE NEVER YIELDS A SESSION: sign-in returns twoFactorRedirect and no session cookie', async () => {
        const { client, email } = await registeredAndVerified();
        const res = await signIn(client, email);
        expect(res.status).toBe(200);
        expect(res.data.twoFactorRedirect).toBe(true);
        expect(res.data.twoFactorMethods).toEqual(['otp']);
        expect(res.data.token).toBeUndefined();
        expect(res.data.user).toBeUndefined();
        expect(client.sessionCookie).toBeUndefined();
        expect((await client.json('/api/auth/get-session')).data).toBeNull();
        expect((await client.json('/api/me')).status).toBe(401);
        // the credential session Better Auth briefly creates is deleted again by the plugin
        const sessions = await env.DB.prepare('SELECT COUNT(*) AS n FROM session s JOIN "user" u ON u.id = s.userId WHERE u.email = ?').bind(email).first();
        expect(sessions.n).toBe(0);
    });

    it('a wrong password is rejected without a challenge', async () => {
        const { client, email } = await registeredAndVerified();
        const res = await signIn(client, email, 'wrong password!!');
        expect(res.status).toBe(401);
        expect(res.data.error).toBe('unauthenticated');
    });

    it('sends a 6-digit code, rejects a wrong one, accepts the right one exactly once', async () => {
        const { client, email } = await registeredAndVerified();
        await signIn(client, email);
        const { res, code } = await sendOtp(client, email);
        expect(res.status).toBe(200);
        expect(code).toMatch(/^\d{6}$/);

        const wrong = await verifyOtp(client, code === '000000' ? '111111' : '000000');
        expect(wrong.status).toBe(401);
        expect(wrong.data.code).toBe('INVALID_CODE');
        expect(client.sessionCookie).toBeUndefined();

        const right = await verifyOtp(client, code);
        expect(right.status).toBe(200);
        expect(client.sessionCookie).toBeTruthy();
        expect(right.data.user.email).toBe(email);

        const me = await client.json('/api/me');
        expect(me.status).toBe(200);
        expect(me.data.user.email).toBe(email);

        // single use: a second challenge with the same code fails
        const other = new Client();
        await signIn(other, email);
        await sendOtp(other, email);
        const replay = await verifyOtp(other, code);
        expect(replay.status).toBe(401);
    });

    it('invalidates the code after 5 wrong attempts, even if the 6th is correct', async () => {
        const { client, email } = await registeredAndVerified();
        await signIn(client, email);
        const { code } = await sendOtp(client, email);
        const wrong = code === '000000' ? '111111' : '000000';
        for (let i = 0; i < 5; i++) expect((await verifyOtp(client, wrong)).status).toBe(401);
        client.ip = '10.99.99.99'; // the 5/min verify-otp rate limit would answer first; test Better Auth's own attempt cap
        const sixth = await verifyOtp(client, code);
        expect(sixth.status).toBe(400);
        expect(sixth.data.code).toBe('TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE');
        expect(client.sessionCookie).toBeUndefined();
    });

    it('code expires after 10 minutes', async () => {
        const { client, email } = await registeredAndVerified();
        await signIn(client, email);
        const { code } = await sendOtp(client, email);
        const row = await env.DB.prepare("SELECT expiresAt FROM verification WHERE identifier LIKE '2fa-otp-%' ORDER BY createdAt DESC LIMIT 1").first();
        const minutes = (new Date(row.expiresAt).getTime() - Date.now()) / 60000;
        expect(minutes).toBeGreaterThan(9);
        expect(minutes).toBeLessThanOrEqual(10.1);
        expect(code).toMatch(/^\d{6}$/);
    });

    it('trustDevice skips the code on that browser; other browsers still need it', async () => {
        const { client, email } = await registeredAndVerified();
        await signIn(client, email);
        const { code } = await sendOtp(client, email);
        const ok = await verifyOtp(client, code, true);
        expect(ok.status).toBe(200);
        const trustCookie = [...client.cookies.keys()].find((k) => k.includes('trust_device'));
        expect(trustCookie).toBeTruthy();

        await client.json('/api/auth/sign-out', { method: 'POST', body: {} });
        expect(client.sessionCookie).toBeUndefined();

        const again = await signIn(client, email);
        expect(again.data.twoFactorRedirect).toBeUndefined();
        expect(again.data.user.email).toBe(email);
        expect(client.sessionCookie).toBeTruthy();

        const stranger = new Client();
        const res = await signIn(stranger, email);
        expect(res.data.twoFactorRedirect).toBe(true);
    });

    it('second factor cannot be switched off or replaced through the API', async () => {
        const { client } = await createSignedInUser();
        for (const [method, path] of [
            ['POST', '/api/auth/two-factor/disable'],
            ['POST', '/api/auth/two-factor/enable'],
            ['POST', '/api/auth/two-factor/generate-backup-codes'],
            ['POST', '/api/auth/two-factor/verify-backup-code'],
            ['POST', '/api/auth/two-factor/verify-totp'],
            ['POST', '/api/auth/update-user']
        ]) {
            const res = await client.json(path, { method, body: { password: PASSWORD } });
            expect(res.status, path).toBe(404);
        }
    });
});

describe('sessions and password reset', () => {
    it('sign-out ends the session', async () => {
        const { client } = await createSignedInUser();
        expect((await client.json('/api/me')).status).toBe(200);
        expect((await client.json('/api/auth/sign-out', { method: 'POST', body: {} })).status).toBe(200);
        expect((await client.json('/api/me')).status).toBe(401);
    });

    it('revoke-sessions signs out every device', async () => {
        const { client, email } = await createSignedInUser();
        const second = new Client();
        await signIn(second, email);
        const { code } = await sendOtp(second, email);
        await verifyOtp(second, code);
        expect((await second.json('/api/me')).status).toBe(200);
        expect((await client.json('/api/auth/revoke-sessions', { method: 'POST', body: {} })).status).toBe(200);
        expect((await second.json('/api/me')).status).toBe(401);
    });

    it('password reset: needs captcha, mail is sent, token sets a new password, old sessions die', async () => {
        const { client, email } = await createSignedInUser();
        const anon = new Client();

        const noCaptcha = await anon.json('/api/auth/request-password-reset', { method: 'POST', body: { email, redirectTo: '/?reset=1' } });
        expect(noCaptcha.status).toBe(400);

        const unknown = await anon.json('/api/auth/request-password-reset', { method: 'POST', captcha: 'pass', body: { email: uniqueEmail('nobody'), redirectTo: '/?reset=1' } });
        expect(unknown.status).toBe(200);

        const ok = await anon.json('/api/auth/request-password-reset', { method: 'POST', captcha: 'pass', body: { email, redirectTo: '/?reset=1' } });
        expect(ok.status).toBe(200);
        const mail = lastEmail(email, 'Reset');
        const link = new URL(mail.text.match(/https?:\/\/\S+/)[0]);
        const callback = await anon.request(link.pathname + link.search, { origin: null });
        expect(callback.status).toBe(302);
        const token = new URL(callback.headers.get('Location'), ORIGIN).searchParams.get('token');
        expect(token).toBeTruthy();

        const newPassword = 'a brand new password';
        const reset = await anon.json('/api/auth/reset-password', { method: 'POST', body: { newPassword, token } });
        expect(reset.status).toBe(200);

        expect((await client.json('/api/me')).status).toBe(401); // all sessions revoked
        expect((await signIn(new Client(), email, PASSWORD)).status).toBe(401);
        const again = await signIn(new Client(), email, newPassword);
        expect(again.data.twoFactorRedirect).toBe(true); // still needs the second factor
    });
});

describe('rate limits and request hygiene', () => {
    it('limits sign-in to 5 per minute per IP (429, error rate_limited)', async () => {
        const client = new Client();
        const email = uniqueEmail('limit');
        const statuses = [];
        for (let i = 0; i < 6; i++) statuses.push((await signIn(client, email, 'whatever password')).status);
        expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
        expect(statuses[5]).toBe(429);
        const last = await signIn(client, email, 'whatever password');
        expect(last.data.error).toBe('rate_limited');
        // another IP is not affected
        const other = new Client();
        expect((await signIn(other, email, 'whatever password')).status).toBe(401);
    });

    it('limits sign-up to 3 per minute per IP', async () => {
        const client = new Client();
        const statuses = [];
        for (let i = 0; i < 4; i++) statuses.push((await signUp(client, uniqueEmail('burst'))).status);
        expect(statuses).toEqual([200, 200, 200, 429]);
    });

    it('rejects writing requests with a foreign or missing Origin', async () => {
        const client = new Client();
        const foreign = await client.json('/api/auth/sign-in/email', {
            method: 'POST', captcha: 'pass', origin: 'https://evil.example',
            body: { email: uniqueEmail(), password: PASSWORD }
        });
        expect(foreign.status).toBe(403);
        expect(foreign.data.error).toBe('forbidden');
        const missing = await client.json('/api/auth/sign-in/email', {
            method: 'POST', captcha: 'pass', origin: null,
            body: { email: uniqueEmail(), password: PASSWORD }
        });
        expect(missing.status).toBe(403);
    });

    it('session cookies are HttpOnly, SameSite=Lax and Secure on https origins', async () => {
        const httpsEnv = { BASE_URL: 'https://cadence.example.com', EMAIL_MODE: 'resend', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Cadence <noreply@cadence.example.com>' };
        const client = new Client(httpsEnv);
        const email = uniqueEmail();
        const origin = 'https://cadence.example.com';
        const up = await client.json('/api/auth/sign-up/email', { method: 'POST', captcha: 'pass', origin, body: { email, password: PASSWORD, name: 'Sec' } });
        expect(up.status).toBe(200);
        // verification mail went out through the (stubbed) Resend API, not the console outbox
        expect(globalThis.__resendCalls.at(-1).url).toContain('api.resend.com');
        const link = JSON.parse(globalThis.__resendCalls.at(-1).init.body).text.match(/https?:\/\/\S+/)[0];
        const url = new URL(link);
        await client.request(url.pathname + url.search, { origin: null });
        const first = await client.request('/api/auth/sign-in/email', { method: 'POST', captcha: 'pass', origin, body: { email, password: PASSWORD } });
        expect(first.status).toBe(200);
        const cookieLines = first.headers.getSetCookie();
        expect(cookieLines.length).toBeGreaterThan(0); // the two-factor challenge cookie
        for (const line of cookieLines) {
            expect(line).toMatch(/HttpOnly/i);
            expect(line).toMatch(/SameSite=Lax/i);
            expect(line).toMatch(/Secure/i);
        }
    });

    it('fails closed when console e-mail is configured for a real origin', async () => {
        const client = new Client({ BASE_URL: 'https://cadence.example.com', EMAIL_MODE: 'console' });
        const res = await client.json('/api/auth/sign-up/email', {
            method: 'POST', captcha: 'pass', origin: 'https://cadence.example.com',
            body: { email: uniqueEmail(), password: PASSWORD, name: 'x' }
        });
        expect(res.status).toBe(500);
        expect(res.data.error).toBe('internal');
    });
});
