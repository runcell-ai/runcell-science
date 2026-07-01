CREATE TABLE IF NOT EXISTS _open_science_metadata (
  key TEXT NOT NULL PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO _open_science_metadata (key, value)
VALUES ('schema_version', '0.1.0')
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = datetime('now');
