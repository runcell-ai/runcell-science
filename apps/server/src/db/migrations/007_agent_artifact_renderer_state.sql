ALTER TABLE agent_artifacts ADD COLUMN renderer_key TEXT;
ALTER TABLE agent_artifacts ADD COLUMN media_type TEXT;
ALTER TABLE agent_artifacts ADD COLUMN metadata_json TEXT;
ALTER TABLE agent_artifacts ADD COLUMN editable INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS agent_artifact_state (
  artifact_id TEXT PRIMARY KEY REFERENCES agent_artifacts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_artifact_state_session
ON agent_artifact_state (session_id);
