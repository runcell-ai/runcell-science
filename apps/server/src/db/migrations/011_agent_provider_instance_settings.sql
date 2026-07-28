CREATE TABLE agent_provider_instance_settings (
  instance_id TEXT PRIMARY KEY,
  driver TEXT NOT NULL,
  binary_path_override TEXT,
  config_home_override TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
