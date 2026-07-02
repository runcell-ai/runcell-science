import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  AgentProvider,
  ImportMcpServersResponse,
  ListMcpServersResponse,
  McpScope,
  McpServerConfigInput,
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

const execFileAsync = promisify(execFile)

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

export class McpManagementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'McpManagementError'
  }
}

// Names become codex config keyPath segments and shell arguments; keep them to
// a charset that cannot smuggle dotted paths or quoting.
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertValidServerName(name: string): void {
  if (!SERVER_NAME_PATTERN.test(name)) {
    throw new McpManagementError(
      'invalid_server_name',
      'Server name may only contain letters, digits, hyphens, and underscores.',
      400
    )
  }
}

function normalizeConfigInput(input: McpServerConfigInput): McpServerConfigInput {
  const hasCommand = typeof input.command === 'string' && input.command.trim().length > 0
  const hasUrl = typeof input.url === 'string' && input.url.trim().length > 0
  if (hasCommand === hasUrl) {
    throw new McpManagementError(
      'invalid_server_config',
      'Server config must provide exactly one of "command" or "url".',
      400
    )
  }

  const normalized: McpServerConfigInput = {}
  if (hasCommand) {
    normalized.type = 'stdio'
    normalized.command = input.command!.trim()
    normalized.args = Array.isArray(input.args) ? input.args.filter((a): a is string => typeof a === 'string') : []
    if (isRecord(input.env)) {
      normalized.env = Object.fromEntries(
        Object.entries(input.env).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>
    }
  } else {
    normalized.type = input.type === 'sse' ? 'sse' : 'http'
    normalized.url = input.url!.trim()
    if (isRecord(input.headers)) {
      normalized.headers = Object.fromEntries(
        Object.entries(input.headers).filter(([, v]) => typeof v === 'string')
      ) as Record<string, string>
    }
  }
  return normalized
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

  // --------------------------------------------------------------- writes --

  async addServer(input: { provider: AgentProvider; name: string; config: McpServerConfigInput }): Promise<void> {
    assertValidServerName(input.name)
    const normalized = normalizeConfigInput(input.config)

    if (input.provider === 'codex') {
      if (normalized.type === 'sse') {
        throw new McpManagementError('unsupported_transport', 'Codex does not support SSE MCP servers.', 400)
      }
      const value: Record<string, unknown> =
        normalized.type === 'stdio'
          ? {
              command: normalized.command,
              args: normalized.args ?? [],
              ...(normalized.env && Object.keys(normalized.env).length > 0 ? { env: normalized.env } : {})
            }
          : {
              url: normalized.url,
              ...(normalized.headers && Object.keys(normalized.headers).length > 0
                ? { http_headers: normalized.headers }
                : {})
            }
      await this.codexRequest('config/value/write', {
        keyPath: `mcp_servers.${input.name}`,
        value,
        mergeStrategy: 'upsert'
      })
      await this.reloadCodexMcpServers()
      return
    }

    await this.execClaudeMcp(['add-json', '-s', 'user', input.name, JSON.stringify(normalized)])
  }

  async removeServer(input: { provider: AgentProvider; scope: McpScope; name: string; cwd?: string }): Promise<void> {
    assertValidServerName(input.name)

    if (input.provider === 'codex') {
      await this.codexRequest('config/value/write', {
        keyPath: `mcp_servers.${input.name}`,
        value: null,
        mergeStrategy: 'replace'
      })
      await this.reloadCodexMcpServers()
      return
    }

    if ((input.scope === 'project' || input.scope === 'local') && !input.cwd) {
      throw new McpManagementError(
        'cwd_required',
        `Removing a ${input.scope}-scope server requires the project working directory.`,
        400
      )
    }
    await this.execClaudeMcp(['remove', '-s', input.scope, input.name], input.cwd)
  }

  async setCodexServerEnabled(name: string, enabled: boolean): Promise<void> {
    assertValidServerName(name)
    await this.codexRequest('config/value/write', {
      keyPath: `mcp_servers.${name}.enabled`,
      value: enabled,
      mergeStrategy: 'upsert'
    })
    await this.reloadCodexMcpServers()
  }

  async codexOauthLogin(name: string): Promise<{ authorizationUrl: string }> {
    assertValidServerName(name)
    const response = await this.codexRequest<{ authorizationUrl: string }>(
      'mcpServer/oauth/login',
      { name },
      INIT_TIMEOUT_MS
    )
    return response
  }

  async importServers(input: { json: string; providers: AgentProvider[] }): Promise<ImportMcpServersResponse> {
    if (input.providers.length === 0) {
      throw new McpManagementError('no_target_providers', 'Pick at least one provider to import into.', 400)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(input.json)
    } catch {
      throw new McpManagementError('invalid_json', 'The pasted content is not valid JSON.', 400)
    }
    if (!isRecord(parsed)) {
      throw new McpManagementError('invalid_json', 'Expected a JSON object.', 400)
    }

    const serverMap = isRecord(parsed['mcpServers']) ? (parsed['mcpServers'] as Record<string, unknown>) : parsed
    const entries = Object.entries(serverMap).filter(([, value]) => isRecord(value))
    if (entries.length === 0) {
      throw new McpManagementError(
        'invalid_json',
        'No MCP server entries found. Paste a {"mcpServers": {...}} snippet.',
        400
      )
    }

    const inventory = await this.listServers({})
    const existing = new Set(inventory.servers.map((server) => `${server.provider}:${server.name}`))

    const result: ImportMcpServersResponse = { added: [], skipped: [], errors: [] }
    for (const [name, raw] of entries) {
      for (const provider of input.providers) {
        const key = `${provider}:${name}`
        if (existing.has(key)) {
          result.skipped.push(key)
          continue
        }
        try {
          await this.addServer({ provider, name, config: raw as McpServerConfigInput })
          result.added.push(key)
        } catch (error) {
          result.errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    return result
  }

  private async reloadCodexMcpServers(): Promise<void> {
    this.invalidateCodexStatus()
    await this.codexRequest('config/mcpServer/reload', undefined, STATUS_TIMEOUT_MS)
  }

  private async execClaudeMcp(args: string[], cwd?: string): Promise<void> {
    try {
      await execFileAsync(config.claudeCodeBinaryPath, ['mcp', ...args], {
        cwd,
        env: {
          ...sanitizedProcessEnv(),
          ...(config.claudeConfigDir ? { CLAUDE_CONFIG_DIR: config.claudeConfigDir } : {})
        },
        timeout: 30_000
      })
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr
      const message = typeof stderr === 'string' && stderr.trim().length > 0
        ? stderr.trim().split('\n').slice(-1)[0]
        : error instanceof Error
          ? error.message
          : String(error)
      throw new McpManagementError('claude_cli_failed', `claude mcp ${args[0]} failed: ${message}`, 502)
    }
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

  /**
   * Merged raw claude MCP server entries (user < project < local precedence),
   * used to rebuild a session-scoped subset for strictMcpConfig injection.
   */
  getClaudeServerConfigs(cwd?: string): Record<string, RawMcpServerEntry> {
    const merged: Record<string, RawMcpServerEntry> = {}

    const collect = (raw: unknown) => {
      if (!isRecord(raw)) {
        return
      }
      for (const [name, value] of Object.entries(raw)) {
        const entry = toRawEntry(value)
        if (entry) {
          merged[name] = entry
        }
      }
    }

    try {
      const configPath = this.claudeConfigJsonPath()
      let claudeJson: Record<string, unknown> | null = null
      if (fs.existsSync(configPath)) {
        claudeJson = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
        collect(claudeJson['mcpServers'])
      }
      if (cwd) {
        const mcpJsonPath = path.join(cwd, '.mcp.json')
        if (fs.existsSync(mcpJsonPath)) {
          const parsed = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8')) as Record<string, unknown>
          collect(parsed['mcpServers'])
        }
        const projects = claudeJson?.['projects']
        if (isRecord(projects) && isRecord(projects[cwd])) {
          collect((projects[cwd] as Record<string, unknown>)['mcpServers'])
        }
      }
    } catch {
      // Fall back to whatever was collected; injection degrades to fewer servers.
    }

    return merged
  }

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
