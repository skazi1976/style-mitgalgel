-- Push campaigns: every broadcast or per-item push gets one row
CREATE TABLE IF NOT EXISTS push_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL,              -- 'broadcast' | 'new_item'
  title TEXT,
  body TEXT,
  url TEXT,
  category TEXT,
  total_count INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_campaigns_created ON push_campaigns(created_at DESC);

-- Push clicks: one row per click on a notification
CREATE TABLE IF NOT EXISTS push_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  user_id INTEGER,                 -- nullable: anon users
  url TEXT,
  user_agent TEXT,
  clicked_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_clicks_campaign ON push_clicks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_push_clicks_user ON push_clicks(user_id);
CREATE INDEX IF NOT EXISTS idx_push_clicks_time ON push_clicks(clicked_at DESC);
