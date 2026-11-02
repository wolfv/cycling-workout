# Cadence API contract (v1)

Binding contract between the Worker (`worker/`) and the frontend. Change it only together with both sides.
UI language stays English, like the rest of the app.

## General

- Same origin: frontend and API are served by one Cloudflare Worker. All API paths start with `/api/`.
- Auth uses the Better Auth session cookie (HttpOnly, Secure, SameSite=Lax). The frontend always sends `credentials: 'same-origin'` and never stores tokens itself.
- Requests and responses are JSON (`Content-Type: application/json`), except where noted.
- Errors: `{"error": "<code>", "message": "<human readable>"}` with a matching HTTP status.
  Shared codes: `unauthenticated` (401), `forbidden` (403), `not_found` (404), `method_not_allowed` (405), `invalid_request` (400), `conflict` (409), `payload_too_large` (413), `rate_limited` (429), `internal` (500). Resource-specific code: `hr_consent_required` (428).
  Errors from `/api/auth/*` additionally carry Better Auth's own machine code in `code` (for example `EMAIL_NOT_VERIFIED`, `INVALID_CODE`), because the frontend needs it: `{"error":"forbidden","message":"Email not verified","code":"EMAIL_NOT_VERIFIED"}`. Rate-limited answers (429) carry a `Retry-After` header (seconds).
- Writing requests (`POST/PUT/PATCH/DELETE`) whose `Origin` header is missing or is not the app's own origin (`BASE_URL` / `TRUSTED_ORIGINS`) are rejected with 403 `forbidden`. Browsers send `Origin` on every `fetch` POST/PUT/DELETE, so the frontend needs no extra work; curl needs `-H "Origin: <app origin>"`.
- Unknown `/api/*` paths answer `404 not_found` (also without a session); a known path with an unsupported method answers `405 method_not_allowed` with an `Allow` header. Only the `/api/auth/*` endpoints listed below exist; everything else Better Auth ships (TOTP, backup codes, two-factor enable/disable, update-user, list-sessions ...) is deliberately not exposed.
- Availability check: if `GET /api/health` fails (for example on GitHub Pages, where no API exists), the frontend hides all account features and works as before.

`GET /api/health` → `200 {"status":"ok","version":"<git hash or dev>"}`

## Authentication (Better Auth, mounted at `/api/auth`)

Sign-in has two factors: password, then a 6-digit code sent by email. There is no authenticator app.
Every account has two-factor enabled automatically when it is created. A password alone never produces a usable session.

Bot protection: `sign-up/email`, `sign-in/email` and `request-password-reset` need a Cloudflare Turnstile token in the header `x-captcha-response`. The public site key comes from `GET /api/config`.

`GET /api/config` → `200 {"turnstileSiteKey":"<key>"}`

| Step | Request | Response |
|---|---|---|
| Register | `POST /api/auth/sign-up/email` `{"email","password","name","callbackURL":"/?verified=1"}` | `200 {"token":null,"user":{...}}`. A verification link (valid 24 h) goes out by email. No session is created. An already registered address gets the same `200` (no account enumeration) and no new mail. Sign-in is refused until the address is verified. Password too short or long: `400` with code `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG`. |
| Verify email | user clicks the link (`GET /api/auth/verify-email?token=…&callbackURL=…`) | `302` to `/?verified=1`. The link does not sign the user in. |
| Resend verification | `POST /api/auth/send-verification-email` `{"email","callbackURL":"/?verified=1"}` | `200`. Rate limit: 3 per minute per IP (Better Auth default). Signing in with the correct password of an unverified account also sends a new link. |
| Sign in, factor 1 | `POST /api/auth/sign-in/email` `{"email","password","rememberMe":true}` | `200 {"twoFactorRedirect":true,"twoFactorMethods":["otp"]}` and a short-lived (10 min) HttpOnly challenge cookie. **The server does not send the code in this step: the client must call send-otp next.** No session cookie is set. Wrong email or password: `401` code `INVALID_EMAIL_OR_PASSWORD`. Unverified email: `403` code `EMAIL_NOT_VERIFIED`. On a browser with a valid trust-device cookie (see factor 2) the answer is instead a normal session (`200 {"redirect":false,"token":"…","user":{...}}` plus session cookie) and no code is needed. |
| Send / resend code | `POST /api/auth/two-factor/send-otp` `{}` (needs the challenge cookie from factor 1) | `200 {"status":true}`. Code: 6 digits, valid 10 minutes, single use. A new request replaces the previous code. Without a challenge cookie: `401` code `INVALID_TWO_FACTOR_COOKIE`. |
| Sign in, factor 2 | `POST /api/auth/two-factor/verify-otp` `{"code":"123456","trustDevice":true}` | `200 {"token":"…","user":{...}}` with session cookie. `trustDevice` sets a trust-device cookie: this browser skips the code for 30 days (refreshed at each sign-in). Wrong code: `401` code `INVALID_CODE`. After 5 wrong attempts the code is dead: `400` code `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE` (call send-otp again). Expired or already used code: `400` code `OTP_HAS_EXPIRED`. |
| Session | `GET /api/auth/get-session` | `200 {"user":{…},"session":{…}}` or `200 null` |
| Sign out | `POST /api/auth/sign-out` `{}` | `200` |
| Sign out everywhere | `POST /api/auth/revoke-sessions` `{}` | `200` |
| Forgot password | `POST /api/auth/request-password-reset` `{"email","redirectTo":"/?reset=1"}` | `200` (also when the email is unknown). The mail contains a link `GET /api/auth/reset-password/<token>?callbackURL=…` (valid 1 h) that answers `302` to `redirectTo` with `?token=<token>` appended. |
| Set new password | `POST /api/auth/reset-password` `{"newPassword","token"}` (token from the `?token=` query parameter of the reset link) | `200`; all sessions are revoked |

Password rules: 10–128 characters. Rate limits (per IP, per endpoint, per minute, stored in D1): `sign-in/email`, `two-factor/send-otp`, `two-factor/verify-otp`, `request-password-reset` and `reset-password` at most 5; `sign-up/email` at most 3. Exceeding a limit answers `429` `rate_limited`.

Captcha failures: missing `x-captcha-response` header `400` code `MISSING_RESPONSE`; token rejected by Turnstile `403` code `VERIFICATION_FAILED`.

Accounts cannot opt out of the second factor: it is switched on when the account is created and the endpoints to change it are not exposed.

If Better Auth uses different paths or bodies than shown here, the Worker side updates this table and the frontend follows it. Better Auth's actual behaviour wins over this document.

## Profile

`GET /api/me` → `200`
```json
{
  "user": {"id":"…","email":"a@b.c","name":"Alex","emailVerified":true},
  "profile": {"riderName":"Alex","ftp":250,"hrConsentAt":"2026-11-02T10:00:00.000Z"}
}
```
`riderName`, `ftp` and `hrConsentAt` can be `null`.

`PUT /api/me` `{"riderName"?: string 1–40, "ftp"?: integer 50–500, "hrConsent"?: true|false}` → `200` with the same shape as `GET`. Only the keys present are changed; `riderName` is trimmed; `null` is not accepted for any key (`400`).
`hrConsent: true` sets `hrConsentAt` to now. `false` sets it to `null`; heart-rate data already stored stays until the user deletes those rides.

`GET /api/me/export` → `200`, `Content-Disposition: attachment; filename="cadence-export.json"`, body `{"exportedAt","user","profile","rides":[<ride detail>…]}`

`DELETE /api/me` `{"password":"…"}` → `200 {"ok":true}` and the session cookie is cleared. Deletes the user, sessions, profile and all rides. Wrong password: `403`; missing password: `400`; more than 5 attempts per 15 minutes: `429`.

## Rides

The server computes all statistics from the samples. Statistics sent by the client are ignored.

### Upload

`POST /api/rides`
```json
{
  "id": "6f1c…-uuid-v4",
  "startedAt": "2026-11-02T07:30:00.000Z",
  "workoutName": "Sweet Spot 3x10",
  "ftp": 250,
  "groupSession": false,
  "samples": [[0, 120, 98, 85], [1, 125, 99, 86]]
}
```
- `id`: UUID v4 created by the client when the ride stops. It makes the upload idempotent: re-sending the same `id` for the same user returns `200` with the stored ride and changes nothing.
- `startedAt`: ISO 8601 date-time **with** time zone (the frontend's `toISOString()` qualifies); stored normalized to UTC.
- `samples`: `[elapsedSeconds:int, power:int, heartRate:int, cadence:int]`, at most 1 per second, **strictly increasing** `elapsedSeconds` (0 to 604,800). The client reduces higher recording rates to 1 Hz (last value per second). Missing values are `0`.
- Limits: 1–43,200 samples (12 h), request body at most 2 MB, `workoutName` at most 100 characters, `ftp` 50–500 or `null`, power 0–3,000, heart rate 0–250, cadence 0–250.
- Heart-rate consent: if any sample has heart rate > 0 and the profile has no `hrConsentAt`, the server answers `428 {"error":"hr_consent_required"}`. The client asks for consent, sends `PUT /api/me {"hrConsent":true}` and retries the upload.

Responses: `201 <ride summary>` (new), `200 <ride summary>` (already stored), `409 {"error":"conflict"}` (the `id` belongs to another user), `400`, `413`, `428`, `429` (more than 120 new rides per hour per user). Re-sending an already stored ride is answered with `200` even if consent was withdrawn in the meantime.

### Ride summary

```json
{
  "id": "…",
  "startedAt": "2026-11-02T07:30:00.000Z",
  "durationS": 3600,
  "workoutName": "Sweet Spot 3x10",
  "ftp": 250,
  "avgPower": 190, "maxPower": 410,
  "avgHr": 142, "maxHr": 171,
  "avgCadence": 88,
  "workKj": 684,
  "np": 205, "tss": 67.2,
  "groupSession": false,
  "createdAt": "2026-11-02T08:31:02.000Z"
}
```
Server-side calculation:
- `durationS` = last `elapsedSeconds`.
- Averages ignore zeros; `avgHr`, `maxHr`, `avgCadence` are `null` when there are no values > 0.
- `workKj` = Σ power over 1-second samples / 1000.
- `np` = 4th root of the mean of (30 s rolling mean of power)^4, over full 30-sample windows, rounded to an integer. Zeros count. `null` below 30 samples.
- `tss` = `durationS × np × IF / (ftp × 3600) × 100` with `IF = np / ftp`, rounded to 1 decimal, computed from the rounded `np` of the summary so clients can reproduce it. `null` without `ftp` or `np`.
- `avgPower` and `maxPower` are `0` when no sample has power > 0.

### List, detail, export, delete

`GET /api/rides?limit=20&cursor=<opaque>` → `200 {"rides":[<summary>…],"nextCursor":"<opaque>|null"}`, newest first (ties by id), `limit` 1–100 (default 20). Invalid `limit` or `cursor`: `400`.

`GET /api/rides/:id` → `200 {<summary>, "samples":[[t,p,hr,cad]…]}`, `404` if the ride does not exist or belongs to another user.

`GET /api/rides/:id/tcx` → `200`, `Content-Type: application/vnd.garmin.tcx+xml`, `Content-Disposition: attachment; filename="cadence-<date>.tcx"` (`<date>` = UTC date of `startedAt`). Same TCX structure as `WorkoutRecorder.exportTCX()`; the workout name in `<Notes>` is XML-escaped, which the client version does not do.

`DELETE /api/rides/:id` → `204`, `404` as above.

### Statistics

`GET /api/stats` → `200`
```json
{
  "thisWeek":  {"rides":3,"durationS":10800,"workKj":2100,"tss":190.5},
  "thisMonth": {"rides":9,"durationS":30100,"workKj":6020,"tss":540.0},
  "weeks": [{"weekStart":"2026-08-17","rides":2,"durationS":7200,"workKj":1400,"tss":120.0}]
}
```
`weeks`: the last 12 ISO weeks (Monday start, UTC), oldest first, including empty weeks. `thisWeek` equals the last entry of `weeks`; `thisMonth` is the current UTC calendar month. `tss` sums the rides that have one.
