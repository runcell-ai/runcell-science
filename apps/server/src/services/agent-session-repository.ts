import crypto from 'node:crypto'

import type {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
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

    return {
      session: mapSession(sessionRow),
      turns: turnRows.map(mapTurn),
      messages: messageRows.map(mapMessage),
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
