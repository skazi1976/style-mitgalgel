-- Web Push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,                 -- nullable: allow anon subs
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  categories TEXT,                 -- JSON array of interested categories, null = all
  created_at INTEGER NOT NULL,
  last_used INTEGER NOT NULL,
  failures INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscriptions(endpoint);
