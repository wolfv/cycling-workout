-- Better Auth tables for the plugins in use: core, twoFactor (e-mail OTP) and database-backed rate limiting.
-- Derived from Better Auth 1.7.15's schema (see test/schema.test.js, which fails if this file drifts from it).
-- Types follow Better Auth's SQLite mapping: string -> TEXT, boolean/number -> INTEGER, date -> DATE.

CREATE TABLE "user" (
    "id"               TEXT NOT NULL PRIMARY KEY,
    "name"             TEXT NOT NULL,
    "email"            TEXT NOT NULL UNIQUE,
    "emailVerified"    INTEGER NOT NULL,
    "image"            TEXT,
    "createdAt"        DATE NOT NULL,
    "updatedAt"        DATE NOT NULL,
    "twoFactorEnabled" INTEGER
);

CREATE TABLE "session" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATE NOT NULL,
    "token"     TEXT NOT NULL UNIQUE,
    "createdAt" DATE NOT NULL,
    "updatedAt" DATE NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId"    TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");

CREATE TABLE "account" (
    "id"                    TEXT NOT NULL PRIMARY KEY,
    "accountId"             TEXT NOT NULL,
    "providerId"            TEXT NOT NULL,
    "userId"                TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "accessToken"           TEXT,
    "refreshToken"          TEXT,
    "idToken"               TEXT,
    "accessTokenExpiresAt"  DATE,
    "refreshTokenExpiresAt" DATE,
    "scope"                 TEXT,
    "password"              TEXT,
    "createdAt"             DATE NOT NULL,
    "updatedAt"             DATE NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");

CREATE TABLE "verification" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value"      TEXT NOT NULL,
    "expiresAt"  DATE NOT NULL,
    "createdAt"  DATE NOT NULL,
    "updatedAt"  DATE NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");

-- Two-factor plugin. With e-mail OTP only, this table stays empty (it holds TOTP secrets / backup codes);
-- it exists because the plugin's schema requires it. ON DELETE CASCADE added so deleting a user cleans it up.
CREATE TABLE "twoFactor" (
    "id"                      TEXT NOT NULL PRIMARY KEY,
    "secret"                  TEXT NOT NULL,
    "backupCodes"             TEXT NOT NULL,
    "userId"                  TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
    "verified"                INTEGER,
    "failedVerificationCount" INTEGER,
    "lockedUntil"             DATE
);
CREATE INDEX "twoFactor_secret_idx" ON "twoFactor" ("secret");
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor" ("userId");

-- Better Auth rate limiting (storage: "database"), shared by all Worker isolates.
-- Also used by src/limits.js for the password check on DELETE /api/me.
CREATE TABLE "rateLimit" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "key"         TEXT NOT NULL UNIQUE,
    "count"       INTEGER NOT NULL,
    "lastRequest" INTEGER NOT NULL
);
