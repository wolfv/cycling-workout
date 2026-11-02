import { env, applyD1Migrations } from 'cloudflare:test';

// Fresh schema for every test file.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// No network in tests: Cloudflare Turnstile verification is answered locally.
// A captcha response equal to "pass" succeeds, anything else fails (like the real siteverify endpoint).
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
        const body = JSON.parse(init?.body ?? (await input.clone().text()));
        const success = body.response === 'pass';
        return new Response(JSON.stringify({ success, 'error-codes': success ? [] : ['invalid-input-response'] }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
    if (url.startsWith('https://api.resend.com/')) {
        globalThis.__resendCalls = (globalThis.__resendCalls || []).concat([{ url, init }]);
        return new Response('{"id":"test"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
};
