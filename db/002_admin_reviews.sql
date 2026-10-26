-- 002: admin + SS Reviews
ALTER TABLE submissions ADD COLUMN source TEXT DEFAULT 'web';
ALTER TABLE submissions ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE submissions ADD COLUMN notes TEXT;

CREATE TABLE IF NOT EXISTS sms_optouts (
  phone TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS rv_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rv_codes (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  client_id INTEGER REFERENCES rv_clients(id),
  target_url TEXT NOT NULL,
  fallback_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rv_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  ts TEXT NOT NULL,
  country TEXT,
  device TEXT,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS idx_rv_scans_code_ts ON rv_scans(code, ts);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT
);

-- 003: link preview (Open Graph) per QR
ALTER TABLE rv_codes ADD COLUMN og_title TEXT;
ALTER TABLE rv_codes ADD COLUMN og_description TEXT;
ALTER TABLE rv_codes ADD COLUMN og_image TEXT;

-- 004: soft delete for QR codes (codes are never reused)
ALTER TABLE rv_codes ADD COLUMN deleted_at TEXT;
