// Pure projection logic from persisted agent_events rows to domain objects.
// Knows the canonical provider event format (thread items, diff.updated payloads),
// but nothing about SQL or the database. Sections:
//   1. JSON field helpers        — safe access into parsed raw/canonical JSON
//   2. Event projection          — mapEvent + per-item-type title/summary/status fallbacks
//   3. Diff projection           — mapTurnDiffs: fold diff.updated events into one diff per turn

import type {
  AgentDiffChangeKind,
  AgentDiffFileChange,
  AgentDiffSource,
  AgentEvent,
  AgentProvider,
  AgentTurnDiff
} from '@open-science/contracts'

export interface AgentEventRow {
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

export function mapEvent(row: AgentEventRow): AgentEvent | null {
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
    ...(row.event_type === 'notebook.execution' ? { detailJson: row.canonical_json } : {}),
    createdAt: row.created_at
  }
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
    previousPath: stringField(value, 'previousPath'),
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
    providerTurnId: stringField(canonical, 'providerTurnId'),
    providerItemId: stringField(canonical, 'providerItemId'),
    files,
    unifiedDiff: stringField(canonical, 'unifiedDiff'),
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

export function mapTurnDiffs(rows: AgentEventRow[]): AgentTurnDiff[] {
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
