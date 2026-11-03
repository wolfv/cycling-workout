// /api/me: profile, data export, account deletion.

import { HttpError, badRequest, isPlainObject, json, readJsonBody } from './http.js';
import { enforceLimit } from './limits.js';
import { rideDetail } from './rides.js';

const MAX_SMALL_BODY = 10 * 1024;

function userView(user) {
    return { id: user.id, email: user.email, name: user.name, emailVerified: !!user.emailVerified };
}

async function readProfile(env, userId) {
    const row = await env.DB.prepare('SELECT rider_name, ftp, hr_consent_at FROM profile WHERE user_id = ?').bind(userId).first();
    return {
        riderName: row?.rider_name ?? null,
        ftp: row?.ftp ?? null,
        hrConsentAt: row?.hr_consent_at ?? null
    };
}

/** GET /api/me */
export async function getMe(env, user) {
    return json({ user: userView(user), profile: await readProfile(env, user.id) });
}

/** PUT /api/me */
export async function putMe(request, env, user) {
    const body = await readJsonBody(request, MAX_SMALL_BODY);
    if (!isPlainObject(body)) throw badRequest('Body must be a JSON object.');

    const sets = [];
    const values = [];

    if ('riderName' in body) {
        const name = typeof body.riderName === 'string' ? body.riderName.trim() : null;
        if (!name || name.length > 40) throw badRequest('riderName must be a string of 1 to 40 characters.');
        sets.push('rider_name');
        values.push(name);
    }
    if ('ftp' in body) {
        if (!Number.isInteger(body.ftp) || body.ftp < 50 || body.ftp > 500) throw badRequest('ftp must be an integer between 50 and 500.');
        sets.push('ftp');
        values.push(body.ftp);
    }
    if ('hrConsent' in body) {
        if (typeof body.hrConsent !== 'boolean') throw badRequest('hrConsent must be true or false.');
        sets.push('hr_consent_at');
        values.push(body.hrConsent ? new Date().toISOString() : null);
    }

    if (sets.length) {
        const columns = sets.join(', ');
        const placeholders = sets.map(() => '?').join(', ');
        const updates = sets.map((c) => `${c} = excluded.${c}`).join(', ');
        await env.DB
            .prepare(`INSERT INTO profile (user_id, ${columns}) VALUES (?, ${placeholders}) ON CONFLICT (user_id) DO UPDATE SET ${updates}`)
            .bind(user.id, ...values)
            .run();
    }
    return getMe(env, user);
}

/**
 * GET /api/me/export: streams {"exportedAt","user","profile","rides":[...]} one ride per pull,
 * so a long history never sits in memory and nothing runs after the response ends.
 */
export async function exportMe(env, user) {
    const encoder = new TextEncoder();
    const profile = await readProfile(env, user.id);
    const head = {
        exportedAt: new Date().toISOString(),
        user: { ...userView(user), createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null },
        profile
    };
    const PAGE = 25;
    let stage = 'head';
    let ids = [];
    let cursor = null;
    let exhausted = false;
    let first = true;

    const nextId = async () => {
        if (!ids.length && !exhausted) {
            const { results } = await env.DB
                .prepare(
                    `SELECT id, started_at FROM ride WHERE user_id = ?1
                     AND (?2 IS NULL OR started_at < ?2 OR (started_at = ?2 AND id < ?3))
                     ORDER BY started_at DESC, id DESC LIMIT ${PAGE}`
                )
                .bind(user.id, cursor?.[0] ?? null, cursor?.[1] ?? null)
                .all();
            ids = results.map((r) => r.id);
            if (results.length < PAGE) exhausted = true;
            else cursor = [results[results.length - 1].started_at, results[results.length - 1].id];
        }
        return ids.shift();
    };

    const body = new ReadableStream({
        async pull(controller) {
            try {
                if (stage === 'head') {
                    stage = 'rides';
                    controller.enqueue(encoder.encode(JSON.stringify(head).slice(0, -1) + ',"rides":['));
                    return;
                }
                if (stage === 'rides') {
                    const id = await nextId();
                    if (id === undefined) {
                        stage = 'done';
                        controller.enqueue(encoder.encode(']}'));
                        controller.close();
                        return;
                    }
                    let detail;
                    try {
                        detail = await rideDetail(env, user, id);
                    } catch (error) {
                        if (error instanceof HttpError && error.status === 404) return; // deleted meanwhile
                        throw error;
                    }
                    controller.enqueue(encoder.encode((first ? '' : ',') + JSON.stringify(detail)));
                    first = false;
                }
            } catch (error) {
                console.error('export failed', error);
                controller.error(error);
            }
        }
    });

    return new Response(body, {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="cadence-export.json"'
        }
    });
}

/**
 * DELETE /api/me {"password"}: verifies the password, then deletes the user row.
 * session, account, twoFactor, profile and ride rows go with it through ON DELETE CASCADE
 * (D1 enforces foreign keys); verification rows that point at the user are removed explicitly.
 */
export async function deleteMe(request, env, auth, user, sessionCookieName) {
    const body = await readJsonBody(request, MAX_SMALL_BODY);
    if (!isPlainObject(body) || typeof body.password !== 'string' || !body.password || body.password.length > 128) {
        throw badRequest('password is required.');
    }
    await enforceLimit(env.DB, `me-delete:${user.id}`, { windowS: 15 * 60, max: 5 });

    const account = await env.DB
        .prepare("SELECT password FROM account WHERE userId = ? AND providerId = 'credential'")
        .bind(user.id)
        .first();
    const context = await auth.$context;
    const ok = account?.password && (await context.password.verify({ hash: account.password, password: body.password }));
    if (!ok) throw new HttpError(403, 'forbidden', 'Wrong password.');

    await env.DB.batch([
        env.DB.prepare('DELETE FROM verification WHERE value = ?').bind(user.id),
        env.DB.prepare('DELETE FROM "user" WHERE id = ?').bind(user.id)
    ]);

    // Expire the session cookie in the browser.
    const flags = new URL(env.BASE_URL).protocol === 'https:' ? '; Secure' : '';
    return json({ ok: true }, 200, {
        'Set-Cookie': `${sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${flags}`
    });
}
