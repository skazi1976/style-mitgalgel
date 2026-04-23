-- Style Mitgalgel — C2C Fashion Marketplace Schema
-- Run with: wrangler d1 execute style_mitgalgel --file=schema.sql

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL,
  items_listed INTEGER DEFAULT 0,
  items_sold INTEGER DEFAULT 0,
  rating REAL DEFAULT 5.0,
  rating_count INTEGER DEFAULT 0,
  banned INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- Items (products for sale)
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,           -- in shekels (no decimals)
  brand TEXT,
  size TEXT,
  category TEXT NOT NULL,           -- dress / pants / shoes / bag / etc.
  condition TEXT NOT NULL,          -- new / like_new / good / fair
  photos TEXT NOT NULL,             -- JSON array of R2 URLs
  city TEXT,
  status TEXT DEFAULT 'active',     -- active / sold / hidden
  views INTEGER DEFAULT 0,
  favorites_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  sold_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at DESC);

-- Favorites (heart)
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (item_id) REFERENCES items(id)
);

-- OTP codes (phone verification via WhatsApp)
CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER DEFAULT 0
);

-- Sessions (logged-in users)
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Reports (abuse)
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER,
  item_id INTEGER,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved INTEGER DEFAULT 0
);
