-- Grok joins Codex and Claude as a session provider. SQLite cannot alter a
-- CHECK constraint in place, so every provider-constrained table is rebuilt
-- (the 008 pattern). The migration runner disables foreign_keys around
-- migrations, so dropping the old tables does not cascade into children and
-- the child tables' REFERENCES clauses keep pointing at the reused names.

CREATE TABLE agent_sessions_new (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude', 'grok')),
  title TEXT,
  cwd TEXT NOT NULL,
  model TEXT,
  runtime_mode TEXT NOT NULL DEFAULT 'full_access' CHECK (runtime_mode IN ('full_access', 'default')),
  permission_mode TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_activation', 'ready', 'running', 'waiting', 'stopped', 'error')),
  activated_at TEXT,
  provider_session_id TEXT,
  provider_thread_id TEXT,
  resume_cursor_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_mcp_servers_json TEXT
);

INSERT INTO agent_sessions_new (
  id, provider, title, cwd, model, runtime_mode, permission_mode, status,
  activated_at, provider_session_id, provider_thread_id, resume_cursor_json,
  last_error, created_at, updated_at, disabled_mcp_servers_json
)
SELECT
  id, provider, title, cwd, model, runtime_mode, permission_mode, status,
  activated_at, provider_session_id, provider_thread_id, resume_cursor_json,
  last_error, created_at, updated_at, disabled_mcp_servers_json
FROM agent_sessions;

DROP TABLE agent_sessions;
ALTER TABLE agent_sessions_new RENAME TO agent_sessions;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_activated_at
ON agent_sessions (activated_at DESC, updated_at DESC)
WHERE activated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_status
ON agent_sessions (status, updated_at DESC);

CREATE TABLE agent_events_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES agent_turns(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude', 'grok')),
  event_type TEXT NOT NULL,
  stream_kind TEXT,
  raw_source TEXT,
  raw_json TEXT,
  canonical_json TEXT,
  created_at TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  status TEXT
);

INSERT INTO agent_events_new (
  id, session_id, turn_id, provider, event_type, stream_kind, raw_source,
  raw_json, canonical_json, created_at, title, summary, status
)
SELECT
  id, session_id, turn_id, provider, event_type, stream_kind, raw_source,
  raw_json, canonical_json, created_at, title, summary, status
FROM agent_events;

DROP TABLE agent_events;
ALTER TABLE agent_events_new RENAME TO agent_events;

CREATE INDEX IF NOT EXISTS idx_agent_events_session_created
ON agent_events (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_agent_events_turn
ON agent_events (turn_id);

CREATE TABLE agent_turn_checkpoints_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude', 'grok')),
  cwd TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('baseline', 'ready', 'skipped', 'error')),
  baseline_commit TEXT,
  completed_commit TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, turn_id)
);

INSERT INTO agent_turn_checkpoints_new (
  id, session_id, turn_id, provider, cwd, status, baseline_commit,
  completed_commit, error, created_at, updated_at
)
SELECT
  id, session_id, turn_id, provider, cwd, status, baseline_commit,
  completed_commit, error, created_at, updated_at
FROM agent_turn_checkpoints;

DROP TABLE agent_turn_checkpoints;
ALTER TABLE agent_turn_checkpoints_new RENAME TO agent_turn_checkpoints;

CREATE INDEX IF NOT EXISTS idx_agent_turn_checkpoints_turn
ON agent_turn_checkpoints (turn_id);
