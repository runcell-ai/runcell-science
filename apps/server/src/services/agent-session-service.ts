import crypto from 'node:crypto'

import type {
  AgentArtifact,
  AgentArtifactKind,
  AgentDiffFileChange,
  AgentDiffSource,
  AgentEvent,
  AgentMessage,
  AgentPendingRequest,
  AgentProvider,
  AgentRuntimeMode,
  AgentSession,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTurnDiff,
  AgentTurn,
  CreateAgentSessionResponse
} from '@runcell-science/contracts'

import { sessionEventBus } from '../runtime/session-event-bus'
import {
  AgentSessionRepository,
  type AppendAssistantMessageDeltaInput,
  type CreateAgentArtifactInput,
  type CreatePendingAgentSessionInput,
  type CreatePendingRequestInput,
  type PersistAgentEventInput
} from './agent-session-repository'
import { safeTurnCheckpointService } from './safe-turn-checkpoint-service'

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

export interface RecordTurnDiffInput {
  sessionId: string
  turnId: string
  provider: AgentProvider
  source?: AgentDiffSource
  providerTurnId?: string | null
  providerItemId?: string | null
  files?: AgentDiffFileChange[]
  unifiedDiff?: string | null
  rawSource?: string | null
  rawJson?: unknown
}

export interface CaptureTurnCheckpointBaselineInput {
  session: AgentSession
  turn: AgentTurn
}

export type CreateSessionArtifactInput = CreateAgentArtifactInput & {
  /** Ask clients to focus/open the artifact even when it already exists. */
  focus?: boolean
  /** Optional renderer state written before clients receive artifact.created. */
  initialState?: unknown
}

export interface WriteArtifactStateInput {
  sessionId: string
  artifactId: string
  state: unknown
}

export interface TouchArtifactInput {
  sessionId: string
  artifactId: string
  mediaType?: string | null
}

export interface ArtifactStateResult {
  artifact: AgentArtifact
  state: unknown
  updatedAt: string | null
}

const defaultPendingActivationTtlMs = 24 * 60 * 60 * 1000
/** Hard cap on serialized artifact state; it is meant for small UI state. */
export const maxArtifactStateBytes = 64 * 1024
const imageArtifactExtensions = new Set(['.apng', '.avif', '.bmp', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])
const markdownArtifactExtensions = new Set(['.markdown', '.md', '.mdown', '.mkd'])

function extensionOf(filePath: string): string {
  const normalized = filePath.split(/[?#]/, 1)[0] ?? filePath
  const lastSlash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  const basename = normalized.slice(lastSlash + 1)
  const dot = basename.lastIndexOf('.')
  return dot === -1 ? '' : basename.slice(dot).toLowerCase()
}

function isUnsafeRelativeArtifactPath(filePath: string): boolean {
  return (
    filePath.includes('\0') ||
    filePath.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(filePath) ||
    filePath.split(/[\\/]+/).includes('..')
  )
}

function serializeArtifactState(state: unknown): string {
  if (state === undefined) {
    throw new AgentSessionServiceError('bad_request', 'state is required.', 400)
  }

  const stateJson = JSON.stringify(state)
  if (typeof stateJson !== 'string') {
    throw new AgentSessionServiceError('bad_request', 'state must be JSON-serializable.', 400)
  }
  if (Buffer.byteLength(stateJson, 'utf8') > maxArtifactStateBytes) {
    throw new AgentSessionServiceError(
      'bad_request',
      `state must be at most ${maxArtifactStateBytes} bytes when serialized.`,
      400
    )
  }
  return stateJson
}

export function inferArtifactKindFromPath(filePath: string): Exclude<AgentArtifactKind, 'url'> | null {
  const extension = extensionOf(filePath)
  if (imageArtifactExtensions.has(extension)) {
    return 'image'
  }
  if (extension === '.pdf') {
    return 'pdf'
  }
  if (markdownArtifactExtensions.has(extension)) {
    return 'markdown'
  }
  if (extension === '.html' || extension === '.htm') {
    return 'html'
  }
  return null
}

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

function parseStateJson(stateJson: string): unknown {
  try {
    return JSON.parse(stateJson) as unknown
  } catch {
    return null
  }
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

  getArtifact(artifactId: string): AgentArtifact | null {
    return this.repository.findArtifact(artifactId)
  }

  createArtifact(input: CreateSessionArtifactInput): AgentArtifact {
    const session = this.repository.findSession(input.sessionId)
    if (!session) {
      throw new AgentSessionServiceError('not_found', 'Session was not found.', 404)
    }

    if (input.source === 'file' && isUnsafeRelativeArtifactPath(input.path)) {
      throw new AgentSessionServiceError('bad_request', 'Artifact file paths must be relative to the session cwd.', 400)
    }

    const projection = this.repository.createArtifact(input)
    let artifact = projection.artifact
    if (input.initialState !== undefined) {
      this.repository.upsertArtifactState({
        sessionId: input.sessionId,
        artifactId: projection.artifact.id,
        stateJson: serializeArtifactState(input.initialState)
      })
      artifact = this.requireSessionArtifact(input.sessionId, projection.artifact.id)
    }

    sessionEventBus.publish({
      id: createEventId(),
      type: projection.created ? 'artifact.created' : 'artifact.updated',
      sessionId: artifact.sessionId,
      turnId: artifact.turnId,
      createdAt: artifact.updatedAt,
      artifact,
      ...(input.focus ? { focus: true } : {})
    })
    return artifact
  }

  getArtifactState(sessionId: string, artifactId: string): ArtifactStateResult {
    const artifact = this.requireSessionArtifact(sessionId, artifactId)
    const state = this.repository.findArtifactState(sessionId, artifactId)
    return {
      artifact,
      state: state ? parseStateJson(state.stateJson) : null,
      updatedAt: state?.updatedAt ?? null
    }
  }

  writeArtifactState(input: WriteArtifactStateInput): ArtifactStateResult {
    this.requireSessionArtifact(input.sessionId, input.artifactId)

    const projection = this.repository.upsertArtifactState({
      sessionId: input.sessionId,
      artifactId: input.artifactId,
      stateJson: serializeArtifactState(input.state)
    })

    // upsertArtifactState bumps the artifact's updated_at, so the published
    // artifact carries a fresh timestamp clients can key reloads on.
    const artifact = this.requireSessionArtifact(input.sessionId, input.artifactId)
    sessionEventBus.publish({
      id: createEventId(),
      type: 'artifact.updated',
      sessionId: artifact.sessionId,
      turnId: artifact.turnId,
      createdAt: projection.updatedAt,
      artifact
    })

    return {
      artifact,
      state: parseStateJson(projection.stateJson),
      updatedAt: projection.updatedAt
    }
  }

  touchArtifact(input: TouchArtifactInput): AgentArtifact {
    this.requireSessionArtifact(input.sessionId, input.artifactId)
    const artifact = this.repository.touchArtifact(input)
    if (!artifact) {
      throw new AgentSessionServiceError('not_found', 'Artifact was not found in this session.', 404)
    }

    sessionEventBus.publish({
      id: createEventId(),
      type: 'artifact.updated',
      sessionId: artifact.sessionId,
      turnId: artifact.turnId,
      createdAt: artifact.updatedAt,
      artifact
    })

    return artifact
  }

  private requireSessionArtifact(sessionId: string, artifactId: string): AgentArtifact {
    const artifact = this.repository.findArtifact(artifactId)
    if (!artifact || artifact.sessionId !== sessionId) {
      throw new AgentSessionServiceError('not_found', 'Artifact was not found in this session.', 404)
    }
    return artifact
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

  updateDisabledMcpServers(sessionId: string, disabledServers: string[]): AgentSessionDetail {
    const detail = this.repository.updateDisabledMcpServers(sessionId, disabledServers)
    if (!detail) {
      throw new AgentSessionServiceError('not_found', 'Session was not found.', 404)
    }
    this.publishSessionUpdated(detail.session)
    return detail
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

  captureTurnCheckpointBaseline(input: CaptureTurnCheckpointBaselineInput): void {
    try {
      const result = safeTurnCheckpointService.captureSnapshot({
        sessionId: input.session.id,
        turnId: input.turn.id,
        cwd: input.session.cwd,
        phase: 'baseline'
      })

      this.repository.upsertTurnCheckpointBaseline({
        sessionId: input.session.id,
        turnId: input.turn.id,
        provider: input.session.provider,
        cwd: input.session.cwd,
        status: result.status === 'captured' ? 'baseline' : 'skipped',
        baselineCommit: result.status === 'captured' ? result.commit : null,
        error: result.status === 'skipped' ? result.reason : null
      })
    } catch (error) {
      this.repository.upsertTurnCheckpointBaseline({
        sessionId: input.session.id,
        turnId: input.turn.id,
        provider: input.session.provider,
        cwd: input.session.cwd,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
    }
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

  recordNotebookExecution(input: RecordRuntimeActivityInput): AgentEvent {
    const createdAt = nowIso()
    const eventId = this.repository.insertAgentEvent(input, createdAt)
    const event = this.repository.findSessionDetail(input.sessionId)?.events.find((entry) => entry.id === eventId)
    if (!event) {
      throw new AgentSessionServiceError('not_found', 'Notebook execution event projection was not found.', 404)
    }

    sessionEventBus.publish({
      id: event.id,
      type: 'notebook.execution',
      sessionId: event.sessionId,
      turnId: event.turnId,
      createdAt: event.createdAt,
      event
    })

    return event
  }

  recordTurnDiff(input: RecordTurnDiffInput): AgentTurnDiff {
    const createdAt = nowIso()

    this.repository.insertAgentEvent(
      {
        sessionId: input.sessionId,
        turnId: input.turnId,
        provider: input.provider,
        eventType: 'diff.updated',
        streamKind: 'diff',
        title: 'File changes',
        summary: diffSummary(input.files ?? [], input.unifiedDiff ?? null),
        status: 'updated',
        rawSource: input.rawSource ?? null,
        rawJson: input.rawJson,
        canonicalJson: {
          type: 'diff.updated',
          source: input.source ?? 'provider',
          providerTurnId: input.providerTurnId ?? null,
          providerItemId: input.providerItemId ?? null,
          files: input.files ?? [],
          unifiedDiff: input.unifiedDiff ?? null
        }
      },
      createdAt
    )

    const diff = this.repository
      .findSessionDetail(input.sessionId)
      ?.diffs?.find((entry) => entry.turnId === input.turnId)

    if (!diff) {
      throw new AgentSessionServiceError('not_found', 'Turn diff projection was not found.', 404)
    }

    sessionEventBus.publish({
      id: createEventId(),
      type: 'diff.updated',
      sessionId: diff.sessionId,
      turnId: diff.turnId,
      createdAt,
      diff
    })

    for (const file of input.files ?? []) {
      if (file.kind === 'delete') {
        continue
      }

      const kind = inferArtifactKindFromPath(file.path)
      if (!kind) {
        continue
      }

      this.createArtifact({
        sessionId: input.sessionId,
        turnId: input.turnId,
        kind,
        source: 'file',
        path: file.path,
        title: file.path.split(/[\\/]/).pop() ?? file.path
      })
    }

    return diff
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
    if (turn) {
      this.finalizeTurnCheckpoint(detail.session, turn)
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
      this.finalizeTurnCheckpoint(detail.session, turn)
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
    this.finalizeTurnCheckpoint(result.detail.session, result.turn)

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

  private finalizeTurnCheckpoint(session: AgentSession, turn: AgentTurn): void {
    try {
      const baseline = this.repository.findTurnCheckpoint(session.id, turn.id)
      if (!baseline?.baselineCommit || baseline.status === 'skipped') {
        return
      }

      const completed = safeTurnCheckpointService.captureSnapshot({
        sessionId: session.id,
        turnId: turn.id,
        cwd: session.cwd,
        phase: 'completed'
      })

      if (completed.status === 'skipped') {
        this.repository.completeTurnCheckpoint({
          sessionId: session.id,
          turnId: turn.id,
          status: 'skipped',
          error: completed.reason
        })
        return
      }

      this.repository.completeTurnCheckpoint({
        sessionId: session.id,
        turnId: turn.id,
        status: 'ready',
        completedCommit: completed.commit
      })

      const existingDiff = this.repository.findSessionDetail(session.id)?.diffs?.find((diff) => diff.turnId === turn.id)
      if (hasDiffContent(existingDiff)) {
        return
      }

      const unifiedDiff = safeTurnCheckpointService.diffSnapshots(baseline.baselineCommit, completed.commit)
      if (!unifiedDiff?.trim()) {
        return
      }

      this.recordTurnDiff({
        sessionId: session.id,
        turnId: turn.id,
        provider: session.provider,
        source: 'checkpoint',
        providerTurnId: turn.providerTurnId,
        files: [],
        unifiedDiff,
        rawSource: 'open-science.checkpoint',
        rawJson: {
          baselineCommit: baseline.baselineCommit,
          completedCommit: completed.commit,
          cwd: session.cwd
        }
      })
    } catch (error) {
      this.repository.completeTurnCheckpoint({
        sessionId: session.id,
        turnId: turn.id,
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
    }
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

function hasDiffContent(diff: AgentTurnDiff | undefined): boolean {
  return Boolean(diff && (diff.files.length > 0 || diff.unifiedDiff?.trim()))
}

function diffSummary(files: AgentDiffFileChange[], unifiedDiff: string | null): string {
  if (files.length > 0) {
    return `${files.length} changed file${files.length === 1 ? '' : 's'}`
  }

  if (unifiedDiff?.trim()) {
    return 'Unified diff updated'
  }

  return 'Diff updated'
}

export const agentSessionService = new AgentSessionService()
