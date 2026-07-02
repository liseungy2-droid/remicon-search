CREATE TABLE IF NOT EXISTS remicon_companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT DEFAULT '',
  capacity TEXT DEFAULT '',
  trucks INTEGER DEFAULT 0,
  lat REAL,
  lng REAL,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
