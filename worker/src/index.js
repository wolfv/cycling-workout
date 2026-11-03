// Cadence Worker: static frontend (assets) + JSON API under /api/*.

import { createAuth } from './auth.js';
import { HttpError, errorCodeForStatus, errorResponse, json } from './http.js';
import { configProblem, originAllowed, withSecurityHeaders } from './security.js';
import { deleteMe, exportMe, getMe, putMe } from './me.js';
import { deleteRide, getRide, getRideTcx, getStats, listRides, uploadRide } from './rides.js';

// Better Auth endpoints we expose. Everything else under /api/auth/ is a 404 (no TOTP, backup codes,
// two-factor enable/disable, user updates ...): the account model is fixed by docs/api.md.
const AUTH_ALLOWLIST = {
    GET: [/^\/get-session$/, /^\/verify-email$/, /^\/reset-password\/[^/]+$/, /^\/ok$/, /^\/error$/],
    POST: [
        /^\/sign-up\/email$/,
        /^\/sign-in\/email$/,
        /^\/send-verification-email$/,
        /^\/two-factor\/send-otp$/,
        /^\/two-factor\/verify-otp$/,
        /^\/sign-out$/,
        /^\/revoke-sessions$/,
        /^\/request-password-reset$/,
        /^\/reset-password$/
    ]
};

function authPathAllowed(method, path) {
    const key = method === 'HEAD' ? 'GET' : method;
    return (AUTH_ALLOWLIST[key] || []).some((re) => re.test(path));
}

/** Gives Better Auth's own JSON errors the contract's {error, message} shape (keeps its `code`). */
async function normalizeAuthError(response) {
    if (response.status < 400 || !(response.headers.get('Content-Type') || '').includes('application/json')) {
        return response;
    }
    let body;
    try {
        body = await response.clone().json();
    } catch {
        return response;
    }
    if (!body || typeof body !== 'object' || 'error' in body) return response;
    const headers = new Headers(response.headers);
    headers.delete('Content-Length');
    const retry = headers.get('X-Retry-After');
    if (retry && !headers.has('Retry-After')) headers.set('Retry-After', retry);
    return new Response(
        JSON.stringify({ error: errorCodeForStatus(response.status), message: body.message || 'Request failed.', ...(body.code ? { code: body.code } : {}) }),
        { status: response.status, headers }
    );
}

async function handleAuth(request, env, ctx, path) {
    if (!authPathAllowed(request.method, path)) return errorResponse(404, 'not_found', 'Not found.');
    const auth = createAuth(env, ctx);
    return normalizeAuthError(await auth.handler(request));
}

/** Resolves the signed-in user from the session cookie. Sliding-session cookies are forwarded. */
async function requireUser(request, auth) {
    const result = await auth.api.getSession({ headers: request.headers, returnHeaders: true });
    const session = result?.response;
    if (!session?.user) throw new HttpError(401, 'unauthenticated', 'Sign in required.');
    return { user: session.user, setCookie: result.headers?.getSetCookie?.() ?? [] };
}

function withCookies(response, setCookie) {
    if (!setCookie.length) return response;
    const out = new Response(response.body, response);
    for (const cookie of setCookie) out.headers.append('Set-Cookie', cookie);
    return out;
}

const RIDE_PATH = /^\/rides\/([^/]+)(\/tcx)?$/;
const USER_ROUTES = [/^\/me$/, /^\/me\/export$/, /^\/rides$/, /^\/stats$/, RIDE_PATH];

async function route(request, env, ctx, path, url) {
    const method = request.method;

    if (path === '/health') {
        if (method !== 'GET' && method !== 'HEAD') return errorResponse(405, null, 'Method not allowed.', { Allow: 'GET, HEAD' });
        return json({ status: 'ok', version: env.APP_VERSION || 'dev' });
    }
    if (path === '/config') {
        if (method !== 'GET' && method !== 'HEAD') return errorResponse(405, null, 'Method not allowed.', { Allow: 'GET, HEAD' });
        return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || '' });
    }

    const problem = configProblem(env);
    if (problem) {
        console.error(`Configuration problem: ${problem}`);
        return errorResponse(500, 'internal', 'The server is not configured correctly.');
    }

    if (path.startsWith('/auth/')) return handleAuth(request, env, ctx, path.slice('/auth'.length));

    if (!USER_ROUTES.some((re) => re.test(path))) return errorResponse(404, 'not_found', 'Not found.');

    const auth = createAuth(env, ctx);
    const { user, setCookie } = await requireUser(request, auth);
    const done = (response) => withCookies(response, setCookie);

    if (path === '/me') {
        if (method === 'GET') return done(await getMe(env, user));
        if (method === 'PUT') return done(await putMe(request, env, user));
        if (method === 'DELETE') {
            const cookieName = (await auth.$context).authCookies.sessionToken.name;
            return deleteMe(request, env, auth, user, cookieName);
        }
        return errorResponse(405, null, 'Method not allowed.', { Allow: 'GET, PUT, DELETE' });
    }
    if (path === '/me/export') {
        if (method !== 'GET') return errorResponse(405, null, 'Method not allowed.', { Allow: 'GET' });
        return done(await exportMe(env, user));
    }
    if (path === '/rides') {
        if (method === 'POST') return done(await uploadRide(request, env, user));
        if (method === 'GET') return done(await listRides(url, env, user));
        return errorResponse(405, null, 'Method not allowed.', { Allow: 'GET, POST' });
    }
    if (path === '/stats') {
        if (method !== 'GET') return errorResponse(405, null, 'Method not allowed.', { Allow: 'GET' });
        return done(await getStats(env, user));
    }
    const ride = RIDE_PATH.exec(path);
    if (ride) {
        const id = decodeURIComponent(ride[1]);
        if (ride[2]) {
            if (method !== 'GET') return errorResponse(405, null, 'Method not allowed.', { Allow: 'GET' });
            return done(await getRideTcx(env, user, id));
        }
        if (method === 'GET') return done(await getRide(env, user, id));
        if (method === 'DELETE') return done(await deleteRide(env, user, id));
        return errorResponse(405, null, 'Method not allowed.', { Allow: 'GET, DELETE' });
    }
    return errorResponse(404, 'not_found', 'Not found.');
}

async function handleApi(request, env, ctx, url) {
    if (!originAllowed(request, env)) {
        return errorResponse(403, 'forbidden', 'Cross-origin write request refused.');
    }
    const path = url.pathname.slice('/api'.length) || '/';
    try {
        return await route(request, env, ctx, path, url);
    } catch (error) {
        if (error instanceof HttpError) return errorResponse(error.status, error.code, error.message, error.headers);
        console.error('Unhandled API error', error);
        return errorResponse(500, 'internal', 'Internal error.');
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
            const response = await handleApi(request, env, ctx, url);
            // Auth redirects (verify-email) must stay cacheable-neutral too: nothing under /api is cacheable.
            const out = withSecurityHeaders(response);
            out.headers.set('Cache-Control', 'no-store');
            return out;
        }
        return withSecurityHeaders(await env.ASSETS.fetch(request));
    }
};
