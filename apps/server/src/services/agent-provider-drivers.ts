import type {
  AgentProviderAuthStatus,
  AgentProviderAvailability,
  AgentProviderInstanceId,
  AgentProviderInstallInstruction,
  AgentProviderLoginMode
} from '@runcell-science/contracts'

import type { GetAccountResponse } from '../runtime/providers/codex/generated/v2/GetAccountResponse'
import { runProviderProcess } from '../runtime/provider-process-launch'
import { sanitizeProviderOutput } from '../runtime/provider-output-sanitizer'
import {
  CodexJsonRpcClient,
  type CodexJsonRpcClientOptions
} from '../runtime/providers/codex/json-rpc-client'
import { GrokAcpClient, type GrokAcpClientOptions } from '../runtime/providers/grok/acp-client'
import type { AcpInitializeResponse } from '../runtime/providers/grok/acp-types'
import { resolveGrokAuthMethodId } from '../runtime/providers/grok/grok-auth'
import type {
  AgentProviderDefinition,
  ResolvedAgentProviderConfig
} from './agent-provider-config-service'
import { BUILTIN_AGENT_PROVIDER_DEFINITIONS } from './agent-provider-config-service'
import {
  codexManagementClientService
} from './codex-management-client-service'

const VERSION_TIMEOUT_MS = 10_000
const PROBE_TIMEOUT_MS = 30_000
const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024

export interface AgentProviderProcessResult {
  stdout: string
  stderr: string
  exitCode: number | null
  errorCode: string | null
  timedOut: boolean
}

export interface AgentProviderProcessRunner {
  exec(
    file: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; cwd?: string; timeoutMs: number; signal?: AbortSignal }
  ): Promise<AgentProviderProcessResult>
}

export interface AgentProviderProbeResult {
  installed: boolean
  version: string | null
  availability: Exclude<AgentProviderAvailability, 'checking'>
  auth: {
    status: AgentProviderAuthStatus
    label?: string
  }
  message: string | null
}

export interface AgentProviderDriver {
  readonly configuration: AgentProviderDefinition
  readonly instanceId: AgentProviderInstanceId
  readonly driver: string
  readonly displayName: string
  readonly loginMode: AgentProviderLoginMode
  readonly loginCommand: string
  readonly docsUrl: string
  readonly installInstructions: AgentProviderInstallInstruction[]
  probe(
    resolved: ResolvedAgentProviderConfig,
    options?: { useManagedClient?: boolean; signal?: AbortSignal }
  ): Promise<AgentProviderProbeResult>
}

export interface CodexProbeClient {
  on(event: string, listener: (...args: any[]) => void): this
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>
  notify(method: string, params: unknown): void
  dispose(): void
}

export interface GrokProbeClient {
  on(event: string, listener: (...args: any[]) => void): this
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>
  dispose(): void
}

export interface CodexManagementRequester {
  request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T>
}

type CodexClientFactory = (options: CodexJsonRpcClientOptions) => CodexProbeClient
type GrokClientFactory = (options: GrokAcpClientOptions) => GrokProbeClient

export interface AgentProviderDriverDependencies {
  processRunner: AgentProviderProcessRunner
  codexManagementClient: CodexManagementRequester
  codexClientFactory: CodexClientFactory
  grokClientFactory: GrokClientFactory
}

function firstNonEmptyLine(...values: string[]): string | null {
  for (const value of values) {
    const line = value
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean)
    if (line) {
      return line
    }
  }
  return null
}

export function sanitizeAgentProviderMessage(
  error: unknown,
  env: NodeJS.ProcessEnv = {}
): string {
  return sanitizeProviderOutput(error, env, 500)
}

function sanitizeProbeLabel(value: string | null, env: NodeJS.ProcessEnv): string | null {
  if (!value) {
    return null
  }
  const sanitized = sanitizeProviderOutput(value, env, 160)
    .replace(/[^A-Za-z0-9 ._+/@():\-[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  return sanitized || null
}

function executableFor(resolved: ResolvedAgentProviderConfig): string {
  return resolved.resolvedExecutablePath ?? resolved.configuredCommand
}

function unresolvedExecutable(
  resolved: ResolvedAgentProviderConfig,
  displayName: string
): AgentProviderProbeResult | null {
  if (resolved.resolvedExecutablePath !== null) {
    return null
  }
  return {
    installed: false,
    version: null,
    availability: 'not_installed',
    auth: { status: 'unknown' },
    message: `${displayName} was not found at ${resolved.configuredCommand}.`
  }
}

function processFailure(
  result: AgentProviderProcessResult,
  displayName: string,
  resolved: ResolvedAgentProviderConfig
): AgentProviderProbeResult | null {
  if (result.exitCode === 0) {
    return null
  }
  if (result.errorCode === 'ENOENT') {
    return {
      installed: false,
      version: null,
      availability: 'not_installed',
      auth: { status: 'unknown' },
      message: `${displayName} was not found at ${resolved.configuredCommand}.`
    }
  }
  const detail = firstNonEmptyLine(result.stderr, result.stdout)
  return {
    installed: resolved.resolvedExecutablePath !== null,
    version: null,
    availability: 'error',
    auth: { status: 'unknown' },
    message: result.timedOut
      ? `${displayName} version check timed out.`
      : `${displayName} version check failed${detail ? `: ${sanitizeAgentProviderMessage(detail, resolved.env)}` : '.'}`
  }
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start < 0 || end <= start) {
    return null
  }
  try {
    const parsed = JSON.parse(value.slice(start, end + 1)) as unknown
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function looksLikeAuthFailure(error: unknown, env: NodeJS.ProcessEnv): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 401 || code === 403 || code === 'AUTH_REQUIRED' || code === 'UNAUTHENTICATED') {
    return true
  }
  const message = sanitizeAgentProviderMessage(error, env)
  return /\b(?:unauthorized|forbidden|not authenticated|not logged in|auth(?:entication)? required|sign in required|missing credentials?|invalid credentials?|token expired|re-?authenticate)\b/i.test(
    message
  )
}

function enabledEnvironmentFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

async function transientCodexAccountProbe(
  resolved: ResolvedAgentProviderConfig,
  clientFactory: CodexClientFactory,
  signal?: AbortSignal
): Promise<GetAccountResponse> {
  const client = clientFactory({
    binaryPath: executableFor(resolved),
    env: resolved.env
  })
  const abort = () => client.dispose()
  signal?.addEventListener('abort', abort, { once: true })
  client.on('error', () => {})
  try {
    await client.request(
      'initialize',
      {
        clientInfo: {
          name: 'open_science_agent_provider_probe',
          title: 'Runcell Science',
          version: '0.1.0'
        },
        capabilities: { experimentalApi: true }
      },
      PROBE_TIMEOUT_MS
    )
    client.notify('initialized', {})
    return await client.request<GetAccountResponse>(
      'account/read',
      { refreshToken: false },
      PROBE_TIMEOUT_MS
    )
  } finally {
    signal?.removeEventListener('abort', abort)
    client.dispose()
  }
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise
  }
  if (signal.aborted) {
    return Promise.reject(new Error('Agent Provider probe was cancelled.'))
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('Agent Provider probe was cancelled.'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

export class NodeAgentProviderProcessRunner implements AgentProviderProcessRunner {
  exec(
    file: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; cwd?: string; timeoutMs: number; signal?: AbortSignal }
  ): Promise<AgentProviderProcessResult> {
    return runProviderProcess(file, args, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
      signal: options.signal
    })
  }
}

class CodexProviderDriver implements AgentProviderDriver {
  readonly configuration = BUILTIN_AGENT_PROVIDER_DEFINITIONS.codex
  readonly instanceId = this.configuration.instanceId
  readonly driver = this.configuration.driver
  readonly displayName = 'CodeX'
  readonly loginMode = 'device_code' as const
  readonly loginCommand = 'codex login --device-auth'
  readonly docsUrl = 'https://developers.openai.com/codex/cli/'
  readonly installInstructions: AgentProviderInstallInstruction[] = [
    {
      platform: 'all',
      label: 'Install with npm',
      command: 'npm install -g @openai/codex'
    }
  ]

  constructor(private readonly dependencies: AgentProviderDriverDependencies) {}

  async probe(
    resolved: ResolvedAgentProviderConfig,
    options: { useManagedClient?: boolean; signal?: AbortSignal } = {}
  ): Promise<AgentProviderProbeResult> {
    const missing = unresolvedExecutable(resolved, this.displayName)
    if (missing) {
      return missing
    }
    const versionResult = await this.dependencies.processRunner.exec(
      executableFor(resolved),
      ['--version'],
      { env: resolved.env, timeoutMs: VERSION_TIMEOUT_MS, signal: options.signal }
    )
    const failed = processFailure(versionResult, this.displayName, resolved)
    if (failed) {
      return failed
    }
    const version = sanitizeProbeLabel(
      firstNonEmptyLine(versionResult.stdout, versionResult.stderr),
      resolved.env
    )

    try {
      const account = options.useManagedClient === false
        ? await transientCodexAccountProbe(resolved, this.dependencies.codexClientFactory, options.signal)
        : await withAbort(this.dependencies.codexManagementClient.request<GetAccountResponse>(
            'account/read',
            { refreshToken: false },
            PROBE_TIMEOUT_MS
          ), options.signal)

      if (account.requiresOpenaiAuth && account.account === null) {
        return {
          installed: true,
          version,
          availability: 'needs_auth',
          auth: { status: 'unauthenticated', label: 'Sign in required' },
          message: 'Codex is installed but not signed in.'
        }
      }

      if (account.account === null) {
        return {
          installed: true,
          version,
          availability: 'ready',
          auth: { status: 'unknown', label: 'Authentication not required' },
          message: null
        }
      }

      const label = account.account.type === 'chatgpt'
          ? 'ChatGPT'
          : account.account.type === 'apiKey'
            ? 'API key'
            : account.account.type === 'amazonBedrock'
              ? 'Amazon Bedrock'
              : 'Authenticated'
      return {
        installed: true,
        version,
        availability: 'ready',
        auth: { status: 'authenticated', label },
        message: null
      }
    } catch (error) {
      return {
        installed: true,
        version,
        availability: 'error',
        auth: { status: 'unknown' },
        message: `Codex account probe failed: ${sanitizeAgentProviderMessage(error, resolved.env)}`
      }
    }
  }
}

class ClaudeProviderDriver implements AgentProviderDriver {
  readonly configuration = BUILTIN_AGENT_PROVIDER_DEFINITIONS.claude
  readonly instanceId = this.configuration.instanceId
  readonly driver = this.configuration.driver
  readonly displayName = 'Claude Code'
  readonly loginMode = 'local_process' as const
  readonly loginCommand = 'claude auth login --claudeai'
  readonly docsUrl = 'https://docs.anthropic.com/en/docs/claude-code/getting-started'
  readonly installInstructions: AgentProviderInstallInstruction[] = [
    {
      platform: 'all',
      label: 'Open the official installation guide',
      command: null
    }
  ]

  constructor(private readonly dependencies: AgentProviderDriverDependencies) {}

  async probe(
    resolved: ResolvedAgentProviderConfig,
    options: { signal?: AbortSignal } = {}
  ): Promise<AgentProviderProbeResult> {
    const missing = unresolvedExecutable(resolved, this.displayName)
    if (missing) {
      return missing
    }
    const versionResult = await this.dependencies.processRunner.exec(
      executableFor(resolved),
      ['--version'],
      { env: resolved.env, timeoutMs: VERSION_TIMEOUT_MS, signal: options.signal }
    )
    const failed = processFailure(versionResult, this.displayName, resolved)
    if (failed) {
      return failed
    }
    const version = sanitizeProbeLabel(
      firstNonEmptyLine(versionResult.stdout, versionResult.stderr),
      resolved.env
    )

    const externallyConfigured = Boolean(
      resolved.env.ANTHROPIC_API_KEY?.trim() ||
      resolved.env.ANTHROPIC_AUTH_TOKEN?.trim() ||
      enabledEnvironmentFlag(resolved.env.CLAUDE_CODE_USE_BEDROCK) ||
      enabledEnvironmentFlag(resolved.env.CLAUDE_CODE_USE_VERTEX)
    )
    const authResult = await this.dependencies.processRunner.exec(
      executableFor(resolved),
      ['auth', 'status', '--json'],
      { env: resolved.env, timeoutMs: VERSION_TIMEOUT_MS, signal: options.signal }
    )
    const status = extractJsonObject(`${authResult.stdout}\n${authResult.stderr}`)
    if (status?.loggedIn === true) {
      const method =
        typeof status.authMethod === 'string'
          ? sanitizeProbeLabel(status.authMethod, resolved.env) ?? 'Claude account'
          : 'Claude account'
      return {
        installed: true,
        version,
        availability: 'ready',
        auth: { status: 'authenticated', label: method },
        message: null
      }
    }
    if (externallyConfigured) {
      return {
        installed: true,
        version,
        availability: 'ready',
        auth: { status: 'unknown', label: 'External credentials configured' },
        message: null
      }
    }
    if (status?.loggedIn === false) {
      return {
        installed: true,
        version,
        availability: 'needs_auth',
        auth: { status: 'unauthenticated', label: 'Sign in required' },
        message: 'Claude Code is installed but not signed in.'
      }
    }

    return {
      installed: true,
      version,
      availability: 'error',
      auth: { status: 'unknown' },
      message: authResult.timedOut
        ? 'Claude Code auth status timed out.'
        : 'Claude Code auth status could not be read.'
    }
  }
}

class GrokProviderDriver implements AgentProviderDriver {
  readonly configuration = BUILTIN_AGENT_PROVIDER_DEFINITIONS.grok
  readonly instanceId = this.configuration.instanceId
  readonly driver = this.configuration.driver
  readonly displayName = 'Grok Build'
  readonly loginMode = 'device_code' as const
  readonly loginCommand = 'grok login --device-auth'
  readonly docsUrl = 'https://docs.x.ai/build/cli/reference'
  readonly installInstructions: AgentProviderInstallInstruction[] = [
    {
      platform: 'all',
      label: 'Open the official installation guide',
      command: null
    }
  ]

  constructor(private readonly dependencies: AgentProviderDriverDependencies) {}

  async probe(
    resolved: ResolvedAgentProviderConfig,
    options: { signal?: AbortSignal } = {}
  ): Promise<AgentProviderProbeResult> {
    const missing = unresolvedExecutable(resolved, this.displayName)
    if (missing) {
      return missing
    }
    const versionResult = await this.dependencies.processRunner.exec(
      executableFor(resolved),
      ['--version'],
      { env: resolved.env, timeoutMs: VERSION_TIMEOUT_MS, signal: options.signal }
    )
    const failed = processFailure(versionResult, this.displayName, resolved)
    if (failed) {
      return failed
    }
    const version = sanitizeProbeLabel(
      firstNonEmptyLine(versionResult.stdout, versionResult.stderr),
      resolved.env
    )

    const client = this.dependencies.grokClientFactory({
      binaryPath: executableFor(resolved),
      env: { ...resolved.env, GROK_OAUTH2_REFERRER: 'open-science' }
    })
    const abort = () => client.dispose()
    options.signal?.addEventListener('abort', abort, { once: true })
    client.on('error', () => {})
    try {
      try {
        await client.request<AcpInitializeResponse>(
          'initialize',
          {
            protocolVersion: 1,
            clientInfo: {
              name: 'open_science_agent_provider_probe',
              title: 'Runcell Science',
              version: '0.1.0'
            },
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false }
            }
          },
          PROBE_TIMEOUT_MS
        )
      } catch (error) {
        return {
          installed: true,
          version,
          availability: 'error',
          auth: { status: 'unknown' },
          message: `Grok ACP initialization failed: ${sanitizeAgentProviderMessage(error, resolved.env)}`
        }
      }

      try {
        await client.request(
          'authenticate',
          { methodId: resolveGrokAuthMethodId(resolved.env) },
          PROBE_TIMEOUT_MS
        )
        return {
          installed: true,
          version,
          availability: 'ready',
          auth: {
            status: 'authenticated',
            label: resolved.env.XAI_API_KEY?.trim() ? 'API key' : 'Grok account'
          },
          message: null
        }
      } catch (error) {
        if (looksLikeAuthFailure(error, resolved.env)) {
          return {
            installed: true,
            version,
            availability: 'needs_auth',
            auth: { status: 'unauthenticated', label: 'Sign in required' },
            message: 'Grok Build is installed but its credentials could not be verified.'
          }
        }
        return {
          installed: true,
          version,
          availability: 'error',
          auth: { status: 'unknown' },
          message: `Grok ACP authentication probe failed: ${sanitizeAgentProviderMessage(error, resolved.env)}`
        }
      }
    } finally {
      options.signal?.removeEventListener('abort', abort)
      client.dispose()
    }
  }
}

export function createBuiltinAgentProviderDrivers(
  dependencies: Partial<AgentProviderDriverDependencies> = {}
): AgentProviderDriver[] {
  const resolvedDependencies: AgentProviderDriverDependencies = {
    processRunner: dependencies.processRunner ?? new NodeAgentProviderProcessRunner(),
    codexManagementClient: dependencies.codexManagementClient ?? codexManagementClientService,
    codexClientFactory:
      dependencies.codexClientFactory ?? ((options) => new CodexJsonRpcClient(options)),
    grokClientFactory:
      dependencies.grokClientFactory ?? ((options) => new GrokAcpClient(options))
  }
  return [
    new GrokProviderDriver(resolvedDependencies),
    new CodexProviderDriver(resolvedDependencies),
    new ClaudeProviderDriver(resolvedDependencies)
  ]
}

export const builtinAgentProviderDrivers = createBuiltinAgentProviderDrivers()
