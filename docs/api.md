# Cadence API contract (v1)

Binding contract between the Worker (`worker/`) and the frontend. Change it only together with both sides.
UI language stays English, like the rest of the app.

## General

- Same origin: frontend and API are served by one Cloudflare Worker. All API paths start with `/api/`.
- Auth uses the Better Auth session cookie (HttpOnly, Secure, SameSite=Lax). The frontend always sends `credentials: 'same-origin'` and never stores tokens itself.
- Requests and responses are JSON (`Content-Type: application/json`), except where noted.
- Errors: `{"error": "<code>", "message": "<human readable>"}` with a matching HTTP status.
  Shared codes: `unauthenticated` (401), `forbidden` (403), `not_found` (404), `invalid_request` (400), `payload_too_large` (413), `rate_limited` (429), `internal` (500).
- Writing requests (`POST/PUT/PATCH/DELETE`) without a matching `Origin` header are rejected with 403.
- Availability check: if `GET /api/health` fails (for example on GitHub Pages, where no API exists), the frontend hides all account features and works as before.

`GET /api/health` → `200 {"status":"ok","version":"<git hash or dev>"}`

## Authentication (Better Auth, mounted at `/api/auth`)

Sign-in has two factors: password, then a 6-digit code sent by email. There is no authenticator app.
Every account has two-factor enabled automatically when it is created. A password alone never produces a usable session.

Bot protection: `sign-up/email`, `sign-in/email` and `request-password-reset` need a Cloudflare Turnstile token in the header `x-captcha-response`. The public site key comes from `GET /api/config`.

`GET /api/config` → `200 {"turnstileSiteKey":"<key>"}`

| Step | Request | Response |
|---|---|---|
| Register | `POST /api/auth/sign-up/email` `{"email","password","name","callbackURL":"/?verified=1"}` | `200`. A verification link goes out by email. Sign-in is refused until the address is verified. |
| Verify email | user clicks the link (`GET /api/auth/verify-email?token=…&callbackURL=…`) | redirect to `/?verified=1` |
| Resend verification | `POST /api/auth/send-verification-email` `{"email","callbackURL":"/?verified=1"}` | `200` |
| Sign in, factor 1 | `POST /api/auth/sign-in/email` `{"email","password","rememberMe":true}` | `200 {"twoFactorRedirect":true}`. The server sends the code by email in the same step or the client calls send-otp, see next row. Unverified email: `403` with code `EMAIL_NOT_VERIFIED`. |
| Send / resend code | `POST /api/auth/two-factor/send-otp` `{}` | `200`. Code: 6 digits, valid 10 minutes, single use. |
| Sign in, factor 2 | `POST /api/auth/two-factor/verify-otp` `{"code":"123456","trustDevice":true}` | `200` with session cookie. `trustDevice` skips the code on this browser for 30 days. Wrong code: `401`. More than 5 wrong attempts invalidate the code. |
| Session | `GET /api/auth/get-session` | `200 {"user":{…},"session":{…}}` or `200 null` |
| Sign out | `POST /api/auth/sign-out` `{}` | `200` |
| Sign out everywhere | `POST /api/auth/revoke-sessions` `{}` | `200` |
| Forgot password | `POST /api/auth/request-password-reset` `{"email","redirectTo":"/?reset=1"}` | `200` (also when the email is unknown) |
| Set new password | `POST /api/auth/reset-password` `{"newPassword","token"}` (token from the `?token=` query parameter of the reset link) | `200`; all sessions are revoked |

Password rules: 10–128 characters. Rate limits (per IP): sign-in, send-otp, verify-otp and password reset at most 5 per minute; sign-up at most 3 per minute.

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

`PUT /api/me` `{"riderName"?: string 1–40, "ftp"?: integer 50–500, "hrConsent"?: true|false}` → `200` with the same shape as `GET`.
`hrConsent: true` sets `hrConsentAt` to now. `false` sets it to `null`; heart-rate data already stored stays until the user deletes those rides.

`GET /api/me/export` → `200`, `Content-Disposition: attachment; filename="cadence-export.json"`, body `{"exportedAt","user","profile","rides":[<ride detail>…]}`

`DELETE /api/me` `{"password":"…"}` → `200`. Deletes the user, sessions, profile and all rides. Wrong password: `403`.

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
- `samples`: `[elapsedSeconds:int, power:int, heartRate:int, cadence:int]`, at most 1 per second, sorted by time. The client reduces higher recording rates to 1 Hz (last value per second). Missing values are `0`.
- Limits: 1–43,200 samples (12 h), request body at most 2 MB, `workoutName` at most 100 characters, `ftp` 50–500 or `null`, power 0–3,000, heart rate 0–250, cadence 0–250.
- Heart-rate consent: if any sample has heart rate > 0 and the profile has no `hrConsentAt`, the server answers `428 {"error":"hr_consent_required"}`. The client asks for consent, sends `PUT /api/me {"hrConsent":true}` and retries the upload.

Responses: `201 <ride summary>` (new), `200 <ride summary>` (already stored), `409 {"error":"conflict"}` (the `id` belongs to another user), `400`, `413`, `428`.

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
- `np` = 4th root of the mean of (30 s rolling mean of power)^4. Zeros count. `null` below 30 samples.
- `tss` = `durationS × np × IF / (ftp × 3600) × 100` with `IF = np / ftp`, rounded to 1 decimal. `null` without `ftp` or `np`.

### List, detail, export, delete

`GET /api/rides?limit=20&cursor=<opaque>` → `200 {"rides":[<summary>…],"nextCursor":"<opaque>|null"}`, newest first, `limit` 1–100.

`GET /api/rides/:id` → `200 {<summary>, "samples":[[t,p,hr,cad]…]}`, `404` if the ride does not exist or belongs to another user.

`GET /api/rides/:id/tcx` → `200`, `Content-Type: application/vnd.garmin.tcx+xml`, `Content-Disposition: attachment; filename="cadence-<date>.tcx"`. Same TCX structure as `WorkoutRecorder.exportTCX()`.

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
`weeks`: the last 12 ISO weeks (Monday start, UTC), oldest first, including empty weeks.
