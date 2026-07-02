import type {
  AgentEvent,
  AgentProvider,
  AgentSession,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTurn,
  AgentTurnDiff,
  RuntimeSseEvent
} from '@open-science/contracts'
import type { AgentTimelineItem } from '@open-science/ui'

type RuntimeActivityEvent = Extract<RuntimeSseEvent, { type: 'activity' }>

export const runtimeEventTypes: RuntimeSseEvent['type'][] = [
  'session.snapshot',
  'session.updated',
  'turn.started',
  'turn.completed',
  'turn.failed',
  'turn.interrupted',
  'message.created',
  'message.delta',
  'message.completed',
  'request.opened',
  'request.resolved',
  'activity',
  'diff.updated',
  'artifact.created',
  'artifact.updated',
  'runtime.error'
]

const hiddenActivityEventTypes = new Set([
  'account/rateLimits/updated',
  'mcpServer/startupStatus/updated',
  'remoteControl/status/changed',
  'skills/changed',
  'thread/started',
  'thread/status/changed',
  'thread/tokenUsage/updated',
  'turn/started',
  'turn.completed',
  'diff.updated',
  'claude.assistant',
  'claude.content_block_start',
  'claude.content_block_stop',
  'claude.rate_limit_event',
  'claude.result.success',
  'claude.stream.content_block_delta',
  'claude.stream.message_delta',
  'claude.stream.message_start',
  'claude.stream.message_stop',
  'claude.system.init',
  'claude.system.status',
  'claude.user'
])

export function byCreatedAt<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

function byRequestedAt(items: AgentTurn[]): AgentTurn[] {
  return [...items].sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
}

function byDiffUpdatedAt(items: AgentTurnDiff[]): AgentTurnDiff[] {
  return [...items].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
}

export function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index === -1) {
    return [...items, next]
  }
  const updated = [...items]
  updated[index] = next
  return updated
}

export function upsertSessionSummary(items: AgentSessionSummary[], session: AgentSession): AgentSessionSummary[] {
  if (!session.activatedAt || session.status === 'pending_activation') {
    return items
  }

  const summary: AgentSessionSummary = {
    id: session.id,
    provider: session.provider,
    title: session.title,
    cwd: session.cwd,
    model: session.model,
    runtimeMode: session.runtimeMode,
    status: session.status,
    activatedAt: session.activatedAt,
    updatedAt: session.updatedAt
  }

  return upsertById(items, summary).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function isVisibleActivityEvent(eventType: string): boolean {
  return eventType !== 'stderr' && eventType !== 'content.delta' && !hiddenActivityEventTypes.has(eventType)
}

/** Some provider events arrive with their payload stripped; an activity row
 * with no title, summary, or status has nothing to tell the user. */
function hasActivityContent(event: AgentEvent): boolean {
  return Boolean(event.title?.trim() || event.summary?.trim() || event.status)
}

function visibleActivitySummary(summary: string | undefined): string | undefined {
  const trimmed = summary?.trim()
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return undefined
  }
  return summary
}

function eventFromRuntimeActivity(event: RuntimeActivityEvent, provider: AgentProvider): AgentEvent | null {
  if (!isVisibleActivityEvent(event.eventType)) {
    return null
  }

  return {
    id: event.id,
    sessionId: event.sessionId,
    turnId: event.turnId ?? null,
    provider,
    eventType: event.eventType,
    streamKind: null,
    title: event.title,
    summary: visibleActivitySummary(event.summary) ?? null,
    status: event.status ?? null,
    createdAt: event.createdAt
  }
}

export function applyRuntimeEvent(detail: AgentSessionDetail | null, event: RuntimeSseEvent): AgentSessionDetail | null {
  if (event.type === 'session.snapshot') {
    return event.detail
  }

  if (!detail || detail.session.id !== event.sessionId) {
    return detail
  }

  switch (event.type) {
    case 'session.updated':
      return {
        ...detail,
        session: event.session
      }
    case 'turn.started':
    case 'turn.completed':
    case 'turn.failed':
    case 'turn.interrupted':
      return {
        ...detail,
        turns: byRequestedAt(upsertById(detail.turns, event.turn))
      }
    case 'message.created':
    case 'message.delta':
    case 'message.completed':
      return {
        ...detail,
        messages: byCreatedAt(upsertById(detail.messages, event.message))
      }
    case 'request.opened':
    case 'request.resolved':
      return {
        ...detail,
        pendingRequests: byCreatedAt(upsertById(detail.pendingRequests, event.request))
      }
    case 'activity': {
      const activityEvent = eventFromRuntimeActivity(event, detail.session.provider)
      if (!activityEvent) {
        return detail
      }
      return {
        ...detail,
        events: byCreatedAt(upsertById(detail.events, activityEvent))
      }
    }
    case 'diff.updated':
      return {
        ...detail,
        diffs: byDiffUpdatedAt(upsertById(detail.diffs ?? [], event.diff))
      }
    case 'artifact.created':
    case 'artifact.updated':
      return {
        ...detail,
        artifacts: byCreatedAt(upsertById(detail.artifacts, event.artifact))
      }
    default:
      return detail
  }
}

const lifecycleEventSuffix = /\.(started|completed|failed|in_progress|updated)$/

function activityMergeKey(event: AgentEvent): string | null {
  const family = event.eventType.replace(lifecycleEventSuffix, '')
  if (family === event.eventType) {
    return null
  }
  return `${event.turnId ?? ''}:${family}:${event.title ?? ''}:${event.summary ?? ''}`
}

function activityStatusRank(status: string | null): number {
  if (status === 'completed' || status === 'failed' || status === 'error' || status === 'resolved') {
    return 2
  }
  if (status === 'running' || status === 'started') {
    return 1
  }
  return 0
}

/**
 * Providers emit separate started/completed events for the same tool call.
 * Collapse each pair into a single run-log entry that keeps the start time
 * and the most final status, so nothing spins forever after completion.
 */
export function mergeLifecycleEvents(events: AgentEvent[]): AgentEvent[] {
  const merged: AgentEvent[] = []
  const latestByKey = new Map<string, number>()

  for (const event of events) {
    const key = activityMergeKey(event)
    if (key === null) {
      merged.push(event)
      continue
    }

    const index = latestByKey.get(key)
    const existing = index === undefined ? undefined : merged[index]
    // A fresh start after a terminal event is a new occurrence, not an update.
    if (
      existing === undefined ||
      (activityStatusRank(event.status) < 2 && activityStatusRank(existing.status) === 2)
    ) {
      latestByKey.set(key, merged.length)
      merged.push(event)
      continue
    }

    if (activityStatusRank(event.status) >= activityStatusRank(existing.status)) {
      merged[index as number] = { ...event, createdAt: existing.createdAt }
    }
  }

  return merged
}

export function isRunning(detail: AgentSessionDetail | null): boolean {
  return Boolean(
    detail &&
      (detail.session.status === 'running' ||
        detail.session.status === 'waiting' ||
        detail.turns.some((turn) => turn.status === 'running'))
  )
}

function timelineItemRank(item: AgentTimelineItem): number {
  if (item.type === 'message') {
    if (item.message.role === 'user') {
      return 0
    }
    return 4
  }
  if (item.type === 'activity') {
    if (item.event.status === 'completed' || item.event.status === 'resolved') {
      return 2
    }
    return 1
  }
  if (item.type === 'diff') {
    return 3
  }
  return 3
}

export function buildTimelineItems(
  detail: AgentSessionDetail | null,
  activeArtifactId: string | null
): AgentTimelineItem[] {
  if (!detail) {
    return []
  }

  const items: AgentTimelineItem[] = [
    ...detail.messages.map((message) => ({
      id: message.id,
      type: 'message' as const,
      createdAt: message.createdAt,
      message
    })),
    ...mergeLifecycleEvents(
      detail.events.filter(
        (event) => isVisibleActivityEvent(event.eventType) && hasActivityContent(event)
      )
    ).map((event) => ({
      id: event.id,
      type: 'activity' as const,
      createdAt: event.createdAt,
      event
    })),
    ...(detail.diffs ?? []).map((diff) => ({
      id: diff.id,
      type: 'diff' as const,
      createdAt: diff.updatedAt,
      diff
    })),
    ...detail.artifacts.map((artifact) => ({
      id: artifact.id,
      type: 'artifact' as const,
      createdAt: artifact.createdAt,
      artifact,
      active: artifact.id === activeArtifactId
    })),
    ...detail.pendingRequests.map((request) => ({
      id: request.id,
      type: 'request' as const,
      createdAt: request.createdAt,
      request
    }))
  ]

  return items.sort((left, right) => {
    const createdOrder = left.createdAt.localeCompare(right.createdAt)
    if (createdOrder !== 0) {
      return createdOrder
    }

    const rankOrder = timelineItemRank(left) - timelineItemRank(right)
    if (rankOrder !== 0) {
      return rankOrder
    }

    return left.id.localeCompare(right.id)
  })
}
