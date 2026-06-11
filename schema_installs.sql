-- PWA install tracking (one row per distinct device_id)
CREATE TABLE IF NOT EXISTS installs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT UNIQUE NOT NULL,
  user_id INTEGER,
  user_agent TEXT,
  platform TEXT,           -- ios / android / desktop / other
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_installs_user ON installs(user_id);
CREATE INDEX IF NOT EXISTS idx_installs_created ON installs(created_at);
