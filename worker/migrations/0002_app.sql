-- App tables. 0001 holds the Better Auth tables (user, session, account, verification, twoFactor).

CREATE TABLE profile (
    user_id       TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    rider_name    TEXT,
    ftp           INTEGER,
    hr_consent_at TEXT
);

CREATE TABLE ride (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    started_at    TEXT NOT NULL,
    duration_s    INTEGER NOT NULL,
    workout_name  TEXT,
    ftp           INTEGER,
    avg_power     INTEGER,
    max_power     INTEGER,
    avg_hr        INTEGER,
    max_hr        INTEGER,
    avg_cadence   INTEGER,
    work_kj       INTEGER,
    np            INTEGER,
    tss           REAL,
    group_session INTEGER NOT NULL DEFAULT 0,
    samples_gz    BLOB NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX ride_user_started ON ride (user_id, started_at DESC, id DESC);
