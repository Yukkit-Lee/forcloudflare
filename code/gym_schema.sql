CREATE TABLE IF NOT EXISTS gym_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sampled_at TEXT NOT NULL UNIQUE,
    sample_date TEXT NOT NULL,
    online_count INTEGER NOT NULL CHECK (online_count >= 0),
    source TEXT NOT NULL DEFAULT 'worker-cron',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gym_samples_date_time
    ON gym_samples(sample_date, sampled_at);

CREATE TABLE IF NOT EXISTS gym_api_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requested_at TEXT NOT NULL,
    request_date TEXT NOT NULL,
    request_type TEXT NOT NULL,
    upstream_status INTEGER,
    success INTEGER NOT NULL CHECK (success IN (0, 1)),
    duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gym_api_logs_date_time
    ON gym_api_logs(request_date, requested_at DESC);
