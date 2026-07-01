import crypto from 'node:crypto'

import type {
  AgentMessage,
  AgentPendingRequest,
  AgentProvider,
  AgentRuntimeMode,
  AgentSession,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTurn,
  CreateAgentSessionResponse
} from '@open-science/contracts'

import { sessionEventBus } from '../runtime/session-event-bus'
import {
  AgentSessionRepository,
  type AppendAssistantMessageDeltaInput,
  type CreatePendingAgentSessionInput,
  type CreatePendingRequestInput,
  type PersistAgentEventInput
} from './agent-session-repository'

export interface CreateAgentSessionDraftInput {
  provider: AgentProvider
  cwd: string
  initialMessage: string
  model?: string | null
  runtimeMode?: AgentRuntimeMode
}

export interface CleanupStalePendingActivationInput {
  olderThanMs?: number
}

export interface StartFollowupTurnInput {
  sessionId: string
  message: string
}

export interface ResolveAgentPendingRequestInput {
  sessionId: string
  requestId: string
  responseJson: unknown
}

export interface UpdateProviderBindingInput {
  sessionId: string
  providerSessionId?: string | null
  providerThreadId?: string | null
  resumeCursorJson?: string | null
}

export interface UpdateProviderTurnInput {
  sessionId: string
  turnId: string
  providerTurnId: string
}

export interface RecordRuntimeActivityInput extends PersistAgentEventInput {
  title: string
  summary?: string
  status?: string
}

const defaultPendingActivationTtlMs = 24 * 60 * 60 * 1000

export class AgentSessionServiceError extends Error {
  constructor(
    readonly code: 'bad_request' | 'not_found' | 'conflict',
    message: string,
    readonly httpStatus: number
  ) {
    super(message)
    this.name = 'AgentSessionServiceError'
  }
}

function createEventId(): string {
  return `sse_${crypto.randomUUID()}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export class AgentSessionService {
  constructor(private readonly repository = new AgentSessionRepository()) {}

  listVisibleSessions(): AgentSessionSummary[] {
    return this.repository.listActivatedSessions()
  }

  getSessionDetail(sessionId: string): AgentSessionDetail | null {
    return this.repository.findSessionDetail(sessionId)
  }

  createPendingSessionForInitialMessage(input: CreateAgentSessionDraftInput): CreateAgentSessionResponse {
    const pendingInput: CreatePendingAgentSessionInput = {
      provider: input.provider,
      cwd: input.cwd,
      initialMessage: input.initialMessage,
      model: input.model ?? null,
      runtimeMode: input.runtimeMode ?? 'full_access'
    }
    const detail = this.repository.createPendingSessionFromInitialMessage(pendingInput)
    const initialTurn = detail.turns[0]
    const initialMessage = detail.messages[0]

    this.publishSessionUpdated(detail.session)
    if (initialTurn) {
      this.publishTurnEvent('turn.started', initialTurn)
    }
    if (initialMessage) {
      this.publishMessageEvent('message.created', initialMessage)
    }

    return {
      sessionId: detail.session.id,
      detail
    }
  }

  startFollowupTurn(input: StartFollowupTurnInput): AgentTurn {
    const session = this.repository.findSession(input.sessionId)
    if (!session) {
      throw new AgentSessionServiceError('not_found', 'Session was not found.', 404)
    }

    if (!session.activatedAt || session.status === 'pending_activation') {
      throw new AgentSessionServiceError(
        'conflict',
        'Cannot start a follow-up turn before the session is activated.',
        409
      )
    }

    const runningTurn = this.repository.findRunningTurn(input.sessionId)
    if (runningTurn) {
      throw new AgentSessionServiceError('conflict', 'Session already has a running turn.', 409)
    }

    const turn = this.repository.createFollowupTurnFromUserMessage(input)
    const detail = this.repository.findSessionDetail(input.sessionId)
    const userMessage = detail?.messages.find((message) => message.turnId === turn.id && message.role === 'user')

    if (detail) {
      this.publishSessionUpdated(detail.session)
    }
    this.publishTurnEvent('turn.started', turn)
    if (userMessage) {
      this.publishMessageEvent('message.created', userMessage)
    }

    return turn
  }

  appendAssistantMessageDelta(input: AppendAssistantMessageDeltaInput): AgentMessage {
    const projection = this.repository.appendAssistantMessageDelta(input)
    this.publishSessionUpdated(projection.detail.session)
    this.publishMessageEvent('message.delta', projection.message, input.delta)
    return projection.message
  }

  updateProviderBinding(input: UpdateProviderBindingInput): AgentSessionDetail {
    const detail = this.repository.updateProviderBinding(input)
    if (!detail) {
      throw new AgentSessionServiceError('not_found', 'Session was not found.', 404)
    }
    this.publishSessionUpdated(detail.session)
    return detail
  }

  updateTurnProviderId(input: UpdateProviderTurnInput): AgentTurn {
    const turn = this.repository.updateTurnProviderId(input)
    if (!turn) {
      throw new AgentSessionServiceError('not_found', 'Turn was not found.', 404)
    }
    return turn
  }

  recordRuntimeActivity(input: RecordRuntimeActivityInput): void {
    const createdAt = nowIso()
    const eventId = this.repository.insertAgentEvent(input, createdAt)
    sessionEventBus.publish({
      id: eventId,
      type: 'activity',
      sessionId: input.sessionId,
      turnId: input.turnId,
      createdAt,
      eventType: input.eventType,
      title: input.title,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.status !== undefined ? { status: input.status } : {})
    })
  }

  completeTurn(sessionId: string, turnId: string): AgentSessionDetail {
    const detail = this.repository.completeTurn(sessionId, turnId)
    if (!detail) {
      throw new AgentSessionServiceError('not_found', 'Session was not found.', 404)
    }

    const turn = detail.turns.find((entry) => entry.id === turnId)
    const assistantMessage = detail.messages.find(
      (message) => message.turnId === turnId && message.role === 'assistant'
    )

    this.publishSessionUpdated(detail.session)
    if (turn) {
      this.publishTurnEvent('turn.completed', turn)
    }
    if (assistantMessage) {
      this.publishMessageEvent('message.completed', assistantMessage)
    }

    return detail
  }

  failTurn(sessionId: string, turnId: string, error: string): AgentSessionDetail {
    const detail = this.repository.failTurn(sessionId, turnId, error)
    if (!detail) {
      throw new AgentSessionServiceError('not_found', 'Session was not found.', 404)
    }

    const turn = detail.turns.find((entry) => entry.id === turnId)
    this.publishSessionUpdated(detail.session)
    if (turn) {
      this.publishTurnEvent('turn.failed', turn)
    }
    sessionEventBus.publish({
      id: createEventId(),
      type: 'runtime.error',
      sessionId,
      turnId,
      createdAt: nowIso(),
      message: error
    })

    return detail
  }

  openPendingRequest(input: CreatePendingRequestInput): AgentPendingRequest {
    const request = this.repository.createPendingRequest(input)
    sessionEventBus.publish({
      id: createEventId(),
      type: 'request.opened',
      sessionId: request.sessionId,
      turnId: request.turnId,
      createdAt: nowIso(),
      request
    })
    return request
  }

  resolvePendingRequest(input: ResolveAgentPendingRequestInput): AgentPendingRequest {
    const request = this.repository.resolvePendingRequest(input)
    if (!request) {
      throw new AgentSessionServiceError('not_found', 'Pending request was not found.', 404)
    }

    sessionEventBus.publish({
      id: createEventId(),
      type: 'request.resolved',
      sessionId: request.sessionId,
      turnId: request.turnId,
      createdAt: nowIso(),
      request
    })

    return request
  }

  interruptRunningTurn(sessionId: string): { interrupted: boolean; turn: AgentTurn | null; session: AgentSession | null } {
    const result = this.repository.interruptRunningTurn(sessionId)
    if (!result.detail) {
      throw new AgentSessionServiceError('not_found', 'Session was not found.', 404)
    }

    if (!result.turn) {
      return {
        interrupted: false,
        turn: null,
        session: result.detail.session
      }
    }

    this.publishSessionUpdated(result.detail.session)
    this.publishTurnEvent('turn.interrupted', result.turn)

    return {
      interrupted: true,
      turn: result.turn,
      session: result.detail.session
    }
  }

  cleanupStalePendingActivationSessions(input: CleanupStalePendingActivationInput = {}): number {
    const olderThanMs = input.olderThanMs ?? defaultPendingActivationTtlMs
    const cutoffIso = new Date(Date.now() - olderThanMs).toISOString()
    return this.repository.cleanupPendingActivationSessionsWithoutAssistantResponse({ cutoffIso })
  }

  discardPendingActivationSession(sessionId: string): boolean {
    return this.repository.deletePendingActivationSession(sessionId)
  }

  private publishSessionUpdated(session: AgentSession): void {
    sessionEventBus.publish({
      id: createEventId(),
      type: 'session.updated',
      sessionId: session.id,
      createdAt: nowIso(),
      session
    })
  }

  private publishTurnEvent(
    type: 'turn.started' | 'turn.completed' | 'turn.failed' | 'turn.interrupted',
    turn: AgentTurn
  ): void {
    sessionEventBus.publish({
      id: createEventId(),
      type,
      sessionId: turn.sessionId,
      turnId: turn.id,
      createdAt: nowIso(),
      turn
    })
  }

  private publishMessageEvent(
    type: 'message.created' | 'message.delta' | 'message.completed',
    message: AgentMessage,
    delta?: string
  ): void {
    sessionEventBus.publish({
      id: createEventId(),
      type,
      sessionId: message.sessionId,
      turnId: message.turnId,
      createdAt: nowIso(),
      message,
      ...(delta !== undefined ? { delta } : {})
    })
  }
}

export const agentSessionService = new AgentSessionService()
