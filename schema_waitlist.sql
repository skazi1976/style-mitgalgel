CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT,
  email TEXT,
  name TEXT,
  city TEXT,
  source TEXT,
  user_agent TEXT,
  ip TEXT,
  notified INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_phone ON waitlist(phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at DESC);
