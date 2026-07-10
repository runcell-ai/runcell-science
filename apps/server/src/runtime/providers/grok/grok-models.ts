import { config } from '../../../config/env'
import { sanitizedProcessEnv } from '../../env-utils'
import { GrokAcpClient } from './acp-client'
import type { AcpInitializeResponse, AcpModelInfo, AcpSessionSetupResponse } from './acp-types'
import { resolveGrokAuthMethodId } from './grok-runtime'

export interface GrokModelCatalog {
  currentModelId: string | null
  models: AcpModelInfo[]
}

// Each probe spawns a fresh grok process and leaves a session behind in the
// user's ~/.grok session list, so successful catalogs are cached and
// concurrent callers share one in-flight probe.
const CATALOG_CACHE_TTL_MS = 5 * 60_000

let cachedCatalog: { catalog: GrokModelCatalog; fetchedAt: number } | null = null
let inflightProbe: Promise<GrokModelCatalog> | null = null

/**
 * Grok has no standalone model-list RPC; the catalog comes from the
 * session/new setup response. This spins up a throwaway ACP session and tears
 * it down immediately.
 * `timeoutMs` is one overall deadline shared by the whole handshake, not a
 * per-request budget — /api/models awaits every provider, so a wedged grok
 * must not stall the catalog for multiples of the timeout.
 */
export async function fetchGrokModelCatalog(timeoutMs: number): Promise<GrokModelCatalog> {
  if (cachedCatalog && Date.now() - cachedCatalog.fetchedAt < CATALOG_CACHE_TTL_MS) {
    return cachedCatalog.catalog
  }

  if (!inflightProbe) {
    inflightProbe = probeGrokModelCatalog(timeoutMs)
      .then((catalog) => {
        cachedCatalog = { catalog, fetchedAt: Date.now() }
        return catalog
      })
      .finally(() => {
        inflightProbe = null
      })
  }
  return inflightProbe
}

/** Test hook: reset module-level cache state. */
export function clearGrokModelCatalogCache(): void {
  cachedCatalog = null
  inflightProbe = null
}

async function probeGrokModelCatalog(timeoutMs: number): Promise<GrokModelCatalog> {
  const deadline = Date.now() + timeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())

  const env = { ...sanitizedProcessEnv(), GROK_OAUTH2_REFERRER: 'open-science' }
  const client = new GrokAcpClient({
    binaryPath: config.grokBinaryPath,
    cwd: config.agentDefaultCwd,
    env
  })
  // Swallow transport-level errors: request() rejections carry the failure and
  // an unhandled 'error' emit would crash the process.
  client.on('error', () => {})

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
}
