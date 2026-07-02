import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type {
  ListMcpServersResponse,
  McpScope,
  McpServerStatusKind,
  McpServerToolSummary,
  McpServerView,
  McpTransport
} from '@open-science/contracts'

import { config } from '../config/env'
import { sanitizedProcessEnv } from '../runtime/env-utils'
import { CodexJsonRpcClient } from '../runtime/providers/codex/json-rpc-client'
import type { ListMcpServerStatusResponse } from '../runtime/providers/codex/generated/v2/ListMcpServerStatusResponse'
import type { ConfigReadResponse } from '../runtime/providers/codex/generated/v2/ConfigReadResponse'

const INIT_TIMEOUT_MS = 60_000
// mcpServerStatus/list blocks until all configured servers finish their
// startup handshake on the first call, so it gets a generous budget.
const STATUS_TIMEOUT_MS = 90_000
const CONFIG_TIMEOUT_MS = 15_000
const STATUS_CACHE_TTL_MS = 30_000

interface RawMcpServerEntry {
  type?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
  [key: string]: unknown
}

interface CodexStartupStatus {
  state: string
  error: string | null
}

interface CodexStatusEntry {
  authStatus: string
  tools: McpServerToolSummary[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inferTransport(entry: RawMcpServerEntry): McpTransport {
  if (entry.type === 'sse') {
    return 'sse'
  }
  if (entry.type === 'http' || (!entry.type && typeof entry.url === 'string')) {
    return 'http'
  }
  if (entry.type === 'stdio' || typeof entry.command === 'string') {
    return 'stdio'
  }
  return typeof entry.url === 'string' ? 'http' : 'stdio'
}

function toRawEntry(value: unknown): RawMcpServerEntry | null {
  return isRecord(value) ? (value as RawMcpServerEntry) : null
}

/**
 * Read-side MCP inventory. Native provider configs are the single source of
 * truth: Codex entries come from the app-server management connection
 * (config/read + mcpServerStatus/list), Claude entries from parsing
 * `.claude.json` and project `.mcp.json`. Failures degrade to warnings so a
 * broken provider never blanks the whole inventory (fallback principle).
 */
export class McpManagementService {
  private client: CodexJsonRpcClient | null = null
  private clientInit: Promise<CodexJsonRpcClient> | null = null
  private readonly startupStatus = new Map<string, CodexStartupStatus>()
  private statusCache: { at: number; entries: Map<string, CodexStatusEntry> } | null = null

  async listServers(input: { cwd?: string; refresh?: boolean }): Promise<ListMcpServersResponse> {
    const warnings: string[] = []
    const servers: McpServerView[] = []

    const codexServers = await this.listCodexServers(input.refresh === true).catch((error) => {
      warnings.push(`Codex inventory unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return [] as McpServerView[]
    })
    servers.push(...codexServers)

    servers.push(...this.listClaudeServers(input.cwd, warnings))

    return { servers, warnings }
  }

  dispose(): void {
    this.client?.dispose()
    this.client = null
    this.clientInit = null
  }

  // ---------------------------------------------------------------- codex --

  private async ensureCodexClient(): Promise<CodexJsonRpcClient> {
    if (this.client) {
      return this.client
    }
    if (this.clientInit) {
      return this.clientInit
    }

    this.clientInit = (async () => {
      const client = new CodexJsonRpcClient({
        binaryPath: config.codexBinaryPath,
        env: {
          ...sanitizedProcessEnv(),
          ...(config.codexHome ? { CODEX_HOME: config.codexHome } : {})
        }
      })
      client.on('error', () => {})
      client.on('notification', (message) => {
        const m = message as { method?: string; params?: { name?: string; status?: string; error?: string | null } }
        if (m.method === 'mcpServer/startupStatus/updated' && m.params?.name && m.params.status) {
          this.startupStatus.set(m.params.name, {
            state: m.params.status,
            error: m.params.error ?? null
          })
        }
      })
      client.on('exit', () => {
        if (this.client === client) {
          this.client = null
          this.statusCache = null
        }
      })

      await client.request(
        'initialize',
        {
          clientInfo: { name: 'open_science_mcp_admin', title: 'Open Science', version: '0.1.0' },
          capabilities: { experimentalApi: true }
        },
        INIT_TIMEOUT_MS
      )
      client.notify('initialized', {})
      this.client = client
      return client
    })()

    try {
      return await this.clientInit
    } finally {
      this.clientInit = null
    }
  }

  async codexRequest<T>(method: string, params: unknown, timeoutMs: number = CONFIG_TIMEOUT_MS): Promise<T> {
    const client = await this.ensureCodexClient()
    return client.request<T>(method, params, timeoutMs)
  }

  invalidateCodexStatus(): void {
    this.statusCache = null
  }

  private async readCodexConfiguredServers(): Promise<Map<string, RawMcpServerEntry>> {
    const response = await this.codexRequest<ConfigReadResponse>('config/read', { includeLayers: false })
    const raw = (response.config as Record<string, unknown>)['mcp_servers']
    const entries = new Map<string, RawMcpServerEntry>()
    if (isRecord(raw)) {
      for (const [name, value] of Object.entries(raw)) {
        const entry = toRawEntry(value)
        if (entry) {
          entries.set(name, entry)
        }
      }
    }
    return entries
  }

  private async readCodexStatusEntries(refresh: boolean): Promise<Map<string, CodexStatusEntry>> {
    const now = Date.now()
    if (!refresh && this.statusCache && now - this.statusCache.at < STATUS_CACHE_TTL_MS) {
      return this.statusCache.entries
    }

    const entries = new Map<string, CodexStatusEntry>()
    let cursor: string | null = null
    do {
      const page: ListMcpServerStatusResponse = await this.codexRequest<ListMcpServerStatusResponse>(
        'mcpServerStatus/list',
        cursor ? { cursor } : {},
        STATUS_TIMEOUT_MS
      )
      for (const status of page.data) {
        entries.set(status.name, {
          authStatus: status.authStatus,
          tools: Object.entries(status.tools ?? {}).map(([name, tool]) => ({
            name,
            description: (tool as { description?: string } | undefined)?.description ?? null
          }))
        })
      }
      cursor = page.nextCursor
    } while (cursor)

    this.statusCache = { at: now, entries }
    return entries
  }

  private async listCodexServers(refresh: boolean): Promise<McpServerView[]> {
    const configured = await this.readCodexConfiguredServers()

    let statusEntries = new Map<string, CodexStatusEntry>()
    let statusError: string | null = null
    try {
      statusEntries = await this.readCodexStatusEntries(refresh)
    } catch (error) {
      statusError = error instanceof Error ? error.message : String(error)
    }

    const views: McpServerView[] = []
    for (const [name, entry] of configured) {
      const enabled = entry.enabled !== false
      const status = statusEntries.get(name)
      const startup = this.startupStatus.get(name)

      let statusKind: McpServerStatusKind = 'unknown'
      let statusDetail: string | null = statusError
      if (!enabled) {
        statusKind = 'disabled'
        statusDetail = null
      } else if (status) {
        statusKind = status.authStatus === 'notLoggedIn' ? 'needs_auth' : 'connected'
        statusDetail = null
      } else if (startup) {
        statusKind = startup.state === 'failed' || startup.state === 'cancelled' ? 'failed' : 'pending'
        statusDetail = startup.error
      }

      views.push({
        key: `codex:user:${name}`,
        name,
        provider: 'codex',
        scope: 'user',
        transport: inferTransport(entry),
        command: typeof entry.command === 'string' ? entry.command : null,
        args: Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === 'string') : [],
        url: typeof entry.url === 'string' ? entry.url : null,
        enabled,
        status: statusKind,
        statusDetail,
        tools: status?.tools ?? [],
        source: 'codex config.toml'
      })
    }

    return views
  }

  // --------------------------------------------------------------- claude --

  private claudeConfigJsonPath(): string {
    return config.claudeConfigDir
      ? path.join(config.claudeConfigDir, '.claude.json')
      : path.join(os.homedir(), '.claude.json')
  }

  private listClaudeServers(cwd: string | undefined, warnings: string[]): McpServerView[] {
    const views: McpServerView[] = []
    const configPath = this.claudeConfigJsonPath()

    let claudeJson: Record<string, unknown> | null = null
    try {
      if (fs.existsSync(configPath)) {
        claudeJson = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
      }
    } catch (error) {
      warnings.push(`Failed to read ${configPath}: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (claudeJson) {
      views.push(...this.claudeEntriesFrom(claudeJson['mcpServers'], 'user', configPath))

      if (cwd) {
        const projects = claudeJson['projects']
        if (isRecord(projects)) {
          const projectEntry = projects[cwd]
          if (isRecord(projectEntry)) {
            views.push(...this.claudeEntriesFrom(projectEntry['mcpServers'], 'local', configPath))
          }
        }
      }
    }

    if (cwd) {
      const mcpJsonPath = path.join(cwd, '.mcp.json')
      try {
        if (fs.existsSync(mcpJsonPath)) {
          const parsed = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8')) as Record<string, unknown>
          views.push(...this.claudeEntriesFrom(parsed['mcpServers'], 'project', mcpJsonPath))
        }
      } catch (error) {
        warnings.push(`Failed to read ${mcpJsonPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return views
  }

  private claudeEntriesFrom(raw: unknown, scope: McpScope, source: string): McpServerView[] {
    if (!isRecord(raw)) {
      return []
    }

    const views: McpServerView[] = []
    for (const [name, value] of Object.entries(raw)) {
      const entry = toRawEntry(value)
      if (!entry) {
        continue
      }

      views.push({
        key: `claude:${scope}:${name}`,
        name,
        provider: 'claude',
        scope,
        transport: inferTransport(entry),
        command: typeof entry.command === 'string' ? entry.command : null,
        args: Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === 'string') : [],
        url: typeof entry.url === 'string' ? entry.url : null,
        enabled: true,
        status: 'unknown',
        statusDetail: null,
        tools: [],
        source
      })
    }

    return views
  }
}

export const mcpManagementService = new McpManagementService()
