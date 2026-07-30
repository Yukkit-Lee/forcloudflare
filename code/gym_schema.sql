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
