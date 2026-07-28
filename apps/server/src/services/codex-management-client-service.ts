import type { CodexJsonRpcMessage } from '../runtime/providers/codex/json-rpc-client'
import {
  CodexJsonRpcClient,
  type CodexJsonRpcClientOptions
} from '../runtime/providers/codex/json-rpc-client'
import {
  agentProviderConfigService,
  requireAgentProviderExecutable,
  type ResolvedAgentProviderConfig
} from './agent-provider-config-service'

const INITIALIZE_TIMEOUT_MS = 60_000

export interface CodexManagementClient {
  on(event: string, listener: (...args: any[]) => void): this
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>
  notify(method: string, params: unknown): void
  dispose(): void
}

type CodexClientFactory = (options: CodexJsonRpcClientOptions) => CodexManagementClient

export interface CodexManagementConfigStore {
  resolve(instanceId: 'codex'): ResolvedAgentProviderConfig
  onChange(listener: (instanceId: string) => void): () => void
}

export interface CodexManagementClientServiceOptions {
  configService: CodexManagementConfigStore
  clientFactory: CodexClientFactory
}

interface ClientInitialization {
  generation: number
  promise: Promise<CodexManagementClient>
}

/**
 * Owns the one management-plane Codex app-server connection shared by model,
 * MCP, skills, auth, and provider-status operations. Session runtimes keep
 * their own clients and are intentionally not restarted when setup changes.
 */
export class CodexManagementClientService {
  private client: CodexManagementClient | null = null
  private clientInit: ClientInitialization | null = null
  private readonly initializingClients = new Set<CodexManagementClient>()
  private generation = 0
  private readonly notificationListeners = new Set<(message: CodexJsonRpcMessage) => void>()
  private readonly exitListeners = new Set<() => void>()
  private readonly options: CodexManagementClientServiceOptions
  private readonly unsubscribeConfig: () => void

  constructor(options: Partial<CodexManagementClientServiceOptions> = {}) {
    this.options = {
      configService: options.configService ?? agentProviderConfigService,
      clientFactory: options.clientFactory ?? ((clientOptions) => new CodexJsonRpcClient(clientOptions))
    }
    this.unsubscribeConfig = this.options.configService.onChange((instanceId) => {
      if (instanceId === 'codex') {
        this.invalidate()
      }
    })
  }

  onNotification(listener: (message: CodexJsonRpcMessage) => void): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  onExit(listener: () => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  async request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    const client = await this.ensureClient()
    return client.request<T>(method, params, timeoutMs)
  }

  async notify(method: string, params: unknown): Promise<void> {
    const client = await this.ensureClient()
    client.notify(method, params)
  }

  invalidate(): void {
    this.generation += 1
    this.client?.dispose()
    for (const client of this.initializingClients) {
      client.dispose()
    }
    this.client = null
    this.clientInit = null
    this.initializingClients.clear()
    for (const listener of this.exitListeners) {
      listener()
    }
  }

  dispose(): void {
    this.invalidate()
    this.unsubscribeConfig()
    this.notificationListeners.clear()
    this.exitListeners.clear()
  }

  private async ensureClient(): Promise<CodexManagementClient> {
    if (this.client) {
      return this.client
    }
    const generation = this.generation
    if (this.clientInit?.generation === generation) {
      return this.clientInit.promise
    }

    const promise = this.initializeClient(generation)
    const initialization: ClientInitialization = { generation, promise }
    this.clientInit = initialization

    try {
      return await promise
    } finally {
      if (this.clientInit === initialization) {
        this.clientInit = null
      }
    }
  }

  private async initializeClient(generation: number): Promise<CodexManagementClient> {
    const resolved = this.options.configService.resolve('codex')
    const client = this.options.clientFactory({
      binaryPath: requireAgentProviderExecutable(resolved),
      env: {
        ...resolved.env
      }
    })
    this.initializingClients.add(client)

    client.on('error', () => {
      // Request promises surface transport errors. Keeping an error listener
      // prevents EventEmitter from turning a probe failure into a crash.
    })
    client.on('notification', (message) => {
      if (this.client !== client && !this.initializingClients.has(client)) {
        return
      }
      for (const listener of this.notificationListeners) {
        listener(message as CodexJsonRpcMessage)
      }
    })
    client.on('exit', () => {
      const owned = this.client === client || this.initializingClients.has(client)
      if (this.client === client) {
        this.client = null
      }
      this.initializingClients.delete(client)
      if (owned) {
        for (const listener of this.exitListeners) {
          listener()
        }
      }
    })

    try {
      await client.request(
        'initialize',
        {
          clientInfo: {
            name: 'open_science_agent_provider_admin',
            title: 'Runcell Science',
            version: '0.1.0'
          },
          capabilities: { experimentalApi: true }
        },
        INITIALIZE_TIMEOUT_MS
      )
      client.notify('initialized', {})
      if (generation !== this.generation) {
        throw new Error('Codex management configuration changed during initialization.')
      }
      if (this.client && this.client !== client) {
        throw new Error('A newer Codex management client is already active.')
      }
      this.initializingClients.delete(client)
      this.client = client
      return client
    } catch (error) {
      this.initializingClients.delete(client)
      client.dispose()
      throw error
    }
  }
}

export const codexManagementClientService = new CodexManagementClientService()
