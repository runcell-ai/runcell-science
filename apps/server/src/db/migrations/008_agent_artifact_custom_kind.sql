CREATE TABLE agent_artifact_state_backup AS
SELECT *
FROM agent_artifact_state;

DROP TABLE agent_artifact_state;

CREATE TABLE agent_artifacts_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES agent_turns(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES agent_messages(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf', 'markdown', 'html', 'custom', 'url')),
  source TEXT NOT NULL CHECK (source IN ('file', 'url')),
  path TEXT,
  url TEXT,
  title TEXT,
  renderer_key TEXT,
  media_type TEXT,
  metadata_json TEXT,
  editable INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (source = 'file' AND kind IN ('image', 'pdf', 'markdown', 'html', 'custom') AND path IS NOT NULL AND url IS NULL)
    OR
    (source = 'url' AND kind = 'url' AND path IS NULL AND url IS NOT NULL)
  )
);

INSERT INTO agent_artifacts_new (
  id,
  session_id,
  turn_id,
  message_id,
  kind,
  source,
  path,
  url,
  title,
  renderer_key,
  media_type,
  metadata_json,
  editable,
  created_at,
  updated_at
)
SELECT
  id,
  session_id,
  turn_id,
  message_id,
  kind,
  source,
  path,
  url,
  title,
  renderer_key,
  media_type,
  metadata_json,
  editable,
  created_at,
  updated_at
FROM agent_artifacts;

DROP TABLE agent_artifacts;
ALTER TABLE agent_artifacts_new RENAME TO agent_artifacts;

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_session_created
ON agent_artifacts (session_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_artifacts_session_file
ON agent_artifacts (session_id, path)
WHERE source = 'file';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_artifacts_session_url
ON agent_artifacts (session_id, url)
WHERE source = 'url';

CREATE TABLE agent_artifact_state (
  artifact_id TEXT PRIMARY KEY REFERENCES agent_artifacts(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO agent_artifact_state (
  artifact_id,
  session_id,
  state_json,
  created_at,
  updated_at
)
SELECT
  artifact_id,
  session_id,
  state_json,
  created_at,
  updated_at
FROM agent_artifact_state_backup;

DROP TABLE agent_artifact_state_backup;

CREATE INDEX IF NOT EXISTS idx_agent_artifact_state_session
ON agent_artifact_state (session_id);
