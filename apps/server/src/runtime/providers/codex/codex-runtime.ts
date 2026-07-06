import type {
  AgentDiffFileChange,
  AgentMessage,
  AgentPendingRequest,
  AgentSession,
  AgentTurn,
  ResolveAgentRequestRequest
} from '@open-science/contracts'

import { config } from '../../../config/env'
import { agentSessionService } from '../../../services'
import { bundledScienceConnectorsService } from '../../../services/bundled-science-connectors-service'
import type {
  CodeAgentProviderRuntime,
  RuntimeInterruptInput,
  RuntimeResolveRequestInput,
  RuntimeStartInitialTurnInput,
  RuntimeStartTurnInput
} from '../../code-agent-provider'
import { RuntimeProviderError } from '../../code-agent-provider'
import { agentIntegrationEnv, sanitizedProcessEnv } from '../../env-utils'
import { notebookAgentGuidance } from '../../notebook-guidance'
import type { ServerNotification } from './generated/ServerNotification'
import type { ServerRequest } from './generated/ServerRequest'
import type { ThreadStartResponse } from './generated/v2/ThreadStartResponse'
import type { ThreadResumeResponse } from './generated/v2/ThreadResumeResponse'
import type { TurnStartResponse } from './generated/v2/TurnStartResponse'
import type { ThreadItem } from './generated/v2/ThreadItem'
import type { FileUpdateChange } from './generated/v2/FileUpdateChange'
import { CodexJsonRpcClient, type CodexJsonRpcMessage } from './json-rpc-client'

/**
 * Streaming/progress notifications whose aggregate arrives with the item
 * itself (item/completed and the explicit delta handlers). Recording each
 * chunk floods the session timeline — a single pip install produced hundreds
 * of `item/commandExecution/outputDelta` rows. `item/agentMessage/delta` is
 * NOT here: it streams into the assistant message via its own handler.
 */
export const streamingNotificationMethods = new Set<string>([
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/reasoning/textDelta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/plan/delta',
  'item/mcpToolCall/progress',
  // NOTE: command/exec/outputDelta and process/outputDelta are intentionally
  // NOT filtered: per the generated contracts their streamed output is not
  // duplicated into the final command/exec response or process/exited event.
  'thread/tokenUsage/updated',
  'account/rateLimits/updated',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/transcript/delta'
])

interface CodexTurnBinding {
  sessionId: string
  localTurnId: string
  providerTurnId: string
}

interface CodexSessionState {
  sessionId: string
  client: CodexJsonRpcClient
  threadId: string | null
  providerSessionId: string | null
  activeLocalTurnId: string | null
  turnBindings: Map<string, CodexTurnBinding>
  pendingServerRequests: Map<string, number | string>
}

type CodexResolution = ResolveAgentRequestRequest

// Session-establishing RPCs must fail fast instead of hanging the HTTP request
// forever when the app-server wedges (e.g. unauthenticated home directory).
const SESSION_RPC_TIMEOUT_MS = 60_000

const MCP_OVERRIDE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/

// Session-scoped connector selection: disable servers via CLI config
// overrides at spawn time so the user's config.toml stays untouched.
function buildMcpDisableOverrides(disabledMcpServers: string[]): string[] {
  const args: string[] = []
  for (const name of disabledMcpServers) {
    if (MCP_OVERRIDE_NAME_PATTERN.test(name)) {
      args.push('-c', `mcp_servers.${name}.enabled=false`)
    }
  }
  return args
}

function codexConfigValue(value: unknown): string {
  return JSON.stringify(value)
}

function buildBundledMcpOverrides(session: AgentSession): string[] {
  const args: string[] = []
  const bundled = bundledScienceConnectorsService.getEnabledMcpConfigs(
    session.cwd,
    session.disabledMcpServers,
    session.id
  )
  for (const [name, entry] of Object.entries(bundled)) {
    if (!MCP_OVERRIDE_NAME_PATTERN.test(name) || entry.type !== 'stdio' || !entry.command) {
      continue
    }
    args.push('-c', `mcp_servers.${name}.command=${codexConfigValue(entry.command)}`)
    args.push('-c', `mcp_servers.${name}.args=${codexConfigValue(entry.args ?? [])}`)
    if (entry.env && Object.keys(entry.env).length > 0) {
      args.push('-c', `mcp_servers.${name}.env=${codexConfigValue(entry.env)}`)
    }
    args.push('-c', `mcp_servers.${name}.enabled=true`)
  }
  return args
}

export class CodexRuntime implements CodeAgentProviderRuntime {
  private readonly sessions = new Map<string, CodexSessionState>()
  private readonly threadToSessionId = new Map<string, string>()

  async startInitialTurn(input: RuntimeStartInitialTurnInput): Promise<void> {
    const state = await this.createInitializedState(input.session)
    const response = await state.client.request<ThreadStartResponse>('thread/start', {
      cwd: input.session.cwd,
      model: input.session.model ?? config.codexDefaultModel,
      approvalPolicy: config.codexApprovalPolicy,
      sandbox: config.codexSandbox,
      serviceName: 'open-science',
      developerInstructions: notebookAgentGuidance
    }, SESSION_RPC_TIMEOUT_MS)

    this.bindThread(state, response.thread.id, response.thread.sessionId)
    agentSessionService.updateProviderBinding({
      sessionId: input.session.id,
      providerSessionId: response.thread.sessionId,
      providerThreadId: response.thread.id,
      resumeCursorJson: JSON.stringify({ threadId: response.thread.id })
    })

    await this.startTurnWithState(state, input.session, input.turn, input.message)
  }

  async startTurn(input: RuntimeStartTurnInput): Promise<void> {
    const state = await this.ensureStateForSession(input.session)
    await this.startTurnWithState(state, input.session, input.turn, input.message)
  }

  async resolveRequest(input: RuntimeResolveRequestInput): Promise<void> {
    const state = this.sessions.get(input.session.id)
    if (!state) {
      throw new RuntimeProviderError(
        'provider_unavailable',
        'Codex runtime is not active for this session.',
        409
      )
    }

    const serverRequestId = state.pendingServerRequests.get(input.request.id)
    if (serverRequestId === undefined) {
      return
    }

    const payload = parsePendingRequestPayload(input.request)
    const result = buildServerRequestResolution(payload.method, input.resolution)
    state.client.respond(serverRequestId, result)
    state.pendingServerRequests.delete(input.request.id)
  }

  async interrupt(input: RuntimeInterruptInput): Promise<void> {
    const state = this.sessions.get(input.session.id)
    if (!state?.threadId) {
      return
    }

    await state.client.request('turn/interrupt', {
      threadId: state.threadId
    })
  }

  resetSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) {
      return
    }
    state.client.dispose()
    this.sessions.delete(sessionId)
    if (state.threadId) {
      this.threadToSessionId.delete(state.threadId)
    }
  }

  async dispose(): Promise<void> {
    for (const state of this.sessions.values()) {
      state.client.dispose()
    }
    this.sessions.clear()
    this.threadToSessionId.clear()
  }

  private async createInitializedState(session: AgentSession): Promise<CodexSessionState> {
    const client = new CodexJsonRpcClient({
      binaryPath: config.codexBinaryPath,
      env: this.buildEnv(session.id),
      extraArgs: [
        ...buildBundledMcpOverrides(session),
        ...buildMcpDisableOverrides(session.disabledMcpServers)
      ]
    })

    const state: CodexSessionState = {
      sessionId: session.id,
      client,
      threadId: null,
      providerSessionId: null,
      activeLocalTurnId: null,
      turnBindings: new Map(),
      pendingServerRequests: new Map()
    }

    client.on('notification', (message) => {
      this.handleNotification(state, message as CodexJsonRpcMessage)
    })
    client.on('serverRequest', (message) => {
      this.handleServerRequest(state, message as CodexJsonRpcMessage)
    })
    client.on('stderr', (line) => {
      agentSessionService.recordRuntimeActivity({
        sessionId: session.id,
        turnId: state.activeLocalTurnId,
        provider: 'codex',
        eventType: 'stderr',
        rawSource: 'codex.app-server.stderr',
        rawJson: { line },
        title: 'Codex runtime log',
        summary: line,
        status: 'info'
      })
    })
    client.on('exit', () => {
      this.sessions.delete(session.id)
      if (state.threadId) {
        this.threadToSessionId.delete(state.threadId)
      }
    })

    try {
      await client.request('initialize', {
        clientInfo: {
          name: 'open_science',
          title: 'Open Science',
          version: '0.1.0'
        },
        capabilities: {
          experimentalApi: true
        }
      }, SESSION_RPC_TIMEOUT_MS)
      client.notify('initialized', {})
    } catch (error) {
      client.dispose()
      throw new RuntimeProviderError(
        'provider_unavailable',
        `Failed to initialize Codex app-server: ${error instanceof Error ? error.message : String(error)}`,
        502,
        { cause: error }
      )
    }

    this.sessions.set(session.id, state)
    return state
  }

  private async ensureStateForSession(session: AgentSession): Promise<CodexSessionState> {
    const existing = this.sessions.get(session.id)
    if (existing) {
      return existing
    }

    if (!session.providerThreadId) {
      throw new RuntimeProviderError(
        'provider_request_failed',
        'Codex session has no provider thread id to resume.',
        409
      )
    }

    const state = await this.createInitializedState(session)
    const response = await state.client.request<ThreadResumeResponse>('thread/resume', {
      threadId: session.providerThreadId,
      cwd: session.cwd,
      model: session.model ?? config.codexDefaultModel,
      approvalPolicy: config.codexApprovalPolicy,
      sandbox: config.codexSandbox,
      developerInstructions: notebookAgentGuidance
    }, SESSION_RPC_TIMEOUT_MS)

    this.bindThread(state, response.thread.id, response.thread.sessionId)
    agentSessionService.updateProviderBinding({
      sessionId: session.id,
      providerSessionId: response.thread.sessionId,
      providerThreadId: response.thread.id,
      resumeCursorJson: JSON.stringify({ threadId: response.thread.id })
    })

    return state
  }

  private async startTurnWithState(
    state: CodexSessionState,
    session: AgentSession,
    turn: AgentTurn,
    message: AgentMessage
  ): Promise<void> {
    if (!state.threadId) {
      throw new RuntimeProviderError('provider_request_failed', 'Codex thread is not initialized.', 500)
    }

    try {
      const response = await state.client.request<TurnStartResponse>('turn/start', {
        threadId: state.threadId,
        input: [
          {
            type: 'text',
            text: message.text,
            text_elements: []
          }
        ],
        cwd: session.cwd,
        model: session.model ?? config.codexDefaultModel,
        approvalPolicy: config.codexApprovalPolicy,
        sandboxPolicy: { type: 'dangerFullAccess' }
      }, SESSION_RPC_TIMEOUT_MS)

      this.bindTurn(state, turn.id, response.turn.id)
      agentSessionService.updateTurnProviderId({
        sessionId: session.id,
        turnId: turn.id,
        providerTurnId: response.turn.id
      })
    } catch (error) {
      throw new RuntimeProviderError(
        'provider_request_failed',
        `Failed to start Codex turn: ${error instanceof Error ? error.message : String(error)}`,
        502,
        { cause: error }
      )
    }
  }

  private bindThread(state: CodexSessionState, threadId: string, providerSessionId: string): void {
    state.threadId = threadId
    state.providerSessionId = providerSessionId
    this.threadToSessionId.set(threadId, state.sessionId)
  }

  private bindTurn(state: CodexSessionState, localTurnId: string, providerTurnId: string): void {
    state.activeLocalTurnId = localTurnId
    state.turnBindings.set(providerTurnId, {
      sessionId: state.sessionId,
      localTurnId,
      providerTurnId
    })
  }

  private handleNotification(state: CodexSessionState, message: CodexJsonRpcMessage): void {
    const notification = message as ServerNotification

    if (notification.method && streamingNotificationMethods.has(notification.method)) {
      return
    }

    switch (notification.method) {
      case 'item/agentMessage/delta':
        this.handleAgentMessageDelta(notification.params, message)
        return
      case 'turn/completed':
        this.handleTurnCompleted(notification.params, message)
        return
      case 'turn/diff/updated':
        this.handleTurnDiffUpdated(notification.params, message)
        return
      case 'item/fileChange/patchUpdated':
        this.handleFileChangePatchUpdated(notification.params, message)
        return
      case 'item/started':
        this.recordItemActivity('started', notification.params.threadId, notification.params.turnId, notification.params.item, message)
        return
      case 'item/completed':
        this.recordItemActivity(
          'completed',
          notification.params.threadId,
          notification.params.turnId,
          notification.params.item,
          message
        )
        return
      case 'turn/started':
      case 'thread/status/changed':
      case 'thread/started':
        this.recordThreadActivity(state, notification.method, message)
        return
      default:
        this.recordThreadActivity(state, notification.method ?? 'notification', message)
    }
  }

  private handleAgentMessageDelta(
    params: Extract<ServerNotification, { method: 'item/agentMessage/delta' }>['params'],
    rawMessage: CodexJsonRpcMessage
  ): void {
    const binding = this.findTurnBinding(params.turnId)
    if (!binding) {
      return
    }

    agentSessionService.appendAssistantMessageDelta({
      sessionId: binding.sessionId,
      turnId: binding.localTurnId,
      provider: 'codex',
      delta: params.delta,
      providerItemId: params.itemId,
      rawSource: 'codex.app-server.notification',
      rawJson: rawMessage,
      canonicalJson: {
        type: 'content.delta',
        streamKind: 'assistant_text',
        providerTurnId: params.turnId,
        providerItemId: params.itemId,
        delta: params.delta
      }
    })
  }

  private handleTurnCompleted(
    params: Extract<ServerNotification, { method: 'turn/completed' }>['params'],
    rawMessage: CodexJsonRpcMessage
  ): void {
    const binding = this.findTurnBinding(params.turn.id)
    if (!binding) {
      return
    }

    const state = this.sessions.get(binding.sessionId)
    if (state?.activeLocalTurnId === binding.localTurnId) {
      state.activeLocalTurnId = null
    }

    agentSessionService.recordRuntimeActivity({
      sessionId: binding.sessionId,
      turnId: binding.localTurnId,
      provider: 'codex',
      eventType: 'turn.completed',
      rawSource: 'codex.app-server.notification',
      rawJson: rawMessage,
      canonicalJson: {
        type: 'turn.completed',
        status: params.turn.status,
        providerTurnId: params.turn.id
      },
      title: 'Codex turn completed',
      status: params.turn.status
    })

    if (params.turn.status === 'failed') {
      agentSessionService.failTurn(
        binding.sessionId,
        binding.localTurnId,
        params.turn.error?.message ?? 'Codex turn failed.'
      )
      return
    }

    if (params.turn.status === 'interrupted') {
      agentSessionService.interruptRunningTurn(binding.sessionId)
      return
    }

    agentSessionService.completeTurn(binding.sessionId, binding.localTurnId)
  }

  private handleTurnDiffUpdated(
    params: Extract<ServerNotification, { method: 'turn/diff/updated' }>['params'],
    rawMessage: CodexJsonRpcMessage
  ): void {
    const binding = this.findTurnBinding(params.turnId)
    if (!binding) {
      return
    }

    agentSessionService.recordTurnDiff({
      sessionId: binding.sessionId,
      turnId: binding.localTurnId,
      provider: 'codex',
      providerTurnId: params.turnId,
      unifiedDiff: params.diff,
      rawSource: 'codex.app-server.notification',
      rawJson: rawMessage
    })
  }

  private handleFileChangePatchUpdated(
    params: Extract<ServerNotification, { method: 'item/fileChange/patchUpdated' }>['params'],
    rawMessage: CodexJsonRpcMessage
  ): void {
    const binding = this.findTurnBinding(params.turnId)
    if (!binding) {
      return
    }

    agentSessionService.recordTurnDiff({
      sessionId: binding.sessionId,
      turnId: binding.localTurnId,
      provider: 'codex',
      providerTurnId: params.turnId,
      providerItemId: params.itemId,
      files: normalizeCodexFileChanges(params.changes),
      rawSource: 'codex.app-server.notification',
      rawJson: rawMessage
    })
  }

  private recordItemActivity(
    status: 'started' | 'completed',
    threadId: string,
    providerTurnId: string,
    item: ThreadItem,
    rawMessage: CodexJsonRpcMessage
  ): void {
    const binding = this.findTurnBinding(providerTurnId)
    const sessionId = binding?.sessionId ?? this.threadToSessionId.get(threadId)
    if (!sessionId) {
      return
    }

    agentSessionService.recordRuntimeActivity({
      sessionId,
      turnId: binding?.localTurnId ?? null,
      provider: 'codex',
      eventType: `item.${status}`,
      rawSource: 'codex.app-server.notification',
      rawJson: rawMessage,
      canonicalJson: {
        type: `item.${status}`,
        itemType: item.type,
        itemId: item.id
      },
      title: titleForThreadItem(item),
      summary: summaryForThreadItem(item),
      status
    })
  }

  private recordThreadActivity(state: CodexSessionState, eventType: string, rawMessage: CodexJsonRpcMessage): void {
    agentSessionService.recordRuntimeActivity({
      sessionId: state.sessionId,
      turnId: state.activeLocalTurnId,
      provider: 'codex',
      eventType,
      rawSource: 'codex.app-server.notification',
      rawJson: rawMessage,
      title: eventType,
      status: 'info'
    })
  }

  private handleServerRequest(state: CodexSessionState, message: CodexJsonRpcMessage): void {
    const serverRequest = message as ServerRequest
    if (!state.activeLocalTurnId) {
      state.client.respondError(serverRequest.id, -32000, 'No active local turn is available for this request.')
      return
    }

    const request = agentSessionService.openPendingRequest({
      sessionId: state.sessionId,
      turnId: state.activeLocalTurnId,
      type: serverRequest.method,
      title: serverRequest.method,
      payloadJson: {
        id: serverRequest.id,
        method: serverRequest.method,
        params: serverRequest.params
      }
    })

    state.pendingServerRequests.set(request.id, serverRequest.id)
  }

  private findTurnBinding(providerTurnId: string): CodexTurnBinding | null {
    for (const state of this.sessions.values()) {
      const binding = state.turnBindings.get(providerTurnId)
      if (binding) {
        return binding
      }
    }

    return null
  }

  private buildEnv(sessionId: string): NodeJS.ProcessEnv {
    return {
      ...sanitizedProcessEnv(),
      ...agentIntegrationEnv(sessionId),
      ...(config.codexHome ? { CODEX_HOME: config.codexHome } : {})
    }
  }
}

function normalizeCodexFileChanges(changes: FileUpdateChange[]): AgentDiffFileChange[] {
  return changes.map((change) => ({
    path: change.path,
    previousPath: change.kind.type === 'update' ? change.kind.move_path : null,
    kind: normalizeCodexPatchKind(change.kind),
    diff: change.diff
  }))
}

function normalizeCodexPatchKind(kind: FileUpdateChange['kind']): AgentDiffFileChange['kind'] {
  switch (kind.type) {
    case 'add':
      return 'add'
    case 'delete':
      return 'delete'
    case 'update':
      return 'update'
  }
}

function parsePendingRequestPayload(request: AgentPendingRequest): {
  id: number | string
  method: string
  params: unknown
} {
  const parsed = JSON.parse(request.payloadJson) as {
    id: number | string
    method: string
    params: unknown
  }
  return parsed
}

function buildServerRequestResolution(method: string, resolution: CodexResolution): unknown {
  const allowed = resolution.decision === 'allow' || resolution.decision === 'answer'

  switch (method) {
    case 'item/commandExecution/requestApproval':
      return { decision: allowed ? 'accept' : 'decline' }
    case 'item/fileChange/requestApproval':
      return { decision: allowed ? 'accept' : 'decline' }
    case 'execCommandApproval':
    case 'applyPatchApproval':
      return { decision: allowed ? 'approved' : 'denied' }
    case 'item/tool/requestUserInput':
      return { answers: [resolution.answer ?? ''] }
    case 'mcpServer/elicitation/request':
      return {
        action: allowed ? 'accept' : 'decline',
        content: resolution.answer ?? null,
        _meta: null
      }
    default:
      return { decision: allowed ? 'accept' : 'decline' }
  }
}

function titleForThreadItem(item: ThreadItem): string {
  switch (item.type) {
    case 'commandExecution':
      return 'Command'
    case 'fileChange':
      return 'File change'
    case 'mcpToolCall':
      return `MCP tool: ${item.tool}`
    case 'dynamicToolCall':
      return `Tool: ${item.tool}`
    case 'webSearch':
      return 'Web search'
    case 'agentMessage':
      return 'Assistant message'
    case 'reasoning':
      return 'Reasoning'
    default:
      return item.type
  }
}

function summaryForThreadItem(item: ThreadItem): string | undefined {
  switch (item.type) {
    case 'commandExecution':
      return item.command
    case 'fileChange':
      return `${item.changes.length} file change${item.changes.length === 1 ? '' : 's'}`
    case 'mcpToolCall':
      return item.server
    case 'dynamicToolCall':
      return item.namespace ?? undefined
    case 'webSearch':
      return item.query
    case 'agentMessage':
      return item.text
    default:
      return undefined
  }
}
