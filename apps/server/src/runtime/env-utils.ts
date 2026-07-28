import path from 'node:path'

import { config } from '../config/env'

export function agentIntegrationEnv(sessionId?: string): NodeJS.ProcessEnv {
  return {
    OPEN_SCIENCE_API_URL: `http://127.0.0.1:${config.port}`,
    OPEN_SCIENCE_NBCLI: path.join(config.workspaceRoot, 'packages/nbcli/nbcli.mjs'),
    ...(sessionId ? { OPEN_SCIENCE_SESSION_ID: sessionId } : {})
  }
}
