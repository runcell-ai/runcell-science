import fs from 'node:fs/promises'
import path from 'node:path'

import type {
  Event,
  OpencodeClient,
  Part,
  PermissionRuleset,
  QuestionInfo,
  QuestionV2Info,
  Session,
  ToolPart
} from '@opencode-ai/sdk/v2'
import type {
  AgentRuntimeMode,
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
import { notebookAgentGuidance } from '../../notebook-guidance'
import {
  assertOpenCodeCompatibility,
  connectOpenCodeServer,
  isOpenCodeNotFound,
  OPENCODE_REQUEST_TIMEOUT_MS,
  parseOpenCodeModelSlug,
  type OpenCodeServerConnection
} from './opencode-server'

type OpenCodeQuestion = QuestionInfo | QuestionV2Info

interface PendingOpenCodeRequest {
  kind: 'permission' | 'permission-v2' | 'question' | 'question-v2'
  providerRequestId: string
  questions?: OpenCodeQuestion[]
}

interface OpenCodeSessionState {
  readonly localSessionId: string
  readonly connection: OpenCodeServerConnection
  readonly client: OpencodeClient
  readonly directory: string
  readonly providerSessionId: string
  readonly eventsAbortController: AbortController
  readonly pendingRequests: Map<string, PendingOpenCodeRequest>
  readonly pendingProviderRequestIds: Set<string>
  readonly messageRoles: Map<string, string>
  readonly parts: Map<string, Part>
  readonly emittedText: Map<string, string>
  readonly completedTextParts: Set<string>
  readonly toolStatuses: Map<string, string>
  readonly deferredInterruptEvents: Event[]
  unsubscribeExit: () => void
  activeTurnId: string | null
  interruptingTurnId: string | null
  deferredInterruptTerminal: { kind: 'idle' } | { kind: 'error'; message: string; raw?: unknown } | null
  disposed: boolean
}

export function buildOpenCodePermissionRules(runtimeMode: AgentRuntimeMode): PermissionRuleset {
  if (runtimeMode === 'full_access') {
    return [{ permission: '*', pattern: '*', action: 'allow' }]
  }
  return [
    { permission: '*', pattern: '*', action: 'ask' },
    { permission: 'question', pattern: '*', action: 'allow' }
  ]
}

export function mergeOpenCodeText(previous: string | undefined, incoming: string): {
  text: string
  delta: string
} {
  if (!previous) return { text: incoming, delta: incoming }
  if (incoming.startsWith(previous)) return { text: incoming, delta: incoming.slice(previous.length) }
  if (previous.startsWith(incoming)) return { text: previous, delta: '' }

  let common = 0
  const limit = Math.min(previous.length, incoming.length)
  while (common < limit && previous[common] === incoming[common]) common += 1
  if (common > 0) return { text: incoming, delta: incoming.slice(common) }
  return { text: `${previous}${incoming}`, delta: incoming }
}

export function buildOpenCodeQuestionResolution(
  questions: OpenCodeQuestion[],
  resolution: ResolveAgentRequestRequest
): { action: 'reply'; answers: string[][] } | { action: 'reject' } {
  if (resolution.decision === 'deny' || questions.length === 0) return { action: 'reject' }
  if (resolution.decision === 'answer' && resolution.answers?.length === questions.length) {
    const answers = resolution.answers.map((entries) => entries.map((entry) => entry.trim()).filter(Boolean))
    const valid = answers.every((entries, index) => {
      const question = questions[index]!
      if (entries.length === 0 || (!question.multiple && entries.length > 1)) return false
      const labels = new Set(question.options.map((option) => option.label))
      return entries.every((entry) => labels.has(entry) || question.custom === true)
    })
    return valid ? { action: 'reply', answers } : { action: 'reject' }
  }
  if (questions.length !== 1) return { action: 'reject' }
  const question = questions[0]!
  const answer = resolution.answer?.trim()
  if (
    resolution.decision === 'answer' &&
    answer &&
    (question.custom === true || question.options.some((option) => option.label === answer))
  ) {
    return { action: 'reply', answers: [[answer]] }
  }
  if (resolution.decision === 'allow' && question.options.length === 1) {
    return { action: 'reply', answers: [[question.options[0]!.label]] }
  }
  return { action: 'reject' }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const nested = record.error ?? record.data ?? record.body
    try {
      return JSON.stringify(nested ?? error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

function providerError(operation: string, error: unknown): RuntimeProviderError {
  return new RuntimeProviderError(
    'provider_request_failed',
    `OpenCode ${operation} failed: ${errorMessage(error)}`,
    502,
    { cause: error }
  )
}

function requestOptions(): { signal: AbortSignal } {
  return { signal: AbortSignal.timeout(OPENCODE_REQUEST_TIMEOUT_MS) }
}

function eventSessionId(event: Event): string | undefined {
  if (!('properties' in event) || !event.properties || typeof event.properties !== 'object') return undefined
  const properties = event.properties as Record<string, unknown>
  if (typeof properties.sessionID === 'string') return properties.sessionID
  const info = properties.info
  if (info && typeof info === 'object' && typeof (info as Record<string, unknown>).id === 'string') {
    return (info as Record<string, unknown>).id as string
  }
  return undefined
}

function assistantItemId(turnId: string, partId: string): string {
  return `opencode:${turnId}:${partId}`
}

function toolItemType(tool: string): string {
  const normalized = tool.toLowerCase()
  if (normalized.includes('bash') || normalized.includes('command') || normalized.includes('shell')) {
    return 'command_execution'
  }
  if (['edit', 'write', 'patch', 'multiedit'].some((name) => normalized.includes(name))) {
    return 'file_change'
  }
  if (normalized.includes('web')) return 'web_search'
  if (normalized.includes('mcp')) return 'mcp_tool_call'
  if (normalized.includes('image')) return 'image_view'
  if (normalized.includes('task') || normalized.includes('agent')) return 'collab_agent_tool_call'
  return 'dynamic_tool_call'
}

async function canonicalPath(value: string): Promise<string> {
  const resolved = path.resolve(value)
  try {
    return await fs.realpath(resolved)
  } catch {
    return resolved
  }
}

async function sameDirectory(left: string, right: string): Promise<boolean> {
  if (path.resolve(left) === path.resolve(right)) return true
  const [canonicalLeft, canonicalRight] = await Promise.all([canonicalPath(left), canonicalPath(right)])
  return canonicalLeft === canonicalRight
}

export class OpenCodeRuntime implements CodeAgentProviderRuntime {
  private readonly sessions = new Map<string, OpenCodeSessionState>()

  async startInitialTurn(input: RuntimeStartInitialTurnInput): Promise<void> {
    const state = await this.establishSession(input.session, true)
    try {
      await this.startPrompt(state, input.session, input.turn, input.message.text)
    } catch (error) {
      this.sessions.delete(input.session.id)
      await this.disposeState(state)
      throw error
    }
  }

  async startTurn(input: RuntimeStartTurnInput): Promise<void> {
    const state = this.sessions.get(input.session.id) ?? (await this.establishSession(input.session, false))
    await this.startPrompt(state, input.session, input.turn, input.message.text)
  }

  async resolveRequest(input: RuntimeResolveRequestInput): Promise<void> {
    const state = this.sessions.get(input.session.id)
    if (!state || state.disposed) {
      throw new RuntimeProviderError('provider_unavailable', 'OpenCode runtime is not active for this session.', 409)
    }
    const pending = state.pendingRequests.get(input.request.id)
    if (!pending) return

    try {
      if (pending.kind === 'permission') {
        await state.client.permission.reply({
          requestID: pending.providerRequestId,
          directory: state.directory,
          reply: input.resolution.decision === 'deny' ? 'reject' : 'once'
        }, requestOptions())
      } else if (pending.kind === 'permission-v2') {
        await state.client.v2.session.permission.reply({
          sessionID: state.providerSessionId,
          requestID: pending.providerRequestId,
          reply: input.resolution.decision === 'deny' ? 'reject' : 'once'
        }, requestOptions())
      } else {
        const result = buildOpenCodeQuestionResolution(pending.questions ?? [], input.resolution)
        if (pending.kind === 'question-v2') {
          if (result.action === 'reply') {
            await state.client.v2.session.question.reply({
              sessionID: state.providerSessionId,
              requestID: pending.providerRequestId,
              questionV2Reply: { answers: result.answers }
            }, requestOptions())
          } else {
            await state.client.v2.session.question.reject({
              sessionID: state.providerSessionId,
              requestID: pending.providerRequestId
            }, requestOptions())
          }
        } else if (result.action === 'reply') {
          await state.client.question.reply({
            requestID: pending.providerRequestId,
            directory: state.directory,
            answers: result.answers
          }, requestOptions())
        } else {
          await state.client.question.reject({
            requestID: pending.providerRequestId,
            directory: state.directory
          }, requestOptions())
        }
      }
    } catch (error) {
      throw providerError('request resolution', error)
    }

    state.pendingRequests.delete(input.request.id)
    state.pendingProviderRequestIds.delete(pending.providerRequestId)
  }

  async interrupt(input: RuntimeInterruptInput): Promise<void> {
    const state = this.sessions.get(input.session.id)
    if (!state || state.disposed) return
    const turnId = state.activeTurnId
    if (!turnId) return
    state.activeTurnId = null
    state.interruptingTurnId = turnId
    try {
      await state.client.session.abort({
        sessionID: state.providerSessionId,
        directory: state.directory
      }, requestOptions())
    } catch (error) {
      // A concurrent transport exit already stopped this state. Treat the
      // user's interrupt as successful so the route can settle the DB turn.
      if (state.disposed || this.sessions.get(input.session.id) !== state) return
      const deferred = state.deferredInterruptTerminal
      const deferredEvents = state.deferredInterruptEvents.splice(0)
      state.deferredInterruptTerminal = null
      state.interruptingTurnId = null
      state.activeTurnId = turnId
      for (const event of deferredEvents) this.handleEvent(state, event)
      if (deferred?.kind === 'idle') {
        this.completeActiveTurn(state)
      } else if (deferred?.kind === 'error') {
        this.failActiveTurn(state, deferred.message, deferred.raw)
      }
      throw providerError('interrupt', error)
    }

    // Retire the sidecar after an interrupt. This prevents a delayed idle/error
    // event from the aborted prompt from settling a newly-started local turn;
    // the next turn resumes the same upstream session on a fresh sidecar.
    if (this.sessions.get(input.session.id) === state) this.sessions.delete(input.session.id)
    await this.disposeState(state)
  }

  resetSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    this.sessions.delete(sessionId)
    void this.disposeState(state)
  }

  async dispose(): Promise<void> {
    const states = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(states.map((state) => this.disposeState(state)))
  }

  private async establishSession(session: AgentSession, createFresh: boolean): Promise<OpenCodeSessionState> {
    let connection: OpenCodeServerConnection | null = null
    let state: OpenCodeSessionState | null = null
    try {
      connection = await connectOpenCodeServer({ directory: session.cwd, sessionId: session.id })
      const client = connection.createClient(session.cwd)
      const version = await assertOpenCodeCompatibility(client, requestOptions().signal)
      if (connection.owned) await this.addBundledConnectors(client, session)

      let upstream: Session | undefined
      if (!createFresh && session.providerSessionId) {
        try {
          upstream = (
            await client.session.get(
              { sessionID: session.providerSessionId, directory: session.cwd },
              requestOptions()
            )
          ).data
        } catch (error) {
          if (!isOpenCodeNotFound(error)) throw error
        }
      }

      if (upstream && !(await sameDirectory(upstream.directory, session.cwd))) {
        const forked = await client.session.fork({
          sessionID: upstream.id,
          directory: session.cwd
        }, requestOptions())
        upstream = forked.data
        if (!upstream) throw new Error('OpenCode session fork returned no session.')
      }

      if (upstream) {
        await client.session.update({
          sessionID: upstream.id,
          directory: session.cwd,
          permission: buildOpenCodePermissionRules(session.runtimeMode)
        }, requestOptions())
      } else {
        const selectedModel = parseOpenCodeModelSlug(session.model ?? config.opencodeDefaultModel)
        const created = await client.session.create({
          directory: session.cwd,
          ...(session.title ? { title: session.title } : {}),
          ...(selectedModel
            ? { model: { providerID: selectedModel.providerID, id: selectedModel.modelID } }
            : {}),
          permission: buildOpenCodePermissionRules(session.runtimeMode)
        }, requestOptions())
        upstream = created.data
        if (!upstream) throw new Error('OpenCode session create returned no session.')
      }

      state = {
        localSessionId: session.id,
        connection,
        client,
        directory: session.cwd,
        providerSessionId: upstream.id,
        eventsAbortController: new AbortController(),
        pendingRequests: new Map(),
        pendingProviderRequestIds: new Set(),
        messageRoles: new Map(),
        parts: new Map(),
        emittedText: new Map(),
        completedTextParts: new Set(),
        toolStatuses: new Map(),
        deferredInterruptEvents: [],
        unsubscribeExit: () => undefined,
        activeTurnId: null,
        interruptingTurnId: null,
        deferredInterruptTerminal: null,
        disposed: false
      }
      const establishedState = state

      this.sessions.set(session.id, establishedState)
      establishedState.unsubscribeExit = connection.onExit((error) => this.handleUnexpectedExit(establishedState, error))
      await this.startEventPump(establishedState)
      agentSessionService.updateProviderBinding({
        sessionId: session.id,
        providerSessionId: upstream.id,
        providerThreadId: upstream.id,
        resumeCursorJson: JSON.stringify({ schemaVersion: 1, sessionId: upstream.id })
      })
      agentSessionService.recordRuntimeActivity({
        sessionId: session.id,
        turnId: null,
        provider: 'opencode',
        eventType: 'session.started',
        rawSource: 'opencode.server.health',
        rawJson: { version, url: connection.url, owned: connection.owned },
        title: 'OpenCode session started',
        summary: `OpenCode ${version}`,
        status: 'ready'
      })
      return establishedState
    } catch (error) {
      if (state) {
        if (this.sessions.get(session.id) === state) this.sessions.delete(session.id)
        await this.disposeState(state)
      } else if (connection) {
        await connection.dispose()
      }
      throw providerError('session setup', error)
    }
  }

  private async addBundledConnectors(client: OpencodeClient, session: AgentSession): Promise<void> {
    const configs = bundledScienceConnectorsService.getEnabledMcpConfigs(
      session.cwd,
      session.disabledMcpServers,
      session.id
    )
    for (const [name, entry] of Object.entries(configs)) {
      if (entry.type !== 'stdio' || !entry.command) continue
      await client.mcp.add({
        directory: session.cwd,
        name,
        config: {
          type: 'local',
          command: [entry.command, ...(entry.args ?? [])],
          cwd: session.cwd,
          environment: entry.env ?? {},
          enabled: true
        }
      }, requestOptions())
    }
  }

  private async startEventPump(state: OpenCodeSessionState): Promise<void> {
    const connectTimer = setTimeout(() => {
      state.eventsAbortController.abort(new Error('Timed out connecting to the OpenCode event stream.'))
    }, OPENCODE_REQUEST_TIMEOUT_MS)
    connectTimer.unref()
    const subscription = await state.client.event
      .subscribe(
        { directory: state.directory },
        { signal: state.eventsAbortController.signal }
      )
      .finally(() => clearTimeout(connectTimer))
    void (async () => {
      try {
        for await (const event of subscription.stream) {
          this.handleEvent(state, event)
        }
        if (!state.disposed && !state.eventsAbortController.signal.aborted) {
          this.handleUnexpectedExit(state, new Error('OpenCode event stream ended unexpectedly.'))
        }
      } catch (error) {
        if (!state.disposed && !state.eventsAbortController.signal.aborted) {
          this.handleUnexpectedExit(state, error instanceof Error ? error : new Error(String(error)))
        }
      }
    })()
  }

  private async startPrompt(
    state: OpenCodeSessionState,
    session: AgentSession,
    turn: AgentTurn,
    prompt: string
  ): Promise<void> {
    if (state.disposed) throw new RuntimeProviderError('provider_unavailable', 'OpenCode session is closed.', 409)
    if (state.activeTurnId) {
      throw new RuntimeProviderError('provider_request_failed', 'OpenCode session already has an active turn.', 409)
    }

    const selectedModel = parseOpenCodeModelSlug(session.model ?? config.opencodeDefaultModel)
    state.activeTurnId = turn.id
    agentSessionService.updateTurnProviderId({
      sessionId: session.id,
      turnId: turn.id,
      providerTurnId: `opencode:${state.providerSessionId}:${turn.id}`
    })
    try {
      await state.client.session.promptAsync({
        sessionID: state.providerSessionId,
        directory: state.directory,
        ...(selectedModel ? { model: selectedModel } : {}),
        system: notebookAgentGuidance,
        parts: [{ type: 'text', text: prompt }]
      }, requestOptions())
    } catch (error) {
      state.activeTurnId = null
      throw providerError('prompt', error)
    }
  }

  private handleEvent(state: OpenCodeSessionState, event: Event): void {
    if (state.disposed || eventSessionId(event) !== state.providerSessionId) return
    const turnId = state.activeTurnId

    // The abort request itself can fail after the upstream turn has continued
    // producing events. Keep those events in order so the original turn can be
    // restored without losing its final text, tools, or diff before replaying
    // the deferred terminal outcome.
    if (state.interruptingTurnId && !turnId) {
      if (event.type === 'session.idle') {
        state.deferredInterruptTerminal ??= { kind: 'idle' }
      } else if (event.type === 'session.error') {
        state.deferredInterruptTerminal = {
          kind: 'error',
          message: errorMessage(event.properties.error ?? 'OpenCode session failed.'),
          raw: event
        }
      } else if (event.type === 'session.status' && event.properties.status.type === 'idle') {
        state.deferredInterruptTerminal ??= { kind: 'idle' }
      } else {
        state.deferredInterruptEvents.push(event)
      }
      return
    }

    switch (event.type) {
      case 'message.updated':
        state.messageRoles.set(event.properties.info.id, event.properties.info.role)
        if (event.properties.info.role === 'assistant') {
          for (const part of state.parts.values()) {
            if (part.messageID === event.properties.info.id) this.handlePart(state, part, event)
          }
        }
        return
      case 'message.removed':
        state.messageRoles.delete(event.properties.messageID)
        return
      case 'message.part.updated':
        state.parts.set(event.properties.part.id, event.properties.part)
        this.handlePart(state, event.properties.part, event)
        return
      case 'message.part.delta': {
        const part = state.parts.get(event.properties.partID)
        if (!part || part.type !== 'text' || state.messageRoles.get(part.messageID) !== 'assistant' || !turnId) return
        const previous = state.emittedText.get(part.id) ?? ''
        const merged = mergeOpenCodeText(previous, event.properties.delta)
        state.emittedText.set(part.id, merged.text)
        if (merged.delta) this.appendAssistantDelta(state, turnId, part.id, merged.delta, event)
        return
      }
      case 'permission.asked':
        this.openPendingRequest(state, turnId, 'permission', event.properties.id, event.properties.permission, {
          permission: event.properties.permission,
          patterns: event.properties.patterns,
          metadata: event.properties.metadata
        })
        return
      case 'permission.v2.asked':
        this.openPendingRequest(state, turnId, 'permission-v2', event.properties.id, event.properties.action, {
          action: event.properties.action,
          resources: event.properties.resources,
          metadata: event.properties.metadata
        })
        return
      case 'question.asked':
        this.openPendingRequest(
          state,
          turnId,
          'question',
          event.properties.id,
          event.properties.questions[0]?.header ?? 'OpenCode question',
          { questions: event.properties.questions },
          event.properties.questions
        )
        return
      case 'question.v2.asked':
        this.openPendingRequest(
          state,
          turnId,
          'question-v2',
          event.properties.id,
          event.properties.questions[0]?.header ?? 'OpenCode question',
          { questions: event.properties.questions },
          event.properties.questions
        )
        return
      case 'session.diff':
        if (turnId) this.recordDiff(state, turnId, event)
        return
      case 'session.status':
        if (event.properties.status.type === 'retry') {
          this.recordActivity(state, turnId, 'runtime.warning', 'OpenCode retry', event.properties.status.message, 'warning', event)
        } else if (event.properties.status.type === 'idle') {
          if (state.interruptingTurnId) state.deferredInterruptTerminal ??= { kind: 'idle' }
          else this.completeActiveTurn(state)
        }
        return
      case 'session.idle':
        if (state.interruptingTurnId) state.deferredInterruptTerminal ??= { kind: 'idle' }
        else this.completeActiveTurn(state)
        return
      case 'session.error':
        if (state.interruptingTurnId) {
          state.deferredInterruptTerminal = {
            kind: 'error',
            message: errorMessage(event.properties.error ?? 'OpenCode session failed.'),
            raw: event
          }
        } else this.failActiveTurn(state, errorMessage(event.properties.error ?? 'OpenCode session failed.'), event)
        return
      default:
        return
    }
  }

  private handlePart(state: OpenCodeSessionState, part: Part, raw: Event): void {
    const turnId = state.activeTurnId
    if (!turnId || state.messageRoles.get(part.messageID) !== 'assistant') return

    if (part.type === 'text') {
      const merged = mergeOpenCodeText(state.emittedText.get(part.id), part.text)
      state.emittedText.set(part.id, merged.text)
      if (merged.delta) this.appendAssistantDelta(state, turnId, part.id, merged.delta, raw)
      if (part.time?.end !== undefined && !state.completedTextParts.has(part.id)) {
        state.completedTextParts.add(part.id)
        agentSessionService.completeAssistantMessageItem({
          sessionId: state.localSessionId,
          turnId,
          provider: 'opencode',
          text: merged.text,
          providerItemId: assistantItemId(turnId, part.id),
          phase: 'final_answer'
        })
      }
      return
    }

    if (part.type === 'tool') this.recordToolPart(state, turnId, part, raw)
  }

  private appendAssistantDelta(state: OpenCodeSessionState, turnId: string, partId: string, delta: string, raw: Event): void {
    agentSessionService.appendAssistantMessageDelta({
      sessionId: state.localSessionId,
      turnId,
      provider: 'opencode',
      delta,
      providerItemId: assistantItemId(turnId, partId),
      rawSource: 'opencode.sdk.event',
      rawJson: raw,
      canonicalJson: {
        type: 'content.delta',
        streamKind: 'assistant_text',
        delta,
        providerItemId: assistantItemId(turnId, partId)
      }
    })
  }

  private recordToolPart(state: OpenCodeSessionState, turnId: string, part: ToolPart, raw: Event): void {
    const previous = state.toolStatuses.get(part.callID)
    const status = part.state.status
    if (previous === status || (status === 'running' && previous === 'pending')) return
    state.toolStatuses.set(part.callID, status)
    const terminal = status === 'completed' || status === 'error'
    const summary =
      status === 'completed' ? part.state.output : status === 'error' ? part.state.error : JSON.stringify(part.state.input)
    this.recordActivity(
      state,
      turnId,
      terminal ? 'item.completed' : 'item.started',
      status === 'running' ? (part.state.title ?? part.tool) : part.tool,
      summary,
      status === 'error' ? 'failed' : terminal ? 'completed' : 'started',
      raw,
      {
        type: terminal ? 'item.completed' : 'item.started',
        itemType: toolItemType(part.tool),
        providerItemId: part.callID,
        tool: part.tool,
        state: part.state
      }
    )
  }

  private openPendingRequest(
    state: OpenCodeSessionState,
    turnId: string | null,
    kind: PendingOpenCodeRequest['kind'],
    providerRequestId: string,
    title: string,
    payload: Record<string, unknown>,
    questions?: OpenCodeQuestion[]
  ): void {
    if (!turnId || state.pendingProviderRequestIds.has(providerRequestId)) return
    const request = agentSessionService.openPendingRequest({
      sessionId: state.localSessionId,
      turnId,
      type: `opencode.${kind}`,
      title,
      payloadJson: { providerRequestId, kind, ...payload }
    })
    state.pendingProviderRequestIds.add(providerRequestId)
    state.pendingRequests.set(request.id, { kind, providerRequestId, ...(questions ? { questions } : {}) })
  }

  private recordDiff(state: OpenCodeSessionState, turnId: string, event: Extract<Event, { type: 'session.diff' }>): void {
    const files = event.properties.diff
      .filter((entry) => entry.file && entry.patch)
      .map((entry) => ({
        path: entry.file!,
        previousPath: null,
        kind: entry.status === 'added' ? ('add' as const) : entry.status === 'deleted' ? ('delete' as const) : ('update' as const),
        diff: entry.patch!
      }))
    if (files.length === 0) return
    agentSessionService.recordTurnDiff({
      sessionId: state.localSessionId,
      turnId,
      provider: 'opencode',
      providerTurnId: `opencode:${state.providerSessionId}:${turnId}`,
      providerItemId: 'opencode:session.diff',
      files,
      rawSource: 'opencode.sdk.event',
      rawJson: event
    })
  }

  private completeActiveTurn(state: OpenCodeSessionState): void {
    const turnId = state.activeTurnId
    if (!turnId) return
    state.activeTurnId = null
    agentSessionService.completeTurn(state.localSessionId, turnId, { finalResponseFallback: true })
  }

  private failActiveTurn(state: OpenCodeSessionState, message: string, raw?: unknown): void {
    const turnId = state.activeTurnId
    state.activeTurnId = null
    const detail = agentSessionService.getSessionDetail(state.localSessionId)
    if (!detail) return

    if (!detail.session.activatedAt) {
      // promptAsync only acknowledges the prompt. A failure can therefore
      // arrive later on the event stream, after startInitialTurn returned to
      // the route. Pending sessions have no visible assistant output and must
      // be discarded together with their managed server.
      agentSessionService.discardPendingActivationSession(state.localSessionId)
      if (this.sessions.get(state.localSessionId) === state) {
        this.sessions.delete(state.localSessionId)
      }
      void this.disposeState(state)
      return
    }

    if (turnId) agentSessionService.failTurn(state.localSessionId, turnId, message)
    this.recordActivity(state, turnId, 'runtime.error', 'OpenCode runtime error', message, 'error', raw)
  }

  private recordActivity(
    state: OpenCodeSessionState,
    turnId: string | null,
    eventType: string,
    title: string,
    summary: string | undefined,
    status: string,
    raw?: unknown,
    canonicalJson?: Record<string, unknown>
  ): void {
    agentSessionService.recordRuntimeActivity({
      sessionId: state.localSessionId,
      turnId,
      provider: 'opencode',
      eventType,
      rawSource: 'opencode.sdk.event',
      rawJson: raw,
      canonicalJson,
      title,
      ...(summary ? { summary } : {}),
      status
    })
  }

  private handleUnexpectedExit(state: OpenCodeSessionState, error: Error): void {
    if (state.disposed || this.sessions.get(state.localSessionId) !== state) return
    this.sessions.delete(state.localSessionId)
    this.failActiveTurn(state, error.message)
    void this.disposeState(state)
  }

  private async disposeState(state: OpenCodeSessionState): Promise<void> {
    if (state.disposed) return
    state.disposed = true
    state.unsubscribeExit()
    state.eventsAbortController.abort()
    try {
      if (state.activeTurnId) {
        await state.client.session.abort({
          sessionID: state.providerSessionId,
          directory: state.directory
        }, requestOptions())
      }
    } catch {
      // Best-effort abort; server/process teardown below is authoritative.
    }
    await state.connection.dispose()
  }
}
