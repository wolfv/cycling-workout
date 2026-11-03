import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

const migrations = await readD1Migrations('./migrations');

// Tests run inside workerd (Miniflare) against a local D1. Bindings/secrets for tests are set here,
// so no .dev.vars or network access is needed.
export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
                bindings: {
                    TEST_MIGRATIONS: migrations,
                    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123456789',
                    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
                    BASE_URL: 'http://localhost:8787',
                    EMAIL_MODE: 'console'
                }
            }
        })
    ],
    test: {
        include: ['test/**/*.test.js'],
        setupFiles: ['./test/setup.js'],
        testTimeout: 30000,
        // workerd reports every APIError that Better Auth throws and handles internally (4xx answers, redirects) as an
        // 'unhandled rejection' inside this test runner; the same requests under 'wrangler dev' log nothing.
        // Only that error type is ignored, everything else still fails the run.
        onUnhandledError(error) {
            if (error?.name === 'APIError' && typeof error.statusCode === 'number') return false;
        }
    }
});
