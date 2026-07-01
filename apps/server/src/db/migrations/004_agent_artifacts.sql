CREATE TABLE IF NOT EXISTS agent_artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES agent_turns(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES agent_messages(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image', 'pdf', 'markdown', 'html', 'url')),
  source TEXT NOT NULL CHECK (source IN ('file', 'url')),
  path TEXT,
  url TEXT,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (source = 'file' AND kind IN ('image', 'pdf', 'markdown', 'html') AND path IS NOT NULL AND url IS NULL)
    OR
    (source = 'url' AND kind = 'url' AND path IS NULL AND url IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_session_created
ON agent_artifacts (session_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_artifacts_session_file
ON agent_artifacts (session_id, path)
WHERE source = 'file';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_artifacts_session_url
ON agent_artifacts (session_id, url)
WHERE source = 'url';
