import path from 'node:path'

import { config } from '../config/env'

const AGENT_HOME_ENV_KEYS = ['CODEX_HOME', 'CLAUDE_CONFIG_DIR'] as const

/**
 * Copy of process.env safe to hand to agent subprocesses. Empty-string values
 * for agent home variables behave as set-but-broken downstream (codex resolves
 * CODEX_HOME='' relative to its cwd instead of falling back to ~/.codex), so
 * they are treated as unset here.
 */
export function sanitizedProcessEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of AGENT_HOME_ENV_KEYS) {
    const value = env[key]
    if (value !== undefined && value.trim() === '') {
      delete env[key]
    }
  }
  return env
}

export function agentIntegrationEnv(sessionId?: string): NodeJS.ProcessEnv {
  return {
    OPEN_SCIENCE_API_URL: `http://127.0.0.1:${config.port}`,
    OPEN_SCIENCE_NBCLI: path.join(config.workspaceRoot, 'packages/nbcli/nbcli.mjs'),
    ...(sessionId ? { OPEN_SCIENCE_SESSION_ID: sessionId } : {})
  }
}
