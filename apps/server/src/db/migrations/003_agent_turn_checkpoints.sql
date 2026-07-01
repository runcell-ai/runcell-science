CREATE TABLE IF NOT EXISTS agent_turn_checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
  cwd TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('baseline', 'ready', 'skipped', 'error')),
  baseline_commit TEXT,
  completed_commit TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, turn_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_turn_checkpoints_turn
ON agent_turn_checkpoints (turn_id);
