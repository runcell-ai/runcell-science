import type {
  AgentMessage,
  AgentPendingRequest,
  AgentSession,
  AgentTurn,
  ResolveAgentRequestRequest
} from '@runcell-science/contracts'

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
import { GrokAcpClient, type GrokAcpMessage } from './acp-client'
import type {
  AcpContentBlock,
  AcpInitializeResponse,
  AcpPromptResponse,
  AcpRequestPermissionParams,
  AcpSessionSetupResponse,
  AcpSessionUpdate,
  AcpSessionUpdateParams,
  AcpStdioMcpServer,
  XAiAskUserQuestionParams,
  XAiPromptCompleteParams
} from './acp-types'
import { unwrapAskUserQuestionParams } from './acp-types'

export const GROK_AUTH_METHOD_API_KEY = 'xai.api_key'
export const GROK_AUTH_METHOD_CACHED_TOKEN = 'cached_token'
const GROK_OAUTH_REFERRER = 'open-science'
const ACP_PROTOCOL_VERSION = 1

const XAI_PROMPT_COMPLETE_METHOD = '_x.ai/session/prompt_complete'
const XAI_ASK_USER_QUESTION_METHODS = new Set(['x.ai/ask_user_question', '_x.ai/ask_user_question'])
const ACP_REQUEST_PERMISSION_METHOD = 'session/request_permission'

// Session-establishing RPCs must fail fast instead of hanging the HTTP request
// when the agent wedges (e.g. `grok login` never ran on this machine).
const SESSION_RPC_TIMEOUT_MS = 60_000
const COMPLETED_PROMPT_ID_LIMIT = 32

/**
 * session/update kinds that stream too fast to persist per-chunk. Thoughts
 * arrive as dozens of chunks per turn and user_message_chunk merely echoes the
 * prompt we just sent; both would flood the timeline.
 */
const ignoredSessionUpdateKinds = new Set<string>([
  'agent_thought_chunk',
  'user_message_chunk',
  'available_commands_update',
  'current_mode_update'
])

interface GrokPromptFallback {
  promptId: string
  settle: (response: AcpPromptResponse) => void
}

interface GrokSessionState {
  sessionId: string
  client: GrokAcpClient
  providerSessionId: string | null
  currentModelId: string | null
  supportsLoadSession: boolean
  /** True while session/load replays history; replayed updates are dropped. */
  replaying: boolean
  guidancePending: boolean
  activeLocalTurnId: string | null
  nextPromptSeq: number
  activePromptFallback: GrokPromptFallback | null
  completedPromptIds: string[]
  pendingServerRequests: Map<string, number | string>
}

export function resolveGrokAuthMethodId(env: NodeJS.ProcessEnv): string {
  return env.XAI_API_KEY?.trim() ? GROK_AUTH_METHOD_API_KEY : GROK_AUTH_METHOD_CACHED_TOKEN
}

export function grokAssistantProviderItemId(turnId: string): string {
  return `grok:${turnId}:assistant`
}

export class GrokRuntime implements CodeAgentProviderRuntime {
  private readonly sessions = new Map<string, GrokSessionState>()

  async startInitialTurn(input: RuntimeStartInitialTurnInput): Promise<void> {
    const state = await this.createInitializedState(input.session)

    // On any failure past this point the HTTP route discards the pending
    // database session, so the runtime state must go too — otherwise the
    // orphaned agent process keeps emitting events against a session id
    // whose rows no longer exist.
    try {
      const setup = await this.requestSessionSetup(state, input.session, 'session/new', {
        cwd: input.session.cwd,
        mcpServers: buildGrokMcpServers(input.session)
      })
      state.guidancePending = true
      this.bindProviderSession(state, input.session.id, setup)

      await this.applyModelSelection(state, input.session)
      this.startPrompt(state, input.session, input.turn, input.message)
    } catch (error) {
      this.resetSession(input.session.id)
      throw error
    }
  }

  async startTurn(input: RuntimeStartTurnInput): Promise<void> {
    const state = await this.ensureStateForSession(input.session)
    await this.applyModelSelection(state, input.session)
    this.startPrompt(state, input.session, input.turn, input.message)
  }

  async resolveRequest(input: RuntimeResolveRequestInput): Promise<void> {
    const state = this.sessions.get(input.session.id)
    if (!state) {
      throw new RuntimeProviderError(
        'provider_unavailable',
        'Grok runtime is not active for this session.',
        409
      )
    }

    const serverRequestId = state.pendingServerRequests.get(input.request.id)
    if (serverRequestId === undefined) {
      return
    }

    const payload = parsePendingRequestPayload(input.request)
    state.client.respond(serverRequestId, buildServerRequestResolution(payload.method, payload.params, input.resolution))
    state.pendingServerRequests.delete(input.request.id)
  }

  async interrupt(input: RuntimeInterruptInput): Promise<void> {
    const state = this.sessions.get(input.session.id)
    if (!state?.providerSessionId) {
      return
    }

    // ACP cancellation is a notification; the in-flight session/prompt then
    // resolves with stopReason "cancelled" and settles the turn.
    state.client.notify('session/cancel', { sessionId: state.providerSessionId })
  }

  resetSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) {
      return
    }
    state.client.dispose()
    this.sessions.delete(sessionId)
  }

  async dispose(): Promise<void> {
    for (const state of this.sessions.values()) {
      state.client.dispose()
    }
    this.sessions.clear()
  }

  private async createInitializedState(session: AgentSession): Promise<GrokSessionState> {
    const env = this.buildEnv(session.id)
    const client = new GrokAcpClient({
      binaryPath: config.grokBinaryPath,
      cwd: session.cwd,
      env
    })

    const state: GrokSessionState = {
      sessionId: session.id,
      client,
      providerSessionId: null,
      currentModelId: null,
      supportsLoadSession: false,
      replaying: false,
      guidancePending: false,
      activeLocalTurnId: null,
      nextPromptSeq: 0,
      activePromptFallback: null,
      completedPromptIds: [],
      pendingServerRequests: new Map()
    }

    client.on('notification', (message) => {
      this.handleNotification(state, message as GrokAcpMessage)
    })
    client.on('serverRequest', (message) => {
      this.handleServerRequest(state, message as GrokAcpMessage)
    })
    // A throw inside an EventEmitter callback would crash the server, and
    // late events can race session deletion (their insert then fails the
    // session foreign key) — swallow persistence errors for log-only events.
    client.on('stderr', (line) => {
      try {
        agentSessionService.recordRuntimeActivity({
          sessionId: session.id,
          turnId: state.activeLocalTurnId,
          provider: 'grok',
          eventType: 'stderr',
          rawSource: 'grok.acp.stderr',
          rawJson: { line },
          title: 'Grok runtime log',
          summary: line,
          status: 'info'
        })
      } catch {
        // Session rows are gone; nothing to record against.
      }
    })
    client.on('error', (error: Error) => {
      try {
        agentSessionService.recordRuntimeActivity({
          sessionId: session.id,
          turnId: state.activeLocalTurnId,
          provider: 'grok',
          eventType: 'runtime.error',
          rawSource: 'grok.acp.client',
          rawJson: { message: error.message },
          title: 'Grok runtime error',
          summary: error.message,
          status: 'error'
        })
      } catch {
        // Session rows are gone; nothing to record against.
      }
    })
    client.on('exit', () => {
      // Guard by identity: after a resetSession the old child exits
      // asynchronously, and by then a replacement state may already own this
      // session id — deleting blindly would orphan the replacement.
      if (this.sessions.get(session.id) === state) {
        this.sessions.delete(session.id)
      }
    })

    try {
      const init = await client.request<AcpInitializeResponse>('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientInfo: {
          name: 'open_science',
          title: 'Runcell Science',
          version: '0.1.0'
        },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false }
        }
      }, SESSION_RPC_TIMEOUT_MS)
      state.supportsLoadSession = init.agentCapabilities?.loadSession === true

      await client.request('authenticate', {
        methodId: resolveGrokAuthMethodId(env)
      }, SESSION_RPC_TIMEOUT_MS)
    } catch (error) {
      client.dispose()
      throw new RuntimeProviderError(
        'provider_unavailable',
        `Failed to start Grok agent: ${error instanceof Error ? error.message : String(error)}. ` +
          `Make sure the Grok CLI is installed and authenticated (run \`grok login\`) or set XAI_API_KEY.`,
        502,
        { cause: error }
      )
    }

    this.sessions.set(session.id, state)
    return state
  }

  private async ensureStateForSession(session: AgentSession): Promise<GrokSessionState> {
    const existing = this.sessions.get(session.id)
    if (existing) {
      return existing
    }

    if (!session.providerSessionId) {
      throw new RuntimeProviderError(
        'provider_request_failed',
        'Grok session has no provider session id to resume.',
        409
      )
    }

    const state = await this.createInitializedState(session)
    if (!state.supportsLoadSession) {
      state.client.dispose()
      this.sessions.delete(session.id)
      throw new RuntimeProviderError(
        'provider_request_failed',
        'This Grok CLI version does not support resuming sessions (session/load).',
        409
      )
    }

    state.replaying = true
    try {
      const setup = await this.requestSessionSetup(state, session, 'session/load', {
        sessionId: session.providerSessionId,
        cwd: session.cwd,
        mcpServers: buildGrokMcpServers(session)
      })
      this.bindProviderSession(state, session.id, setup, session.providerSessionId)
    } finally {
      state.replaying = false
    }

    return state
  }

  private async requestSessionSetup(
    state: GrokSessionState,
    session: AgentSession,
    method: 'session/new' | 'session/load',
    params: Record<string, unknown>
  ): Promise<AcpSessionSetupResponse> {
    try {
      return await state.client.request<AcpSessionSetupResponse>(method, params, SESSION_RPC_TIMEOUT_MS)
    } catch (error) {
      state.client.dispose()
      this.sessions.delete(session.id)
      throw new RuntimeProviderError(
        'provider_request_failed',
        `Grok ${method} failed: ${error instanceof Error ? error.message : String(error)}`,
        502,
        { cause: error }
      )
    }
  }

  private bindProviderSession(
    state: GrokSessionState,
    sessionId: string,
    setup: AcpSessionSetupResponse,
    fallbackProviderSessionId?: string
  ): void {
    const providerSessionId = setup.sessionId ?? fallbackProviderSessionId ?? null
    state.providerSessionId = providerSessionId
    state.currentModelId = setup.models?.currentModelId?.trim() || null

    if (providerSessionId) {
      agentSessionService.updateProviderBinding({
        sessionId,
        providerSessionId,
        providerThreadId: providerSessionId,
        resumeCursorJson: JSON.stringify({ sessionId: providerSessionId })
      })
    }
  }

  private async applyModelSelection(state: GrokSessionState, session: AgentSession): Promise<void> {
    const requestedModel = (session.model ?? config.grokDefaultModel)?.trim()
    if (!requestedModel || requestedModel === state.currentModelId || !state.providerSessionId) {
      return
    }

    try {
      await state.client.request('session/set_model', {
        sessionId: state.providerSessionId,
        modelId: requestedModel
      }, SESSION_RPC_TIMEOUT_MS)
      state.currentModelId = requestedModel
    } catch (error) {
      throw new RuntimeProviderError(
        'provider_request_failed',
        `Failed to select Grok model '${requestedModel}': ${error instanceof Error ? error.message : String(error)}`,
        502,
        { cause: error }
      )
    }
  }

  /**
   * Fires session/prompt without awaiting it: unlike Codex's turn/start, the
   * ACP prompt request only resolves when the whole turn finishes. Settlement
   * races the RPC response against Grok's private prompt_complete notification
   * (some Grok builds drop the standard response, so the private notification
   * acts as a compatibility fallback).
   */
  private startPrompt(
    state: GrokSessionState,
    session: AgentSession,
    turn: AgentTurn,
    message: AgentMessage
  ): void {
    if (!state.providerSessionId) {
      throw new RuntimeProviderError('provider_request_failed', 'Grok session is not initialized.', 500)
    }
    if (state.activeLocalTurnId) {
      throw new RuntimeProviderError('provider_request_failed', 'Grok session already has an active turn.', 409)
    }

    state.activeLocalTurnId = turn.id
    state.nextPromptSeq += 1
    const promptId = `open-science-grok-${state.nextPromptSeq}`

    agentSessionService.updateTurnProviderId({
      sessionId: session.id,
      turnId: turn.id,
      providerTurnId: promptId
    })

    const prompt: AcpContentBlock[] = []
    if (state.guidancePending) {
      // ACP has no developer-instructions channel (Codex) or system-prompt
      // append (Claude); the workspace guidance rides in the first prompt of a
      // fresh provider session instead.
      state.guidancePending = false
      prompt.push({ type: 'text', text: notebookAgentGuidance })
    }
    prompt.push({ type: 'text', text: message.text })

    const fallback = new Promise<AcpPromptResponse>((resolve) => {
      state.activePromptFallback = { promptId, settle: resolve }
    })
    const request = state.client.request<AcpPromptResponse>('session/prompt', {
      sessionId: state.providerSessionId,
      prompt,
      _meta: { promptId, requestId: promptId }
    })

    void Promise.race([request, fallback])
      .then((response) => {
        this.settleTurn(state, session.id, turn.id, promptId, response ?? {})
      })
      .catch((error) => {
        this.failActiveTurn(state, session.id, turn.id, promptId, error)
      })
  }

  private settleTurn(
    state: GrokSessionState,
    sessionId: string,
    turnId: string,
    promptId: string,
    response: AcpPromptResponse
  ): void {
    if (!this.clearActivePrompt(state, turnId, promptId)) {
      return
    }

    const stopReason = response.stopReason ?? 'end_turn'
    agentSessionService.recordRuntimeActivity({
      sessionId,
      turnId,
      provider: 'grok',
      eventType: 'turn.completed',
      rawSource: 'grok.acp.prompt',
      rawJson: response,
      canonicalJson: { type: 'turn.completed', stopReason, promptId },
      title: 'Grok turn completed',
      status: stopReason
    })

    if (stopReason === 'cancelled') {
      agentSessionService.interruptRunningTurn(sessionId)
      return
    }

    if (stopReason === 'refusal') {
      agentSessionService.failTurn(sessionId, turnId, 'Grok declined to continue with this request.')
      return
    }

    agentSessionService.completeTurn(sessionId, turnId, { finalResponseFallback: true })
  }

  private failActiveTurn(
    state: GrokSessionState,
    sessionId: string,
    turnId: string,
    promptId: string,
    error: unknown
  ): void {
    if (!this.clearActivePrompt(state, turnId, promptId)) {
      return
    }

    const message = error instanceof Error ? error.message : String(error)
    const detail = agentSessionService.getSessionDetail(sessionId)
    if (detail?.session.activatedAt) {
      agentSessionService.failTurn(sessionId, turnId, message)
    } else {
      // The prompt rejection arrives on a detached promise, past the reach of
      // startInitialTurn's cleanup. Discarding the database session without
      // also dropping the runtime state would leave the agent process running
      // for a session that no longer exists.
      agentSessionService.discardPendingActivationSession(sessionId)
      if (this.sessions.get(sessionId) === state) {
        state.client.dispose()
        this.sessions.delete(sessionId)
      }
    }
  }

  /** Returns false when another path already settled this prompt. */
  private clearActivePrompt(state: GrokSessionState, turnId: string, promptId: string): boolean {
    if (state.completedPromptIds.includes(promptId)) {
      return false
    }
    state.completedPromptIds = [...state.completedPromptIds, promptId].slice(-COMPLETED_PROMPT_ID_LIMIT)
    if (state.activeLocalTurnId === turnId) {
      state.activeLocalTurnId = null
    }
    state.activePromptFallback = null
    return true
  }

  private handleNotification(state: GrokSessionState, message: GrokAcpMessage): void {
    if (message.method === 'session/update') {
      this.handleSessionUpdate(state, message)
      return
    }

    if (message.method === XAI_PROMPT_COMPLETE_METHOD) {
      this.handlePromptComplete(state, message.params as XAiPromptCompleteParams | undefined)
      return
    }

    // The remaining traffic is xAI private chatter (announcements, settings,
    // session lists, MCP progress) with no session/turn meaning for us.
  }

  private handleSessionUpdate(state: GrokSessionState, message: GrokAcpMessage): void {
    if (state.replaying) {
      return
    }

    const params = message.params as AcpSessionUpdateParams | undefined
    const update = params?.update
    const kind = update?.sessionUpdate
    if (!update || !kind || ignoredSessionUpdateKinds.has(kind)) {
      return
    }

    if (kind === 'agent_message_chunk') {
      if (!state.activeLocalTurnId || update.content?.type !== 'text' || !update.content.text) {
        return
      }
      agentSessionService.appendAssistantMessageDelta({
        sessionId: state.sessionId,
        turnId: state.activeLocalTurnId,
        provider: 'grok',
        delta: update.content.text,
        providerItemId: grokAssistantProviderItemId(state.activeLocalTurnId),
        rawSource: 'grok.acp.session_update',
        rawJson: message,
        canonicalJson: {
          type: 'content.delta',
          streamKind: 'assistant_text',
          delta: update.content.text,
          providerItemId: grokAssistantProviderItemId(state.activeLocalTurnId)
        }
      })
      return
    }

    if (kind === 'tool_call' || kind === 'tool_call_update') {
      this.recordToolCallActivity(state, kind, update, message)
      return
    }

    if (kind === 'plan') {
      agentSessionService.recordRuntimeActivity({
        sessionId: state.sessionId,
        turnId: state.activeLocalTurnId,
        provider: 'grok',
        eventType: 'plan.updated',
        rawSource: 'grok.acp.session_update',
        rawJson: message,
        title: 'Plan updated',
        summary: summarizePlan(update.entries),
        status: 'info'
      })
      return
    }

    agentSessionService.recordRuntimeActivity({
      sessionId: state.sessionId,
      turnId: state.activeLocalTurnId,
      provider: 'grok',
      eventType: `session_update.${kind}`,
      rawSource: 'grok.acp.session_update',
      rawJson: message,
      title: kind,
      status: 'info'
    })
  }

  private recordToolCallActivity(
    state: GrokSessionState,
    kind: 'tool_call' | 'tool_call_update',
    update: AcpSessionUpdate,
    message: GrokAcpMessage
  ): void {
    const status = typeof update.status === 'string' ? update.status : undefined
    // tool_call announces the call; updates stream constantly, so only their
    // terminal states are worth a timeline row.
    if (kind === 'tool_call_update' && status !== 'completed' && status !== 'failed') {
      return
    }

    const title = typeof update.title === 'string' && update.title.trim() ? update.title : 'Tool call'
    agentSessionService.recordRuntimeActivity({
      sessionId: state.sessionId,
      turnId: state.activeLocalTurnId,
      provider: 'grok',
      eventType: kind === 'tool_call' ? 'item.started' : `item.${status}`,
      rawSource: 'grok.acp.session_update',
      rawJson: message,
      canonicalJson: {
        type: kind === 'tool_call' ? 'item.started' : `item.${status}`,
        itemType: typeof update.kind === 'string' ? update.kind : 'tool_call',
        itemId: typeof update.toolCallId === 'string' ? update.toolCallId : null
      },
      title,
      summary: typeof update.kind === 'string' ? update.kind : undefined,
      status: kind === 'tool_call' ? 'started' : status
    })
  }

  private handlePromptComplete(state: GrokSessionState, params: XAiPromptCompleteParams | undefined): void {
    const fallback = state.activePromptFallback
    if (!fallback || !params) {
      return
    }
    if (params.promptId !== undefined && params.promptId !== fallback.promptId) {
      return
    }

    fallback.settle({
      stopReason: normalizeStopReason(params.stopReason),
      _meta: {
        source: XAI_PROMPT_COMPLETE_METHOD,
        ...(params.promptId !== undefined ? { promptId: params.promptId } : {})
      }
    })
  }

  private handleServerRequest(state: GrokSessionState, message: GrokAcpMessage): void {
    const method = message.method ?? ''
    const isPermission = method === ACP_REQUEST_PERMISSION_METHOD
    const isUserQuestion = XAI_ASK_USER_QUESTION_METHODS.has(method)

    if (!isPermission && !isUserQuestion) {
      state.client.respondError(message.id ?? 0, -32601, `Method '${method}' is not supported by this client.`)
      return
    }

    if (!state.activeLocalTurnId) {
      // Pending requests must attach to a turn; without one the only safe
      // answer is a cancel so the agent does not hang. The two request kinds
      // use different cancellation shapes: ACP permission nests the outcome,
      // xAI ask_user_question expects it at the top level.
      state.client.respond(
        message.id ?? 0,
        isUserQuestion ? { outcome: 'cancelled' } : { outcome: { outcome: 'cancelled' } }
      )
      return
    }

    const request = agentSessionService.openPendingRequest({
      sessionId: state.sessionId,
      turnId: state.activeLocalTurnId,
      type: method,
      title: titleForServerRequest(method, message.params),
      payloadJson: {
        id: message.id,
        method,
        params: message.params
      }
    })

    state.pendingServerRequests.set(request.id, message.id ?? 0)
  }

  private buildEnv(sessionId: string): NodeJS.ProcessEnv {
    return {
      ...sanitizedProcessEnv(),
      ...agentIntegrationEnv(sessionId),
      GROK_OAUTH2_REFERRER: GROK_OAUTH_REFERRER
    }
  }
}

function buildGrokMcpServers(session: AgentSession): AcpStdioMcpServer[] {
  const bundled = bundledScienceConnectorsService.getEnabledMcpConfigs(
    session.cwd,
    session.disabledMcpServers,
    session.id
  )

  const servers: AcpStdioMcpServer[] = []
  for (const [name, entry] of Object.entries(bundled)) {
    if (entry.type !== 'stdio' || !entry.command) {
      continue
    }
    servers.push({
      name,
      command: entry.command,
      args: entry.args ?? [],
      env: Object.entries(entry.env ?? {}).map(([envName, value]) => ({ name: envName, value }))
    })
  }
  return servers
}

function parsePendingRequestPayload(request: AgentPendingRequest): {
  id: number | string
  method: string
  params: unknown
} {
  return JSON.parse(request.payloadJson) as {
    id: number | string
    method: string
    params: unknown
  }
}

export function buildServerRequestResolution(
  method: string,
  params: unknown,
  resolution: ResolveAgentRequestRequest
): unknown {
  if (XAI_ASK_USER_QUESTION_METHODS.has(method)) {
    return buildAskUserQuestionResolution(params as XAiAskUserQuestionParams, resolution)
  }

  const allowed = resolution.decision === 'allow' || resolution.decision === 'answer'
  const options = (params as AcpRequestPermissionParams | undefined)?.options ?? []
  // Only ever select an option whose kind matches the user's decision — a
  // fallback to "any option" could silently invert a denial into an approval
  // (or vice versa). With no same-direction option, cancelling is the only
  // safe answer; ACP treats a cancelled permission request as not granted.
  const preferredKinds = allowed ? ['allow_once', 'allow_always'] : ['reject_once', 'reject_always']
  const option = preferredKinds
    .map((kind) => options.find((entry) => entry.kind === kind))
    .find((entry) => entry !== undefined)

  if (!option) {
    return { outcome: { outcome: 'cancelled' } }
  }
  return { outcome: { outcome: 'selected', optionId: option.optionId } }
}

function buildAskUserQuestionResolution(
  params: XAiAskUserQuestionParams | undefined,
  resolution: ResolveAgentRequestRequest
): unknown {
  if (resolution.decision === 'deny') {
    return { outcome: 'cancelled' }
  }

  const questions = params ? (unwrapAskUserQuestionParams(params).questions ?? []) : []
  const question = questions[0]
  // The request card surfaces only the first question's text — not the other
  // questions and not the options. Answering anything the user has not seen
  // would put words in their mouth, so: accept an explicit answer, let a bare
  // Allow confirm a question with exactly one option, and cancel everything
  // else until a real question UI exists.
  if (!question || questions.length > 1) {
    return { outcome: 'cancelled' }
  }

  const answerText = resolution.answer?.trim()
  if (answerText) {
    return { outcome: 'accepted', answers: { [question.question]: [answerText] } }
  }

  const loneOption = question.options.length === 1 ? question.options[0]?.label : undefined
  if (loneOption) {
    return { outcome: 'accepted', answers: { [question.question]: [loneOption] } }
  }
  return { outcome: 'cancelled' }
}

function titleForServerRequest(method: string, params: unknown): string {
  if (XAI_ASK_USER_QUESTION_METHODS.has(method)) {
    const questions = unwrapAskUserQuestionParams((params ?? {}) as XAiAskUserQuestionParams).questions
    const first = questions?.[0]?.question ?? 'Grok question'
    return questions && questions.length > 1 ? `${first} (+${questions.length - 1} more questions)` : first
  }

  const toolCall = (params as AcpRequestPermissionParams | undefined)?.toolCall
  return toolCall?.title?.trim() || 'Permission request'
}

function summarizePlan(entries: { content?: string; status?: string }[] | undefined): string | undefined {
  if (!entries || entries.length === 0) {
    return undefined
  }
  const done = entries.filter((entry) => entry.status === 'completed').length
  return `${done}/${entries.length} steps completed`
}

function normalizeStopReason(value: string | undefined): string {
  switch (value) {
    case 'cancelled':
    case 'end_turn':
    case 'max_tokens':
    case 'max_turn_requests':
    case 'refusal':
      return value
    default:
      return 'end_turn'
  }
}
