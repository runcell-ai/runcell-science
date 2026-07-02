import crypto from 'node:crypto'

import type {
  AgentArtifact,
  AgentArtifactKind,
  AgentArtifactSource,
  AgentDiffChangeKind,
  AgentDiffFileChange,
  AgentDiffSource,
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
  AgentTurnDiff,
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
  created_at: string
  updated_at: string
}

interface AgentEventRow {
  id: string
  session_id: string
  turn_id: string | null
  provider: AgentProvider
  event_type: string
  stream_kind: string | null
  title: string | null
  summary: string | null
  status: string | null
  raw_json: string | null
  canonical_json: string | null
  created_at: string
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

export type CreateAgentArtifactInput =
  | {
      sessionId: string
      turnId?: string | null
      messageId?: string | null
      kind: Exclude<AgentArtifactKind, 'url'>
      source: 'file'
      path: string
      title?: string | null
    }
  | {
      sessionId: string
      turnId?: string | null
      messageId?: string | null
      kind: 'url'
      source: 'url'
      url: string
      title?: string | null
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

function mapArtifact(row: AgentArtifactRow): AgentArtifact {
  const base = {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    messageId: row.message_id,
    title: row.title,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function recordField(value: Record<string, unknown> | null, field: string): Record<string, unknown> | null {
  const fieldValue = value?.[field]
  return isRecord(fieldValue) ? fieldValue : null
}

function stringField(value: Record<string, unknown> | null, field: string): string | null {
  const fieldValue = value?.[field]
  return typeof fieldValue === 'string' ? fieldValue : null
}

function nullableStringField(value: Record<string, unknown> | null, field: string): string | null {
  const fieldValue = value?.[field]
  return typeof fieldValue === 'string' ? fieldValue : null
}

function arrayLengthField(value: Record<string, unknown> | null, field: string): number | null {
  const fieldValue = value?.[field]
  return Array.isArray(fieldValue) ? fieldValue.length : null
}

function arrayField(value: Record<string, unknown> | null, field: string): unknown[] {
  const fieldValue = value?.[field]
  return Array.isArray(fieldValue) ? fieldValue : []
}

function rawThreadItem(row: AgentEventRow): Record<string, unknown> | null {
  return recordField(recordField(parseJsonRecord(row.raw_json), 'params'), 'item')
}

function canonicalEvent(row: AgentEventRow): Record<string, unknown> | null {
  return parseJsonRecord(row.canonical_json)
}

function rawThreadItemType(row: AgentEventRow): string | null {
  return stringField(rawThreadItem(row), 'type') ?? stringField(canonicalEvent(row), 'itemType')
}

function shouldProjectEvent(row: AgentEventRow): boolean {
  if (row.event_type !== 'item.started' && row.event_type !== 'item.completed') {
    return true
  }

  const itemType = rawThreadItemType(row)
  return (
    itemType !== 'userMessage' &&
    itemType !== 'agentMessage' &&
    itemType !== 'reasoning' &&
    itemType !== 'plan' &&
    itemType !== 'hookPrompt'
  )
}

function fallbackStatusForEvent(row: AgentEventRow): string | null {
  if (row.event_type.endsWith('.started') || row.event_type.endsWith('/started')) {
    return 'started'
  }
  if (row.event_type.endsWith('.completed') || row.event_type.endsWith('/completed')) {
    return 'completed'
  }
  return null
}

function fallbackTitleForEvent(row: AgentEventRow): string | null {
  const item = rawThreadItem(row)
  const itemType = stringField(item, 'type') ?? stringField(canonicalEvent(row), 'itemType')

  switch (itemType) {
    case 'commandExecution':
      return 'Command'
    case 'fileChange':
      return 'File change'
    case 'mcpToolCall':
      return stringField(item, 'tool') ? `MCP tool: ${stringField(item, 'tool')}` : 'MCP tool'
    case 'dynamicToolCall':
      return stringField(item, 'tool') ? `Tool: ${stringField(item, 'tool')}` : 'Tool'
    case 'webSearch':
      return 'Web search'
    default:
      return null
  }
}

function fallbackSummaryForEvent(row: AgentEventRow): string | null {
  const item = rawThreadItem(row)
  const itemType = stringField(item, 'type') ?? stringField(canonicalEvent(row), 'itemType')

  switch (itemType) {
    case 'commandExecution':
      return stringField(item, 'command')
    case 'fileChange': {
      const changes = arrayLengthField(item, 'changes')
      return changes === null ? null : `${changes} file change${changes === 1 ? '' : 's'}`
    }
    case 'mcpToolCall':
      return stringField(item, 'server')
    case 'dynamicToolCall':
      return stringField(item, 'namespace')
    case 'webSearch':
      return stringField(item, 'query')
    default:
      return null
  }
}

function mapEvent(row: AgentEventRow): AgentEvent | null {
  if (!shouldProjectEvent(row)) {
    return null
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    provider: row.provider,
    eventType: row.event_type,
    streamKind: row.stream_kind,
    title: row.title ?? fallbackTitleForEvent(row),
    summary: row.summary ?? fallbackSummaryForEvent(row),
    status: row.status ?? fallbackStatusForEvent(row),
    createdAt: row.created_at
  }
}

function stringifyJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}

function parseDiffChangeKind(value: unknown): AgentDiffChangeKind | null {
  return value === 'add' || value === 'delete' || value === 'update' ? value : null
}

function parseDiffSource(value: unknown): AgentDiffSource {
  return value === 'checkpoint' ? 'checkpoint' : 'provider'
}

function parseDiffFileChange(value: unknown): AgentDiffFileChange | null {
  if (!isRecord(value)) {
    return null
  }

  const path = stringField(value, 'path')
  const kind = parseDiffChangeKind(value.kind)
  const diff = stringField(value, 'diff')
  if (!path || !kind || diff === null) {
    return null
  }

  return {
    path,
    previousPath: nullableStringField(value, 'previousPath'),
    kind,
    diff
  }
}

function mapDiffEvent(row: AgentEventRow): AgentTurnDiff | null {
  if (!row.turn_id) {
    return null
  }

  const canonical = canonicalEvent(row)
  if (stringField(canonical, 'type') !== 'diff.updated') {
    return null
  }

  const files = arrayField(canonical, 'files')
    .map(parseDiffFileChange)
    .filter((file): file is AgentDiffFileChange => Boolean(file))

  return {
    id: `diff_${row.turn_id}`,
    sessionId: row.session_id,
    turnId: row.turn_id,
    provider: row.provider,
    source: parseDiffSource(canonical?.source),
    providerTurnId: nullableStringField(canonical, 'providerTurnId'),
    providerItemId: nullableStringField(canonical, 'providerItemId'),
    files,
    unifiedDiff: nullableStringField(canonical, 'unifiedDiff'),
    createdAt: row.created_at,
    updatedAt: row.created_at
  }
}

interface DiffProjectionState {
  diff: AgentTurnDiff
  providerAnonymousFiles: AgentDiffFileChange[]
  providerItemFiles: Map<string, AgentDiffFileChange[]>
}

function createDiffProjection(diff: AgentTurnDiff): DiffProjectionState {
  const state: DiffProjectionState = {
    diff,
    providerAnonymousFiles: [],
    providerItemFiles: new Map()
  }

  if (diff.source === 'provider') {
    recordProviderDiffFiles(state, diff)
    state.diff = {
      ...diff,
      files: aggregateProviderDiffFiles(state)
    }
  }

  return state
}

function applyDiffProjection(state: DiffProjectionState, next: AgentTurnDiff): void {
  if (state.diff.source === 'checkpoint' && next.source === 'provider') {
    return
  }

  if (next.source === 'checkpoint') {
    state.diff = {
      ...next,
      createdAt: state.diff.createdAt
    }
    state.providerAnonymousFiles = []
    state.providerItemFiles.clear()
    return
  }

  recordProviderDiffFiles(state, next)

  state.diff = {
    ...state.diff,
    source: next.source,
    providerTurnId: next.providerTurnId ?? state.diff.providerTurnId,
    providerItemId: next.providerItemId ?? state.diff.providerItemId,
    files: aggregateProviderDiffFiles(state),
    unifiedDiff: next.unifiedDiff ?? state.diff.unifiedDiff,
    updatedAt: next.updatedAt
  }
}

function recordProviderDiffFiles(state: DiffProjectionState, diff: AgentTurnDiff): void {
  if (diff.providerItemId) {
    state.providerItemFiles.delete(diff.providerItemId)
    state.providerItemFiles.set(diff.providerItemId, diff.files)
    return
  }

  state.providerAnonymousFiles = mergeDiffFiles(state.providerAnonymousFiles, diff.files)
}

function aggregateProviderDiffFiles(state: DiffProjectionState): AgentDiffFileChange[] {
  let files = state.providerAnonymousFiles
  for (const itemFiles of state.providerItemFiles.values()) {
    files = mergeDiffFiles(files, itemFiles)
  }
  return files
}

function mergeDiffFiles(previous: AgentDiffFileChange[], next: AgentDiffFileChange[]): AgentDiffFileChange[] {
  if (next.length === 0) {
    return previous
  }

  const byPath = new Map(previous.map((file) => [diffFileKey(file), file]))
  for (const file of next) {
    byPath.set(diffFileKey(file), file)
  }
  return [...byPath.values()]
}

function diffFileKey(file: AgentDiffFileChange): string {
  return `${file.previousPath ?? ''}\u0000${file.path}`
}

function mapTurnDiffs(rows: AgentEventRow[]): AgentTurnDiff[] {
  const byTurnId = new Map<string, DiffProjectionState>()

  for (const row of rows) {
    const diff = mapDiffEvent(row)
    if (!diff) {
      continue
    }

    const previous = byTurnId.get(diff.turnId)
    if (previous) {
      applyDiffProjection(previous, diff)
    } else {
      byTurnId.set(diff.turnId, createDiffProjection(diff))
    }
  }

  return [...byTurnId.values()].map((state) => state.diff).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
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
              updated_at = ?
            WHERE id = ?
          `
        )
        .run(input.turnId ?? null, input.messageId ?? null, input.title ?? null, timestamp, existing.id)

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
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
