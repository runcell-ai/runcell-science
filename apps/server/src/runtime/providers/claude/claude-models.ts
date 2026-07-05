import { query, type ModelInfo, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import { config } from '../../../config/env'
import { agentIntegrationEnv, sanitizedProcessEnv } from '../../env-utils'

/**
 * Claude Code exposes its model catalog only as a control request on a live
 * `query()` session (there is no stateless RPC like Codex's `model/list`). The
 * list ships inside the `initialize` handshake, so `supportedModels()` resolves
 * as soon as the CLI connects — we never send a turn. Spawning the CLI costs a
 * couple of seconds, so results are cached with a short TTL and concurrent calls
 * share one in-flight probe.
 */

const CACHE_TTL_MS = 5 * 60_000
const DEFAULT_TIMEOUT_MS = 15_000

let cache: { fetchedAt: number; models: ModelInfo[] } | null = null
let inflight: Promise<ModelInfo[]> | null = null

/**
 * A streaming input that stays open (yielding nothing) until the query is
 * aborted. Streaming-input mode is required for control requests, and keeping it
 * open lets the CLI initialize without ever running a user turn.
 */
function idleInput(signal: AbortSignal): AsyncIterable<SDKUserMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      if (signal.aborted) {
        return
      }
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
  }
}

async function probeSupportedModels(timeoutMs: number): Promise<ModelInfo[]> {
  const abortController = new AbortController()

  const options: Options = {
    cwd: config.agentDefaultCwd,
    abortController,
    pathToClaudeCodeExecutable: config.claudeCodeBinaryPath,
    // Match the runtime so the same auth/config/MCP surface (and thus the same
    // entitlement-gated model list) is resolved.
    settingSources: ['user', 'project', 'local'],
    permissionMode: config.claudePermissionMode,
    allowDangerouslySkipPermissions: config.claudeAllowDangerouslySkipPermissions,
    env: {
      ...sanitizedProcessEnv(),
      ...agentIntegrationEnv(),
      CLAUDE_AGENT_SDK_CLIENT_APP: 'open-science/0.1.0',
      ...(config.claudeConfigDir ? { CLAUDE_CONFIG_DIR: config.claudeConfigDir } : {})
    }
  }

  const session = query({ prompt: idleInput(abortController.signal), options })

  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Claude model list timed out after ${timeoutMs}ms`)), timeoutMs)
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref()
    }
  })

  try {
    return await Promise.race([session.supportedModels(), timeout])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
    abortController.abort()
    session.close()
    try {
      await session.return?.(undefined)
    } catch {
      /* the CLI is being torn down; ignore */
    }
  }
}

export async function fetchClaudeSupportedModels(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ModelInfo[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.models
  }
  if (inflight) {
    return inflight
  }

  inflight = probeSupportedModels(timeoutMs)
    .then((models) => {
      cache = { fetchedAt: Date.now(), models }
      return models
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}
