import { config } from '../../../config/env'
import {
  agentProviderConfigService,
  requireAgentProviderExecutable
} from '../../../services/agent-provider-config-service'
import { GenerationBoundProbeCache, type CancelableProbe } from '../../generation-bound-probe-cache'
import { GrokAcpClient } from './acp-client'
import type { AcpInitializeResponse, AcpModelInfo, AcpSessionSetupResponse } from './acp-types'
import { resolveGrokAuthMethodId } from './grok-auth'

export interface GrokModelCatalog {
  currentModelId: string | null
  models: AcpModelInfo[]
}

// Each probe spawns a fresh grok process and leaves a session behind in the
// user's ~/.grok session list, so successful catalogs are cached and
// concurrent callers share one in-flight probe.
const CATALOG_CACHE_TTL_MS = 5 * 60_000

const catalogCache = new GenerationBoundProbeCache<GrokModelCatalog>()

/**
 * Grok has no standalone model-list RPC; the catalog comes from the
 * session/new setup response. This spins up a throwaway ACP session and tears
 * it down immediately.
 * `timeoutMs` is one overall deadline shared by the whole handshake, not a
 * per-request budget — /api/models awaits every provider, so a wedged grok
 * must not stall the catalog for multiples of the timeout.
 */
export async function fetchGrokModelCatalog(timeoutMs: number): Promise<GrokModelCatalog> {
  return catalogCache.get(
    CATALOG_CACHE_TTL_MS,
    () => createGrokModelCatalogProbe(timeoutMs)
  )
}

/** Test hook: reset module-level cache state. */
export function clearGrokModelCatalogCache(): void {
  catalogCache.clear()
}

function createGrokModelCatalogProbe(timeoutMs: number): CancelableProbe<GrokModelCatalog> {
  const deadline = Date.now() + timeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())
  const providerConfig = agentProviderConfigService.resolve('grok')

  const env = { ...providerConfig.env, GROK_OAUTH2_REFERRER: 'open-science' }
  const client = new GrokAcpClient({
    binaryPath: requireAgentProviderExecutable(providerConfig),
    cwd: config.agentDefaultCwd,
    env
  })
  // Swallow transport-level errors: request() rejections carry the failure and
  // an unhandled 'error' emit would crash the process.
  client.on('error', () => {})

  const promise = (async () => {
    try {
      await client.request<AcpInitializeResponse>('initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'open_science', title: 'Runcell Science', version: '0.1.0' },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }
      }, remaining())
      await client.request('authenticate', { methodId: resolveGrokAuthMethodId(env) }, remaining())
      const setup = await client.request<AcpSessionSetupResponse>('session/new', {
        cwd: config.agentDefaultCwd,
        mcpServers: []
      }, remaining())

      return {
        currentModelId: setup.models?.currentModelId?.trim() || null,
        models: setup.models?.availableModels ?? []
      }
    } finally {
      client.dispose()
    }
  })()

  return {
    promise,
    cancel: () => client.dispose()
  }
}

agentProviderConfigService.onChange((instanceId) => {
  if (instanceId === 'grok') {
    clearGrokModelCatalogCache()
  }
})
