// Tiny fixed-window rate limiter for our own routes, stored in the same D1 table Better Auth uses
// ("rateLimit"), so it works across Worker isolates. One atomic upsert per check.

import { HttpError } from './http.js';

/** Returns true when the action is allowed, and counts it. */
export async function consumeLimit(db, key, { windowS, max }) {
    const now = Date.now();
    const windowMs = windowS * 1000;
    const row = await db
        .prepare(
            `INSERT INTO rateLimit (id, key, count, lastRequest) VALUES (?1, ?2, 1, ?3)
             ON CONFLICT (key) DO UPDATE SET
               count = CASE WHEN ?3 - lastRequest >= ?4 THEN 1 ELSE count + 1 END,
               lastRequest = CASE WHEN ?3 - lastRequest >= ?4 THEN ?3 ELSE lastRequest END
             RETURNING count`
        )
        .bind(crypto.randomUUID(), key, now, windowMs)
        .first();
    return row.count <= max;
}

export async function enforceLimit(db, key, rule) {
    if (!(await consumeLimit(db, key, rule))) {
        throw new HttpError(429, 'rate_limited', 'Too many requests. Please try again later.', {
            'Retry-After': String(rule.windowS)
        });
    }
}
