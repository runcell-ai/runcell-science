// Persistence for agent sessions: SQLite schema knowledge, row mapping, and
// cross-table transactions. Sections:
//   1. Row interfaces            — raw shapes of the agent_* tables
//   2. Input/output types        — public API of the repository
//   3. Row mappers               — trivial row -> contract projections
//   4. AgentSessionRepository    — SQL CRUD + transactional flows
// Event/diff projection semantics (canonical provider event format) live in
// agent-session-projections.ts.

import crypto from 'node:crypto'

import type {
  AgentArtifact,
  AgentArtifactKind,
  AgentArtifactSource,
  AgentEvent,
  AgentMessage,
  AgentMessageRole,
  AgentMessageStatus,
  AgentPendingRequest,
  AgentPendingRequestStatus,
  AgentProvider,
  AgentRuntimeMode,
  AgentSession,
  AgentSessionDetail,
  AgentSessionStatus,
  AgentSessionSummary,
  AgentTurn,
  AgentTurnStatus
} from '@open-science/contracts'

import { getDb } from '../db/connection'
import { mapEvent, mapTurnDiffs, type AgentEventRow } from './agent-session-projections'

interface AgentSessionRow {
  id: string
  provider: AgentProvider
  title: string | null
  cwd: string
  model: string | null
  runtime_mode: AgentRuntimeMode
  permission_mode: string | null
  status: AgentSessionStatus
  activated_at: string | null
  provider_session_id: string | null
  provider_thread_id: string | null
  resume_cursor_json: string | null
  last_error: string | null
  disabled_mcp_servers_json: string | null
  created_at: string
  updated_at: string
}

interface AgentTurnRow {
  id: string
  session_id: string
  provider_turn_id: string | null
  status: AgentTurnStatus
  requested_at: string
  completed_at: string | null
  error: string | null
}

interface AgentMessageRow {
  id: string
  session_id: string
  turn_id: string | null
  role: AgentMessageRole
  text: string
  status: AgentMessageStatus
  provider_item_id: string | null
  created_at: string
  updated_at: string
}

interface AgentPendingRequestRow {
  id: string
  session_id: string
  turn_id: string
  type: string
  status: AgentPendingRequestStatus
  title: string | null
  payload_json: string
  response_json: string | null
  created_at: string
  resolved_at: string | null
}

interface AgentArtifactRow {
  id: string
  session_id: string
  turn_id: string | null
  message_id: string | null
  kind: AgentArtifactKind
  source: AgentArtifactSource
  path: string | null
  url: string | null
  title: string | null
  renderer_key: string | null
  media_type: string | null
  metadata_json: string | null
  editable: number
  created_at: string
  updated_at: string
}

interface AgentArtifactStateRow {
  artifact_id: string
  session_id: string
  state_json: string
  created_at: string
  updated_at: string
}

interface AgentTurnCheckpointRow {
  id: string
  session_id: string
  turn_id: string
  provider: AgentProvider
  cwd: string
  status: 'baseline' | 'ready' | 'skipped' | 'error'
  baseline_commit: string | null
  completed_commit: string | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface CreatePendingAgentSessionInput {
  provider: AgentProvider
  cwd: string
  initialMessage: string
  model?: string | null
  runtimeMode?: AgentRuntimeMode
  permissionMode?: string | null
}

export interface PendingActivationCleanupInput {
  cutoffIso: string
}

export interface CreateFollowupTurnInput {
  sessionId: string
  message: string
}

export interface PersistAgentEventInput {
  sessionId: string
  turnId: string | null
  provider: AgentProvider
  eventType: string
  streamKind?: string | null
  title?: string | null
  summary?: string | null
  status?: string | null
  rawSource?: string | null
  rawJson?: unknown
  canonicalJson?: unknown
}

export interface AppendAssistantMessageDeltaInput {
  sessionId: string
  turnId: string
  provider: AgentProvider
  delta: string
  providerItemId?: string | null
  rawSource?: string | null
  rawJson?: unknown
  canonicalJson?: unknown
}

export interface CreatePendingRequestInput {
  sessionId: string
  turnId: string
  type: string
  title?: string | null
  payloadJson: unknown
}

export interface ResolvePendingRequestInput {
  sessionId: string
  requestId: string
  responseJson: unknown
}

export interface AgentArtifactPresentationInput {
  rendererKey?: string | null
  mediaType?: string | null
  /** Serialized JSON object; parsed back into AgentArtifact.metadata. */
  metadataJson?: string | null
  editable?: boolean | null
}

export type CreateAgentArtifactInput =
  | (AgentArtifactPresentationInput & {
      sessionId: string
      turnId?: string | null
      messageId?: string | null
      kind: Exclude<AgentArtifactKind, 'url'>
      source: 'file'
      path: string
      title?: string | null
    })
  | (AgentArtifactPresentationInput & {
      sessionId: string
      turnId?: string | null
      messageId?: string | null
      kind: 'url'
      source: 'url'
      url: string
      title?: string | null
    })

export interface UpsertArtifactStateInput {
  sessionId: string
  artifactId: string
  stateJson: string
}

export interface TouchArtifactInput {
  sessionId: string
  artifactId: string
  mediaType?: string | null
}

export interface ArtifactStateProjection {
  artifactId: string
  sessionId: string
  stateJson: string
  updatedAt: string
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

export interface InterruptRunningTurnResult {
  turn: AgentTurn | null
  detail: AgentSessionDetail | null
}

export interface UpsertTurnCheckpointBaselineInput {
  sessionId: string
  turnId: string
  provider: AgentProvider
  cwd: string
  baselineCommit?: string | null
  status?: 'baseline' | 'skipped' | 'error'
  error?: string | null
}

export interface CompleteTurnCheckpointInput {
  sessionId: string
  turnId: string
  status: 'ready' | 'skipped' | 'error'
  completedCommit?: string | null
  error?: string | null
}

export interface TurnCheckpointProjection {
  id: string
  sessionId: string
  turnId: string
  provider: AgentProvider
  cwd: string
  status: 'baseline' | 'ready' | 'skipped' | 'error'
  baselineCommit: string | null
  completedCommit: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface AssistantDeltaProjection {
  message: AgentMessage
  detail: AgentSessionDetail
}

export interface AgentArtifactUpsertProjection {
  artifact: AgentArtifact
  created: boolean
}

function nowIso(): string {
  return new Date().toISOString()
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function createTitleFromInitialMessage(initialMessage: string): string {
  const normalized = initialMessage.trim().replace(/\s+/g, ' ')
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function mapSession(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    provider: row.provider,
    title: row.title,
    cwd: row.cwd,
    model: row.model,
    runtimeMode: row.runtime_mode,
    permissionMode: row.permission_mode,
    status: row.status,
    activatedAt: row.activated_at,
    providerSessionId: row.provider_session_id,
    providerThreadId: row.provider_thread_id,
    resumeCursorJson: row.resume_cursor_json,
    lastError: row.last_error,
    disabledMcpServers: parseDisabledMcpServers(row.disabled_mcp_servers_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function parseDisabledMcpServers(value: string | null): string[] {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function mapSessionSummary(row: AgentSessionRow): AgentSessionSummary {
  if (!row.activated_at || row.status === 'pending_activation') {
    throw new Error(`Session ${row.id} is not activated and cannot be summarized.`)
  }

  return {
    id: row.id,
    provider: row.provider,
    title: row.title,
    cwd: row.cwd,
    model: row.model,
    runtimeMode: row.runtime_mode,
    status: row.status,
    activatedAt: row.activated_at,
    updatedAt: row.updated_at
  }
}

function mapTurn(row: AgentTurnRow): AgentTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    providerTurnId: row.provider_turn_id,
    status: row.status,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    error: row.error
  }
}

function mapMessage(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    role: row.role,
    text: row.text,
    status: row.status,
    providerItemId: row.provider_item_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapPendingRequest(row: AgentPendingRequestRow): AgentPendingRequest {
  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    type: row.type,
    status: row.status,
    title: row.title,
    payloadJson: row.payload_json,
    responseJson: row.response_json,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  }
}

function parseMetadataJson(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function mapArtifact(row: AgentArtifactRow): AgentArtifact {
  const base = {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    messageId: row.message_id,
    title: row.title,
    rendererKey: row.renderer_key,
    mediaType: row.media_type,
    metadata: parseMetadataJson(row.metadata_json),
    editable: row.editable === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }

  if (row.source === 'url') {
    return {
      ...base,
      kind: 'url',
      source: 'url',
      path: null,
      url: row.url ?? ''
    }
  }

  return {
    ...base,
    kind: row.kind as Exclude<AgentArtifactKind, 'url'>,
    source: 'file',
    path: row.path ?? '',
    url: null
  }
}

function mapArtifactState(row: AgentArtifactStateRow): ArtifactStateProjection {
  return {
    artifactId: row.artifact_id,
    sessionId: row.session_id,
    stateJson: row.state_json,
    updatedAt: row.updated_at
  }
}

function mapTurnCheckpoint(row: AgentTurnCheckpointRow): TurnCheckpointProjection {
  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    provider: row.provider,
    cwd: row.cwd,
    status: row.status,
    baselineCommit: row.baseline_commit,
    completedCommit: row.completed_commit,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function stringifyJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

export class AgentSessionRepository {
  createPendingSessionFromInitialMessage(input: CreatePendingAgentSessionInput): AgentSessionDetail {
    const db = getDb()
    const timestamp = nowIso()
    const sessionId = createId('session')
    const turnId = createId('turn')
    const messageId = createId('message')
    const runtimeMode = input.runtimeMode ?? 'full_access'
    const model = input.model ?? null
    const permissionMode = input.permissionMode ?? null
    const title = createTitleFromInitialMessage(input.initialMessage)

    const createTransaction = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO agent_sessions (
            id,
            provider,
            title,
            cwd,
            model,
            runtime_mode,
            permission_mode,
            status,
            activated_at,
            provider_session_id,
            provider_thread_id,
            resume_cursor_json,
            last_error,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_activation', NULL, NULL, NULL, NULL, NULL, ?, ?)
        `
      ).run(
        sessionId,
        input.provider,
        title,
        input.cwd,
        model,
        runtimeMode,
        permissionMode,
        timestamp,
        timestamp
      )

      db.prepare(
        `
          INSERT INTO agent_turns (
            id,
            session_id,
            provider_turn_id,
            status,
            requested_at,
            completed_at,
            error
          )
          VALUES (?, ?, NULL, 'running', ?, NULL, NULL)
        `
      ).run(turnId, sessionId, timestamp)

      db.prepare(
        `
          INSERT INTO agent_messages (
            id,
            session_id,
            turn_id,
            role,
            text,
            status,
            provider_item_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, 'user', ?, 'completed', NULL, ?, ?)
        `
      ).run(messageId, sessionId, turnId, input.initialMessage, timestamp, timestamp)
    })

    createTransaction()

    const detail = this.findSessionDetail(sessionId)
    if (!detail) {
      throw new Error(`Failed to load newly created pending session ${sessionId}.`)
    }

    return detail
  }

  listActivatedSessions(limit = 50): AgentSessionSummary[] {
    const rows = getDb()
      .prepare(
        `
          SELECT *
          FROM agent_sessions
          WHERE activated_at IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT ?
        `
      )
      .all(limit) as AgentSessionRow[]

    return rows.map(mapSessionSummary)
  }

  findSession(sessionId: string): AgentSession | null {
    const row = getDb()
      .prepare(
        `
          SELECT *
          FROM agent_sessions
          WHERE id = ?
        `
      )
      .get(sessionId) as AgentSessionRow | undefined

    return row ? mapSession(row) : null
  }

  findRunningTurn(sessionId: string): AgentTurn | null {
    const row = getDb()
      .prepare(
        `
          SELECT *
          FROM agent_turns
          WHERE session_id = ?
            AND status = 'running'
          ORDER BY requested_at DESC
          LIMIT 1
        `
      )
      .get(sessionId) as AgentTurnRow | undefined

    return row ? mapTurn(row) : null
  }

  findSessionDetail(sessionId: string): AgentSessionDetail | null {
    const db = getDb()
    const sessionRow = db
      .prepare(
        `
          SELECT *
          FROM agent_sessions
          WHERE id = ?
        `
      )
      .get(sessionId) as AgentSessionRow | undefined

    if (!sessionRow) {
      return null
    }

    const turnRows = db
      .prepare(
        `
          SELECT *
          FROM agent_turns
          WHERE session_id = ?
          ORDER BY requested_at ASC
        `
      )
      .all(sessionId) as AgentTurnRow[]

    const messageRows = db
      .prepare(
        `
          SELECT *
          FROM agent_messages
          WHERE session_id = ?
          ORDER BY created_at ASC
        `
      )
      .all(sessionId) as AgentMessageRow[]

    const pendingRequestRows = db
      .prepare(
        `
          SELECT *
          FROM agent_pending_requests
          WHERE session_id = ?
          ORDER BY created_at ASC
        `
      )
      .all(sessionId) as AgentPendingRequestRow[]

    const artifactRows = db
      .prepare(
        `
          SELECT *
          FROM agent_artifacts
          WHERE session_id = ?
          ORDER BY created_at ASC
        `
      )
      .all(sessionId) as AgentArtifactRow[]

    const eventRows = db
      .prepare(
        `
          SELECT
            id,
            session_id,
            turn_id,
            provider,
            event_type,
            stream_kind,
            title,
            summary,
            status,
            raw_json,
            canonical_json,
            created_at
          FROM agent_events
          WHERE session_id = ?
            AND event_type NOT IN ('content.delta', 'stderr', 'diff.updated')
          ORDER BY created_at ASC
        `
      )
      .all(sessionId) as AgentEventRow[]

    const diffRows = db
      .prepare(
        `
          SELECT
            id,
            session_id,
            turn_id,
            provider,
            event_type,
            stream_kind,
            title,
            summary,
            status,
            raw_json,
            canonical_json,
            created_at
          FROM agent_events
          WHERE session_id = ?
            AND event_type = 'diff.updated'
          ORDER BY created_at ASC
        `
      )
      .all(sessionId) as AgentEventRow[]

    return {
      session: mapSession(sessionRow),
      turns: turnRows.map(mapTurn),
      messages: messageRows.map(mapMessage),
      events: eventRows.map(mapEvent).filter((event): event is AgentEvent => Boolean(event)),
      diffs: mapTurnDiffs(diffRows),
      artifacts: artifactRows.map(mapArtifact),
      pendingRequests: pendingRequestRows.map(mapPendingRequest)
    }
  }

  activateSession(sessionId: string): AgentSessionDetail | null {
    const timestamp = nowIso()

    getDb()
      .prepare(
        `
          UPDATE agent_sessions
          SET
            activated_at = COALESCE(activated_at, ?),
            status = CASE WHEN status = 'pending_activation' THEN 'running' ELSE status END,
            updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, timestamp, sessionId)

    return this.findSessionDetail(sessionId)
  }

  updateDisabledMcpServers(sessionId: string, disabledServers: string[]): AgentSessionDetail | null {
    getDb()
      .prepare(
        `
          UPDATE agent_sessions
          SET disabled_mcp_servers_json = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(JSON.stringify(disabledServers), nowIso(), sessionId)

    return this.findSessionDetail(sessionId)
  }

  updateProviderBinding(input: UpdateProviderBindingInput): AgentSessionDetail | null {
    const timestamp = nowIso()

    getDb()
      .prepare(
        `
          UPDATE agent_sessions
          SET provider_session_id = COALESCE(?, provider_session_id),
              provider_thread_id = COALESCE(?, provider_thread_id),
              resume_cursor_json = COALESCE(?, resume_cursor_json),
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        input.providerSessionId ?? null,
        input.providerThreadId ?? null,
        input.resumeCursorJson ?? null,
        timestamp,
        input.sessionId
      )

    return this.findSessionDetail(input.sessionId)
  }

  createArtifact(input: CreateAgentArtifactInput): AgentArtifactUpsertProjection {
    const timestamp = nowIso()
    const existing =
      input.source === 'file'
        ? this.findArtifactByFilePath(input.sessionId, input.path)
        : this.findArtifactByUrl(input.sessionId, input.url)

    if (existing) {
      getDb()
        .prepare(
          `
            UPDATE agent_artifacts
            SET
              turn_id = COALESCE(?, turn_id),
              message_id = COALESCE(?, message_id),
              title = COALESCE(?, title),
              renderer_key = COALESCE(?, renderer_key),
              media_type = COALESCE(?, media_type),
              metadata_json = COALESCE(?, metadata_json),
              editable = COALESCE(?, editable),
              updated_at = ?
            WHERE id = ?
          `
        )
        .run(
          input.turnId ?? null,
          input.messageId ?? null,
          input.title ?? null,
          input.rendererKey ?? null,
          input.mediaType ?? null,
          input.metadataJson ?? null,
          input.editable === undefined || input.editable === null ? null : input.editable ? 1 : 0,
          timestamp,
          existing.id
        )

      const artifact = this.findArtifact(existing.id)
      if (!artifact) {
        throw new Error(`Failed to load updated artifact ${existing.id}.`)
      }

      return {
        artifact,
        created: false
      }
    }

    const artifactId = createId('artifact')

    getDb()
      .prepare(
        `
          INSERT INTO agent_artifacts (
            id,
            session_id,
            turn_id,
            message_id,
            kind,
            source,
            path,
            url,
            title,
            renderer_key,
            media_type,
            metadata_json,
            editable,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        artifactId,
        input.sessionId,
        input.turnId ?? null,
        input.messageId ?? null,
        input.kind,
        input.source,
        input.source === 'file' ? input.path : null,
        input.source === 'url' ? input.url : null,
        input.title ?? null,
        input.rendererKey ?? null,
        input.mediaType ?? null,
        input.metadataJson ?? null,
        input.editable ? 1 : 0,
        timestamp,
        timestamp
      )

    const artifact = this.findArtifact(artifactId)
    if (!artifact) {
      throw new Error(`Failed to load newly created artifact ${artifactId}.`)
    }

    return {
      artifact,
      created: true
    }
  }

  findArtifact(artifactId: string): AgentArtifact | null {
    const row = getDb()
      .prepare(
        `
          SELECT *
          FROM agent_artifacts
          WHERE id = ?
        `
      )
      .get(artifactId) as AgentArtifactRow | undefined

    return row ? mapArtifact(row) : null
  }

  private findArtifactByFilePath(sessionId: string, filePath: string): AgentArtifact | null {
    const row = getDb()
      .prepare(
        `
          SELECT *
          FROM agent_artifacts
          WHERE session_id = ?
            AND source = 'file'
            AND path = ?
          LIMIT 1
        `
      )
      .get(sessionId, filePath) as AgentArtifactRow | undefined

    return row ? mapArtifact(row) : null
  }

  private findArtifactByUrl(sessionId: string, url: string): AgentArtifact | null {
    const row = getDb()
      .prepare(
        `
          SELECT *
          FROM agent_artifacts
          WHERE session_id = ?
            AND source = 'url'
            AND url = ?
          LIMIT 1
        `
      )
      .get(sessionId, url) as AgentArtifactRow | undefined

    return row ? mapArtifact(row) : null
  }

  findArtifactState(sessionId: string, artifactId: string): ArtifactStateProjection | null {
    const row = getDb()
      .prepare(
        `
          SELECT *
          FROM agent_artifact_state
          WHERE session_id = ?
            AND artifact_id = ?
        `
      )
      .get(sessionId, artifactId) as AgentArtifactStateRow | undefined

    return row ? mapArtifactState(row) : null
  }

  touchArtifact(input: TouchArtifactInput): AgentArtifact | null {
    const timestamp = nowIso()
    getDb()
      .prepare(
        `
          UPDATE agent_artifacts
          SET
            media_type = COALESCE(?, media_type),
            updated_at = ?
          WHERE id = ?
            AND session_id = ?
        `
      )
      .run(input.mediaType ?? null, timestamp, input.artifactId, input.sessionId)

    return this.findArtifact(input.artifactId)
  }

  /** Writes artifact state and bumps the artifact's updated_at in the same
   * transaction so existing artifact SSE plumbing signals the change. */
  upsertArtifactState(input: UpsertArtifactStateInput): ArtifactStateProjection {
    const db = getDb()
    const timestamp = nowIso()

    const upsertTransaction = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO agent_artifact_state (
            artifact_id,
            session_id,
            state_json,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(artifact_id) DO UPDATE SET
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        `
      ).run(input.artifactId, input.sessionId, input.stateJson, timestamp, timestamp)

      db.prepare(
        `
          UPDATE agent_artifacts
          SET updated_at = ?
          WHERE id = ?
            AND session_id = ?
        `
      ).run(timestamp, input.artifactId, input.sessionId)
    })

    upsertTransaction()

    const state = this.findArtifactState(input.sessionId, input.artifactId)
    if (!state) {
      throw new Error(`Failed to load state for artifact ${input.artifactId}.`)
    }

    return state
  }

  updateTurnProviderId(input: UpdateProviderTurnInput): AgentTurn | null {
    getDb()
      .prepare(
        `
          UPDATE agent_turns
          SET provider_turn_id = ?
          WHERE id = ?
            AND session_id = ?
        `
      )
      .run(input.providerTurnId, input.turnId, input.sessionId)

    const row = getDb()
      .prepare(
        `
          SELECT *
          FROM agent_turns
          WHERE id = ?
            AND session_id = ?
        `
      )
      .get(input.turnId, input.sessionId) as AgentTurnRow | undefined

    return row ? mapTurn(row) : null
  }

  upsertTurnCheckpointBaseline(input: UpsertTurnCheckpointBaselineInput): TurnCheckpointProjection {
    const timestamp = nowIso()
    const checkpointId = createId('checkpoint')

    getDb()
      .prepare(
        `
          INSERT INTO agent_turn_checkpoints (
            id,
            session_id,
            turn_id,
            provider,
            cwd,
            status,
            baseline_commit,
            completed_commit,
            error,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
          ON CONFLICT(session_id, turn_id) DO UPDATE SET
            provider = excluded.provider,
            cwd = excluded.cwd,
            status = excluded.status,
            baseline_commit = excluded.baseline_commit,
            completed_commit = NULL,
            error = excluded.error,
            updated_at = excluded.updated_at
        `
      )
      .run(
        checkpointId,
        input.sessionId,
        input.turnId,
        input.provider,
        input.cwd,
        input.status ?? 'baseline',
        input.baselineCommit ?? null,
        input.error ?? null,
        timestamp,
        timestamp
      )

    const checkpoint = this.findTurnCheckpoint(input.sessionId, input.turnId)
    if (!checkpoint) {
      throw new Error(`Failed to project checkpoint baseline for turn ${input.turnId}.`)
    }
    return checkpoint
  }

  completeTurnCheckpoint(input: CompleteTurnCheckpointInput): TurnCheckpointProjection | null {
    const timestamp = nowIso()

    getDb()
      .prepare(
        `
          UPDATE agent_turn_checkpoints
          SET status = ?,
              completed_commit = ?,
              error = ?,
              updated_at = ?
          WHERE session_id = ?
            AND turn_id = ?
        `
      )
      .run(
        input.status,
        input.completedCommit ?? null,
        input.error ?? null,
        timestamp,
        input.sessionId,
        input.turnId
      )

    return this.findTurnCheckpoint(input.sessionId, input.turnId)
  }

  findTurnCheckpoint(sessionId: string, turnId: string): TurnCheckpointProjection | null {
    const row = getDb()
      .prepare(
        `
          SELECT *
          FROM agent_turn_checkpoints
          WHERE session_id = ?
            AND turn_id = ?
        `
      )
      .get(sessionId, turnId) as AgentTurnCheckpointRow | undefined

    return row ? mapTurnCheckpoint(row) : null
  }

  createFollowupTurnFromUserMessage(input: CreateFollowupTurnInput): AgentTurn {
    const db = getDb()
    const timestamp = nowIso()
    const turnId = createId('turn')
    const messageId = createId('message')

    const createTransaction = db.transaction(() => {
      db.prepare(
        `
          INSERT INTO agent_turns (
            id,
            session_id,
            provider_turn_id,
            status,
            requested_at,
            completed_at,
            error
          )
          VALUES (?, ?, NULL, 'running', ?, NULL, NULL)
        `
      ).run(turnId, input.sessionId, timestamp)

      db.prepare(
        `
          INSERT INTO agent_messages (
            id,
            session_id,
            turn_id,
            role,
            text,
            status,
            provider_item_id,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, 'user', ?, 'completed', NULL, ?, ?)
        `
      ).run(messageId, input.sessionId, turnId, input.message, timestamp, timestamp)

      db.prepare(
        `
          UPDATE agent_sessions
          SET status = 'running',
              updated_at = ?
          WHERE id = ?
        `
      ).run(timestamp, input.sessionId)
    })

    createTransaction()

    const turn = this.findRunningTurn(input.sessionId)
    if (!turn || turn.id !== turnId) {
      throw new Error(`Failed to load newly created turn ${turnId}.`)
    }

    return turn
  }

  appendAssistantMessageDelta(input: AppendAssistantMessageDeltaInput): AssistantDeltaProjection {
    const db = getDb()
    const timestamp = nowIso()

    const appendTransaction = db.transaction(() => {
      this.insertAgentEvent(
        {
          sessionId: input.sessionId,
          turnId: input.turnId,
          provider: input.provider,
          eventType: 'content.delta',
          streamKind: 'assistant_text',
          rawSource: input.rawSource ?? null,
          rawJson: input.rawJson,
          canonicalJson:
            input.canonicalJson ??
            ({
              type: 'content.delta',
              streamKind: 'assistant_text',
              delta: input.delta,
              providerItemId: input.providerItemId ?? null
            } satisfies Record<string, unknown>)
        },
        timestamp
      )

      const existingMessage = this.findAssistantMessageForDelta(input)
      if (existingMessage) {
        db.prepare(
          `
            UPDATE agent_messages
            SET text = text || ?,
                status = 'streaming',
                updated_at = ?
            WHERE id = ?
          `
        ).run(input.delta, timestamp, existingMessage.id)
      } else {
        db.prepare(
          `
            INSERT INTO agent_messages (
              id,
              session_id,
              turn_id,
              role,
              text,
              status,
              provider_item_id,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, 'assistant', ?, 'streaming', ?, ?, ?)
          `
        ).run(
          createId('message'),
          input.sessionId,
          input.turnId,
          input.delta,
          input.providerItemId ?? null,
          timestamp,
          timestamp
        )
      }

      if (input.delta.trim().length > 0) {
        db.prepare(
          `
            UPDATE agent_sessions
            SET activated_at = COALESCE(activated_at, ?),
                status = CASE
                  WHEN status = 'pending_activation' THEN 'running'
                  ELSE status
                END,
                updated_at = ?
            WHERE id = ?
          `
        ).run(timestamp, timestamp, input.sessionId)
      }
    })

    appendTransaction()

    const detail = this.findSessionDetail(input.sessionId)
    const message = this.findAssistantMessageForDelta(input)
    if (!detail || !message) {
      throw new Error(`Failed to project assistant delta for session ${input.sessionId}.`)
    }

    return {
      message,
      detail
    }
  }

  completeTurn(sessionId: string, turnId: string): AgentSessionDetail | null {
    const timestamp = nowIso()

    getDb()
      .prepare(
        `
          UPDATE agent_turns
          SET status = 'completed',
              completed_at = COALESCE(completed_at, ?)
          WHERE id = ?
            AND session_id = ?
        `
      )
      .run(timestamp, turnId, sessionId)

    getDb()
      .prepare(
        `
          UPDATE agent_messages
          SET status = 'completed',
              updated_at = ?
          WHERE session_id = ?
            AND turn_id = ?
            AND role = 'assistant'
            AND status = 'streaming'
        `
      )
      .run(timestamp, sessionId, turnId)

    getDb()
      .prepare(
        `
          UPDATE agent_sessions
          SET status = 'ready',
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, sessionId)

    return this.findSessionDetail(sessionId)
  }

  failTurn(sessionId: string, turnId: string, error: string): AgentSessionDetail | null {
    const timestamp = nowIso()

    getDb()
      .prepare(
        `
          UPDATE agent_turns
          SET status = 'failed',
              completed_at = COALESCE(completed_at, ?),
              error = ?
          WHERE id = ?
            AND session_id = ?
        `
      )
      .run(timestamp, error, turnId, sessionId)

    getDb()
      .prepare(
        `
          UPDATE agent_sessions
          SET status = 'error',
              last_error = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(error, timestamp, sessionId)

    return this.findSessionDetail(sessionId)
  }

  createPendingRequest(input: CreatePendingRequestInput): AgentPendingRequest {
    const timestamp = nowIso()
    const requestId = createId('request')

    getDb()
      .prepare(
        `
          INSERT INTO agent_pending_requests (
            id,
            session_id,
            turn_id,
            type,
            status,
            title,
            payload_json,
            response_json,
            created_at,
            resolved_at
          )
          VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, ?, NULL)
        `
      )
      .run(
        requestId,
        input.sessionId,
        input.turnId,
        input.type,
        input.title ?? null,
        JSON.stringify(input.payloadJson),
        timestamp
      )

    const request = this.findPendingRequest(input.sessionId, requestId)
    if (!request) {
      throw new Error(`Failed to load newly created pending request ${requestId}.`)
    }

    return request
  }

  resolvePendingRequest(input: ResolvePendingRequestInput): AgentPendingRequest | null {
    const timestamp = nowIso()

    getDb()
      .prepare(
        `
          UPDATE agent_pending_requests
          SET status = 'resolved',
              response_json = ?,
              resolved_at = ?
          WHERE id = ?
            AND session_id = ?
            AND status = 'open'
        `
      )
      .run(JSON.stringify(input.responseJson), timestamp, input.requestId, input.sessionId)

    return this.findPendingRequest(input.sessionId, input.requestId)
  }

  findPendingRequest(sessionId: string, requestId: string): AgentPendingRequest | null {
    const row = getDb()
      .prepare(
        `
          SELECT *
          FROM agent_pending_requests
          WHERE session_id = ?
            AND id = ?
        `
      )
      .get(sessionId, requestId) as AgentPendingRequestRow | undefined

    return row ? mapPendingRequest(row) : null
  }

  interruptRunningTurn(sessionId: string): InterruptRunningTurnResult {
    const db = getDb()
    const timestamp = nowIso()
    let interruptedTurnId: string | null = null

    const interruptTransaction = db.transaction(() => {
      const runningTurn = db
        .prepare(
          `
            SELECT *
            FROM agent_turns
            WHERE session_id = ?
              AND status = 'running'
            ORDER BY requested_at DESC
            LIMIT 1
          `
        )
        .get(sessionId) as AgentTurnRow | undefined

      if (!runningTurn) {
        return
      }

      interruptedTurnId = runningTurn.id

      db.prepare(
        `
          UPDATE agent_turns
          SET status = 'interrupted',
              completed_at = COALESCE(completed_at, ?)
          WHERE id = ?
        `
      ).run(timestamp, runningTurn.id)

      db.prepare(
        `
          UPDATE agent_sessions
          SET status = CASE
                WHEN activated_at IS NULL THEN status
                ELSE 'ready'
              END,
              updated_at = ?
          WHERE id = ?
        `
      ).run(timestamp, sessionId)
    })

    interruptTransaction()

    const detail = this.findSessionDetail(sessionId)
    const turn = interruptedTurnId
      ? detail?.turns.find((entry) => entry.id === interruptedTurnId) ?? null
      : null

    return {
      turn,
      detail
    }
  }

  insertAgentEvent(input: PersistAgentEventInput, createdAt = nowIso()): string {
    const eventId = createId('event')

    getDb()
      .prepare(
        `
          INSERT INTO agent_events (
            id,
            session_id,
            turn_id,
            provider,
            event_type,
            stream_kind,
            title,
            summary,
            status,
            raw_source,
            raw_json,
            canonical_json,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        eventId,
        input.sessionId,
        input.turnId,
        input.provider,
        input.eventType,
        input.streamKind ?? null,
        input.title ?? null,
        input.summary ?? null,
        input.status ?? null,
        input.rawSource ?? null,
        stringifyJson(input.rawJson),
        stringifyJson(input.canonicalJson),
        createdAt
      )

    return eventId
  }

  private findAssistantMessageForDelta(input: {
    sessionId: string
    turnId: string
    providerItemId?: string | null
  }): AgentMessage | null {
    const db = getDb()
    const row = input.providerItemId
      ? (db
          .prepare(
            `
              SELECT *
              FROM agent_messages
              WHERE session_id = ?
                AND turn_id = ?
                AND role = 'assistant'
                AND provider_item_id = ?
              ORDER BY created_at ASC
              LIMIT 1
            `
          )
          .get(input.sessionId, input.turnId, input.providerItemId) as AgentMessageRow | undefined)
      : (db
          .prepare(
            `
              SELECT *
              FROM agent_messages
              WHERE session_id = ?
                AND turn_id = ?
                AND role = 'assistant'
                AND provider_item_id IS NULL
              ORDER BY created_at ASC
              LIMIT 1
            `
          )
          .get(input.sessionId, input.turnId) as AgentMessageRow | undefined)

    return row ? mapMessage(row) : null
  }

  deletePendingActivationSession(sessionId: string): boolean {
    const result = getDb()
      .prepare(
        `
          DELETE FROM agent_sessions
          WHERE id = ?
            AND activated_at IS NULL
            AND status = 'pending_activation'
        `
      )
      .run(sessionId)

    return result.changes > 0
  }

  cleanupPendingActivationSessionsWithoutAssistantResponse(input: PendingActivationCleanupInput): number {
    const result = getDb()
      .prepare(
        `
          DELETE FROM agent_sessions
          WHERE activated_at IS NULL
            AND status = 'pending_activation'
            AND created_at <= ?
            AND NOT EXISTS (
              SELECT 1
              FROM agent_messages
              WHERE agent_messages.session_id = agent_sessions.id
                AND agent_messages.role = 'assistant'
                AND length(trim(agent_messages.text)) > 0
            )
        `
      )
      .run(input.cutoffIso)

    return result.changes
  }
}
