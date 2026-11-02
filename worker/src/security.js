// Security headers, the Origin check for writing requests, and a fail-closed configuration check.

export const CSP = [
    "default-src 'self'",
    // The frontend uses inline onclick handlers and Alpine.js (needs 'unsafe-eval'), so inline/eval scripts stay allowed.
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://challenges.cloudflare.com",
    // basecoat CSS (jsDelivr) and Google Fonts are loaded from index.html / style.css.
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "connect-src 'self' wss://zwift-signaling.w-vollprecht.workers.dev",
    'frame-src https://challenges.cloudflare.com',
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
].join('; ');

const BASE_HEADERS = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'bluetooth=(self)'
};

/** Returns a copy of `response` with the security headers set. CSP and X-Frame-Options only go on HTML. */
export function withSecurityHeaders(response) {
    const out = new Response(response.body, response);
    for (const [name, value] of Object.entries(BASE_HEADERS)) out.headers.set(name, value);
    const type = out.headers.get('Content-Type') || '';
    if (type.includes('text/html')) {
        out.headers.set('Content-Security-Policy', CSP);
        out.headers.set('X-Frame-Options', 'DENY');
    }
    return out;
}

export function allowedOrigins(env) {
    const list = [env.BASE_URL, ...String(env.TRUSTED_ORIGINS || '').split(',')]
        .map((s) => (s || '').trim())
        .filter(Boolean);
    const origins = new Set();
    for (const entry of list) {
        try {
            origins.add(new URL(entry).origin);
        } catch {
            /* ignore malformed entries */
        }
    }
    return origins;
}

export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** True when the request may proceed: not a writing method, or its Origin header is an allowed origin. */
export function originAllowed(request, env) {
    if (!WRITE_METHODS.has(request.method)) return true;
    const origin = request.headers.get('Origin');
    if (!origin) return false;
    return allowedOrigins(env).has(origin);
}

export function isLocalUrl(url) {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

/** Returns a description of a configuration problem, or null. API routes fail closed (500) while one exists. */
export function configProblem(env) {
    if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
        return 'BETTER_AUTH_SECRET is missing or shorter than 32 characters.';
    }
    if (!env.BASE_URL) return 'BASE_URL is not set.';
    let url;
    try {
        url = new URL(env.BASE_URL);
    } catch {
        return 'BASE_URL is not a valid URL.';
    }
    const local = isLocalUrl(url);
    // Console mode logs sign-in codes; it must never run against a real origin.
    if (env.EMAIL_MODE === 'console' && !local) return 'EMAIL_MODE=console is only allowed for localhost.';
    if (!local && url.protocol !== 'https:') return 'BASE_URL must be https outside localhost.';
    if (!env.TURNSTILE_SECRET_KEY) return 'TURNSTILE_SECRET_KEY is not set.';
    if (env.EMAIL_MODE !== 'console' && !env.RESEND_API_KEY) return 'RESEND_API_KEY is not set.';
    return null;
}
