CREATE TABLE IF NOT EXISTS bundled_science_connector_enablement (
  connector_name TEXT NOT NULL,
  cwd TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (connector_name, cwd)
);
