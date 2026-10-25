-- D1 database: samservices-contact (binding DB)
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  lang TEXT,
  name TEXT,
  email TEXT,
  company TEXT,
  phone TEXT,
  message TEXT,
  estimate TEXT,
  sms_care INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT,
  consent_text TEXT,
  ip TEXT,
  user_agent TEXT,
  referer TEXT
);
CREATE INDEX IF NOT EXISTS idx_submissions_phone ON submissions(phone);
