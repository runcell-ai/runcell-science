CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
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
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_activated_at
ON agent_sessions (activated_at DESC, updated_at DESC)
WHERE activated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_status
ON agent_sessions (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  provider_turn_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'interrupted')),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_turns_session_requested
ON agent_turns (session_id, requested_at ASC);

CREATE INDEX IF NOT EXISTS idx_agent_turns_session_status
ON agent_turns (session_id, status);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES agent_turns(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'streaming', 'completed', 'failed')),
  provider_item_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session_created
ON agent_messages (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_agent_messages_turn
ON agent_messages (turn_id);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES agent_turns(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
  event_type TEXT NOT NULL,
  stream_kind TEXT,
  raw_source TEXT,
  raw_json TEXT,
  canonical_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_events_session_created
ON agent_events (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_agent_events_turn
ON agent_events (turn_id);

CREATE TABLE IF NOT EXISTS agent_pending_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  title TEXT,
  payload_json TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_pending_requests_session_status
ON agent_pending_requests (session_id, status, created_at ASC);
