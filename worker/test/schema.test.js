import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { getSchema } from 'better-auth/db';
import { createAuth } from '../src/auth.js';

// 0001_auth.sql is hand-maintained; this test fails when Better Auth's schema (for the plugins we use) drifts from it.
describe('0001_auth.sql matches Better Auth', () => {
    it('has every table and column Better Auth expects', async () => {
        const auth = createAuth(env, undefined);
        const context = await auth.$context;
        const schema = getSchema(context.options);
        const expectedTables = ['user', 'session', 'account', 'verification', 'twoFactor', 'rateLimit'];
        expect(Object.keys(schema).sort()).toEqual([...expectedTables].sort());
        for (const [table, definition] of Object.entries(schema)) {
            const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all();
            const columns = new Set(results.map((r) => r.name));
            for (const field of Object.keys(definition.fields)) {
                expect(columns.has(field), `${table}.${field}`).toBe(true);
            }
            expect(columns.has('id')).toBe(true);
        }
    });

    it('twoFactor stays empty (no TOTP) and the app tables exist', async () => {
        for (const table of ['profile', 'ride']) {
            const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info('${table}')`).all();
            expect(results.length).toBeGreaterThan(0);
        }
        expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM twoFactor').first()).n).toBe(0);
    });
});
