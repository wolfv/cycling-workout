import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { outbox } from '../src/email.js';

export const ORIGIN = 'http://localhost:8787';
export const PASSWORD = 'correct horse battery';

let counter = 0;
export const uniqueEmail = (prefix = 'rider') => `${prefix}-${Date.now()}-${++counter}@example.com`;
export const uniqueIp = () => `10.${(counter >> 8) & 255}.${counter & 255}.${Math.floor(Math.random() * 250) + 1}`;

/** A browser-like cookie jar plus a stable client IP (rate limits are per IP). */
export class Client {
    constructor(overrides = {}) {
        this.cookies = new Map();
        this.ip = uniqueIp();
        this.env = { ...env, ...overrides };
    }

    cookieHeader() {
        return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    absorb(response) {
        for (const line of response.headers.getSetCookie()) {
            const [pair, ...attrs] = line.split(';').map((s) => s.trim());
            const eq = pair.indexOf('=');
            const name = pair.slice(0, eq);
            const value = pair.slice(eq + 1);
            const maxAge = attrs.find((a) => /^max-age=/i.test(a));
            if (value === '' || (maxAge && Number(maxAge.split('=')[1]) <= 0)) this.cookies.delete(name);
            else this.cookies.set(name, value);
        }
    }

    /** Calls the Worker's fetch handler directly. Writes send a matching Origin unless `origin` says otherwise. */
    async request(path, { method = 'GET', body, headers = {}, origin, captcha, raw } = {}) {
        const h = new Headers(headers);
        if (this.cookies.size) h.set('Cookie', this.cookieHeader());
        h.set('cf-connecting-ip', this.ip);
        if (origin !== null && (origin || method !== 'GET')) h.set('Origin', origin || ORIGIN);
        if (captcha) h.set('x-captcha-response', captcha);
        let payload;
        if (raw !== undefined) payload = raw;
        else if (body !== undefined) {
            payload = JSON.stringify(body);
            h.set('Content-Type', 'application/json');
        }
        const ctx = createExecutionContext();
        const response = await worker.fetch(new Request(ORIGIN + path, { method, headers: h, body: payload, redirect: 'manual' }), this.env, ctx);
        await waitOnExecutionContext(ctx);
        this.absorb(response);
        return response;
    }

    async json(path, options) {
        const response = await this.request(path, options);
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            /* non-JSON */
        }
        return { status: response.status, data, headers: response.headers, text };
    }

    get sessionCookie() {
        return [...this.cookies.keys()].find((k) => k.includes('session_token'));
    }
}

export function lastEmail(to, subjectPart) {
    for (let i = outbox.length - 1; i >= 0; i--) {
        const m = outbox[i];
        if (m.to === to && (!subjectPart || m.subject.includes(subjectPart))) return m;
    }
    return null;
}

export const signUp = (client, email, password = PASSWORD, name = 'Test Rider') =>
    client.json('/api/auth/sign-up/email', { method: 'POST', captcha: 'pass', body: { email, password, name, callbackURL: '/?verified=1' } });

export async function verifyEmail(client, email) {
    const mail = lastEmail(email, 'Verify');
    const link = mail.text.match(/https?:\/\/\S+/)[0];
    const url = new URL(link);
    return client.request(url.pathname + url.search, { origin: null });
}

export const signIn = (client, email, password = PASSWORD) =>
    client.json('/api/auth/sign-in/email', { method: 'POST', captcha: 'pass', body: { email, password, rememberMe: true } });

export async function sendOtp(client, email) {
    const before = outbox.length;
    const res = await client.json('/api/auth/two-factor/send-otp', { method: 'POST', body: {} });
    const mail = outbox.length > before ? lastEmail(email, 'sign-in code') : null;
    return { res, code: mail ? mail.text.match(/\b(\d{6})\b/)[1] : null };
}

export const verifyOtp = (client, code, trustDevice = false) =>
    client.json('/api/auth/two-factor/verify-otp', { method: 'POST', body: { code, trustDevice } });

/** Registers, verifies and fully signs in a fresh user. Returns {client, email, user}. */
export async function createSignedInUser({ hrConsent = false, prefix } = {}) {
    const client = new Client();
    const email = uniqueEmail(prefix);
    const up = await signUp(client, email);
    if (up.status !== 200) throw new Error(`sign-up failed: ${up.status} ${up.text}`);
    await verifyEmail(client, email);
    const first = await signIn(client, email);
    if (!first.data?.twoFactorRedirect) throw new Error(`expected twoFactorRedirect: ${first.text}`);
    const { code } = await sendOtp(client, email);
    const second = await verifyOtp(client, code);
    if (second.status !== 200) throw new Error(`verify-otp failed: ${second.status} ${second.text}`);
    if (hrConsent) {
        const r = await client.json('/api/me', { method: 'PUT', body: { hrConsent: true } });
        if (r.status !== 200) throw new Error('consent failed');
    }
    return { client, email, user: second.data.user };
}

let rideCounter = 0;
export function newRideId() {
    const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    rideCounter++;
    return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`;
}

/** n one-second samples with constant values. */
export function constantSamples(n, power = 200, hr = 0, cadence = 90) {
    return Array.from({ length: n }, (_, i) => [i, power, hr, cadence]);
}

export function ridePayload(overrides = {}) {
    return {
        id: newRideId(),
        startedAt: '2026-11-02T07:30:00.000Z',
        workoutName: 'Test ride',
        ftp: 250,
        groupSession: false,
        samples: constantSamples(60),
        ...overrides
    };
}
