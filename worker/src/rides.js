// Rides API: upload, list, detail, TCX, delete, stats. Every query filters by the session's user id.

import { HttpError, badRequest, isPlainObject, json, readJsonBody } from './http.js';
import { computeRideStats, buildStats, statsWindowStart } from './stats.js';
import { buildTcx, tcxFilename } from './tcx.js';
import { enforceLimit } from './limits.js';

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_SAMPLES = 43200;
const MAX_ELAPSED_S = 7 * 24 * 3600;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const UPLOADS_PER_HOUR = 120;

const SUMMARY_COLUMNS = `id, started_at, duration_s, workout_name, ftp, avg_power, max_power, avg_hr, max_hr,
    avg_cadence, work_kj, np, tss, group_session, created_at`;

export function rowToSummary(row) {
    return {
        id: row.id,
        startedAt: row.started_at,
        durationS: row.duration_s,
        workoutName: row.workout_name,
        ftp: row.ftp,
        avgPower: row.avg_power,
        maxPower: row.max_power,
        avgHr: row.avg_hr,
        maxHr: row.max_hr,
        avgCadence: row.avg_cadence,
        workKj: row.work_kj,
        np: row.np,
        tss: row.tss,
        groupSession: !!row.group_session,
        createdAt: row.created_at
    };
}

// ---- compression ----

async function gzipText(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
}

async function gunzipSamples(blob) {
    const bytes = blob instanceof ArrayBuffer ? new Uint8Array(blob) : Uint8Array.from(blob);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
}

// ---- validation ----

function isInt(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}

export function validateRideBody(body) {
    if (!isPlainObject(body)) throw badRequest('Body must be a JSON object.');

    if (typeof body.id !== 'string' || !UUID_V4.test(body.id)) throw badRequest('id must be a UUID v4.');
    const id = body.id.toLowerCase();

    if (typeof body.startedAt !== 'string' || !ISO_DATE.test(body.startedAt) || Number.isNaN(Date.parse(body.startedAt))) {
        throw badRequest('startedAt must be an ISO 8601 date-time with time zone.');
    }
    const startedAt = new Date(body.startedAt).toISOString();

    let workoutName = null;
    if (body.workoutName != null) {
        if (typeof body.workoutName !== 'string' || body.workoutName.length > 100) {
            throw badRequest('workoutName must be a string of at most 100 characters.');
        }
        workoutName = body.workoutName;
    }

    let ftp = null;
    if (body.ftp != null) {
        if (!isInt(body.ftp, 50, 500)) throw badRequest('ftp must be an integer between 50 and 500, or null.');
        ftp = body.ftp;
    }

    if (body.groupSession != null && typeof body.groupSession !== 'boolean') {
        throw badRequest('groupSession must be a boolean.');
    }
    const groupSession = body.groupSession === true;

    const samples = body.samples;
    if (!Array.isArray(samples) || samples.length < 1 || samples.length > MAX_SAMPLES) {
        throw badRequest(`samples must be an array of 1 to ${MAX_SAMPLES} entries.`);
    }
    let previous = -1;
    let hasHr = false;
    for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        if (!Array.isArray(s) || s.length !== 4) throw badRequest(`samples[${i}] must be [elapsedSeconds, power, heartRate, cadence].`);
        if (!isInt(s[0], 0, MAX_ELAPSED_S)) throw badRequest(`samples[${i}]: elapsedSeconds must be an integer of at most ${MAX_ELAPSED_S}.`);
        if (s[0] <= previous) throw badRequest(`samples[${i}]: elapsedSeconds must be strictly increasing (at most one sample per second).`);
        if (!isInt(s[1], 0, 3000)) throw badRequest(`samples[${i}]: power must be an integer 0-3000.`);
        if (!isInt(s[2], 0, 250)) throw badRequest(`samples[${i}]: heart rate must be an integer 0-250.`);
        if (!isInt(s[3], 0, 250)) throw badRequest(`samples[${i}]: cadence must be an integer 0-250.`);
        if (s[2] > 0) hasHr = true;
        previous = s[0];
    }
    return { id, startedAt, workoutName, ftp, groupSession, samples, hasHr };
}

// ---- handlers ----

/** POST /api/rides */
export async function uploadRide(request, env, user) {
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    const ride = validateRideBody(body);
    const db = env.DB;

    // Idempotency / ownership: the same id for the same user returns the stored ride, another user's id is a conflict.
    const existing = await db.prepare(`SELECT user_id, ${SUMMARY_COLUMNS} FROM ride WHERE id = ?`).bind(ride.id).first();
    if (existing) {
        if (existing.user_id !== user.id) throw new HttpError(409, 'conflict', 'This ride id is already in use.');
        return json(rowToSummary(existing), 200);
    }

    await enforceLimit(db, `rides-post:${user.id}`, { windowS: 3600, max: UPLOADS_PER_HOUR });

    if (ride.hasHr) {
        const profile = await db.prepare('SELECT hr_consent_at FROM profile WHERE user_id = ?').bind(user.id).first();
        if (!profile || !profile.hr_consent_at) {
            throw new HttpError(428, 'hr_consent_required', 'Storing heart-rate data needs your consent. Send PUT /api/me {"hrConsent":true} and retry.');
        }
    }

    const stats = computeRideStats(ride.samples, ride.ftp);
    const gz = await gzipText(JSON.stringify(ride.samples));
    try {
        await db
            .prepare(
                `INSERT INTO ride (id, user_id, started_at, duration_s, workout_name, ftp, avg_power, max_power,
                    avg_hr, max_hr, avg_cadence, work_kj, np, tss, group_session, samples_gz)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
                ride.id, user.id, ride.startedAt, stats.durationS, ride.workoutName, ride.ftp,
                stats.avgPower, stats.maxPower, stats.avgHr, stats.maxHr, stats.avgCadence,
                stats.workKj, stats.np, stats.tss, ride.groupSession ? 1 : 0, gz
            )
            .run();
    } catch (error) {
        // Concurrent upload of the same id: the other request won; answer like the idempotent case.
        const winner = await db.prepare(`SELECT user_id, ${SUMMARY_COLUMNS} FROM ride WHERE id = ?`).bind(ride.id).first();
        if (!winner) throw error;
        if (winner.user_id !== user.id) throw new HttpError(409, 'conflict', 'This ride id is already in use.');
        return json(rowToSummary(winner), 200);
    }
    const stored = await db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM ride WHERE id = ? AND user_id = ?`).bind(ride.id, user.id).first();
    return json(rowToSummary(stored), 201);
}

function encodeCursor(row) {
    return btoa(JSON.stringify([row.started_at, row.id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(cursor) {
    try {
        const padded = cursor.replace(/-/g, '+').replace(/_/g, '/');
        const parsed = JSON.parse(atob(padded));
        if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
            return parsed;
        }
    } catch {
        /* fall through */
    }
    throw badRequest('cursor is invalid.');
}

/** GET /api/rides?limit=&cursor= */
export async function listRides(url, env, user) {
    let limit = 20;
    if (url.searchParams.has('limit')) {
        const raw = url.searchParams.get('limit');
        limit = /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (!isInt(limit, 1, 100)) throw badRequest('limit must be an integer between 1 and 100.');
    }
    const cursor = url.searchParams.get('cursor');

    let query = `SELECT ${SUMMARY_COLUMNS} FROM ride WHERE user_id = ?1`;
    const params = [user.id];
    if (cursor) {
        const [startedAt, id] = decodeCursor(cursor);
        query += ' AND (started_at < ?2 OR (started_at = ?2 AND id < ?3))';
        params.push(startedAt, id);
    }
    query += ` ORDER BY started_at DESC, id DESC LIMIT ${limit + 1}`;
    const { results } = await env.DB.prepare(query).bind(...params).all();

    const page = results.slice(0, limit);
    const nextCursor = results.length > limit ? encodeCursor(page[page.length - 1]) : null;
    return json({ rides: page.map(rowToSummary), nextCursor });
}

async function loadRide(env, user, id, withSamples) {
    const columns = withSamples ? `${SUMMARY_COLUMNS}, samples_gz` : SUMMARY_COLUMNS;
    const row = await env.DB.prepare(`SELECT ${columns} FROM ride WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
    if (!row) throw new HttpError(404, 'not_found', 'Ride not found.');
    const summary = rowToSummary(row);
    if (!withSamples) return { summary };
    return { summary, samples: await gunzipSamples(row.samples_gz) };
}

/** Ride detail as used by GET /api/rides/:id and the account export. */
export async function rideDetail(env, user, id) {
    const { summary, samples } = await loadRide(env, user, id, true);
    return { ...summary, samples };
}

/** GET /api/rides/:id */
export async function getRide(env, user, id) {
    return json(await rideDetail(env, user, id));
}

/** GET /api/rides/:id/tcx */
export async function getRideTcx(env, user, id) {
    const { summary, samples } = await loadRide(env, user, id, true);
    return new Response(buildTcx(summary, samples), {
        status: 200,
        headers: {
            'Content-Type': 'application/vnd.garmin.tcx+xml',
            'Content-Disposition': `attachment; filename="${tcxFilename(summary.startedAt)}"`
        }
    });
}

/** DELETE /api/rides/:id */
export async function deleteRide(env, user, id) {
    const result = await env.DB.prepare('DELETE FROM ride WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    if (!result.meta.changes) throw new HttpError(404, 'not_found', 'Ride not found.');
    return new Response(null, { status: 204 });
}

/** GET /api/stats */
export async function getStats(env, user, now = new Date()) {
    const { results } = await env.DB
        .prepare('SELECT started_at, duration_s, work_kj, tss FROM ride WHERE user_id = ? AND started_at >= ?')
        .bind(user.id, statsWindowStart(now))
        .all();
    return json(buildStats(results, now));
}
