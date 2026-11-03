# Cadence Worker

One Cloudflare Worker serves the static frontend and the API under `/api/*` (Better Auth + D1).
Contract: [`../docs/api.md`](../docs/api.md). Plan: [`../docs/PLAN-konten-und-verlauf.md`](../docs/PLAN-konten-und-verlauf.md).

```
src/index.js      routing, Origin check, security headers, static assets
src/auth.js       Better Auth (e-mail+password, e-mail OTP as 2nd factor, Turnstile, rate limits)
src/rides.js      upload / list / detail / TCX / delete / stats
src/me.js         profile, export, account deletion
src/stats.js      NP, TSS, weekly totals        src/tcx.js   TCX export
src/email.js      console (dev) or Resend       src/security.js  CSP and friends
migrations/       0001_auth.sql (Better Auth), 0002_app.sql (profile, ride)
scripts/          build-assets.mjs copies an allowlist of frontend files to dist/
test/             Vitest in workerd (Miniflare), local D1, no network
```

## Local development

Needs Node 22+.

```bash
cd worker
npm install
npm run dev        # creates .dev.vars, migrates the local D1, builds dist/, starts http://localhost:8787
```

- Open <http://localhost:8787> (not `127.0.0.1`: the Origin check and cookies are bound to `BASE_URL`).
- Sign-up, sign-in codes and reset links are **printed in the terminal** (`EMAIL_MODE=console`). Nothing is sent.
- Turnstile runs with Cloudflare's always-pass test keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`). The widget still needs internet access to `challenges.cloudflare.com`.
- Local data lives in `worker/.wrangler/state` (delete the folder to start over).
- The frontend is copied from the repo root into `worker/dist/` by `npm run build`; rerun it (or `npm run dev`) after changing frontend files.

Other scripts: `npm test` (builds assets, runs all tests), `npm run build`, `npm run db:migrate:local`.
Frontend regression tests stay at the repo root: `node --test tests/*.test.cjs`.

curl needs an `Origin` header for writing requests:

```bash
curl -i http://localhost:8787/api/health
curl -i -X POST http://localhost:8787/api/auth/sign-in/email -H "Origin: http://localhost:8787" \
  -H "Content-Type: application/json" -H "x-captcha-response: XXXX.DUMMY.TOKEN.XXXX" \
  -d '{"email":"a@example.com","password":"..."}'
```

## Configuration

Vars (`wrangler.jsonc`; top level = local dev, `env.production` = production):

| Var | Meaning |
|---|---|
| `BASE_URL` | Public origin of the app, no trailing slash. Better Auth `baseURL`, cookie scope, allowed `Origin`. |
| `TRUSTED_ORIGINS` | Optional, comma separated extra origins that may send writing requests (for example a staging URL). |
| `EMAIL_MODE` | `console` (dev only, refused for non-localhost) or `resend`. |
| `EMAIL_FROM` | Sender, for example `Cadence <noreply@your-domain>`. The domain needs SPF/DKIM at Resend, otherwise codes land in spam. |
| `TURNSTILE_SITE_KEY` | Public Turnstile site key, served by `GET /api/config`. |
| `APP_VERSION` | Shown by `GET /api/health`. The deploy workflow sets it to the commit hash. |

Secrets (never in the repo). Production: `npx wrangler secret put <NAME> --env production`. Local: `.dev.vars`.

| Secret | Meaning |
|---|---|
| `BETTER_AUTH_SECRET` | At least 32 random characters (`openssl rand -base64 32`). Signs cookies and encrypts tokens. Changing it signs everyone out. |
| `TURNSTILE_SECRET_KEY` | Secret key of the Turnstile widget. |
| `RESEND_API_KEY` | Resend API key (only when `EMAIL_MODE=resend`). |

The Worker refuses all non-trivial API calls (HTTP 500, reason in the log) when a secret is missing, when `EMAIL_MODE=console` is combined with a real origin, or when `BASE_URL` is not https outside localhost.

## One-time Cloudflare setup (Wolf)

1. Create the database in the EU jurisdiction and note the printed `database_id`:
   ```bash
   cd worker
   npx wrangler d1 create cadence --jurisdiction eu
   ```
   Put the ID into `wrangler.jsonc` under `env.production.d1_databases[0].database_id`.
2. In `wrangler.jsonc` `env.production.vars` set `BASE_URL`, `EMAIL_FROM` and `TURNSTILE_SITE_KEY`.
3. Create a Turnstile widget (Cloudflare dashboard, Turnstile) for the app's hostname; site key goes into `TURNSTILE_SITE_KEY`.
4. Create a Resend account, verify the sending domain (SPF/DKIM), create an API key.
5. Set the three secrets:
   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET --env production
   npx wrangler secret put TURNSTILE_SECRET_KEY --env production
   npx wrangler secret put RESEND_API_KEY --env production
   ```
   (`secret put` needs the Worker to exist; run the first `wrangler deploy --env production` once, or use `wrangler versions secret put`.)
6. For GitHub Actions add the repository secrets `CLOUDFLARE_API_TOKEN` (permissions: Workers Scripts Edit, D1 Edit) and `CLOUDFLARE_ACCOUNT_ID`. The workflow `.github/workflows/deploy-cloudflare.yml` is manual (`workflow_dispatch`) for now.
7. Use the Workers Paid plan (Better Auth hashes passwords with scrypt, which can exceed the Free plan's 10 ms CPU limit).

Deploy (what the workflow does): `npm ci && npm test && npm run build && wrangler d1 migrations apply DB --env production --remote && wrangler deploy --env production`.

## Notes

- Static assets: the Worker runs first for every request (`run_worker_first`), so each asset request is a Worker invocation. That is what lets it add the CSP and other headers; it costs nothing noticeable at this scale.
- The accounts model is fixed by `docs/api.md`: only the listed `/api/auth/*` endpoints are reachable, and every account has the e-mail code as a mandatory second factor (`databaseHooks.user.create` sets `twoFactorEnabled`; test `PASSWORD ALONE NEVER YIELDS A SESSION` in `test/auth.test.js`).
- Before the first production deploy check `BASE_URL`, the D1 id and the three secrets; the placeholder `REPLACE_WITH_PRODUCTION_D1_ID` makes the remote commands fail until the real database ID is set, and the `REPLACE_ME` values would otherwise produce a broken site.
